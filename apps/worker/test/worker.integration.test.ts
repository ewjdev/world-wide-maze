/**
 * Integration: the real Worker (wrangler.jsonc, bundled and run in workerd by wrangler's `createTestHarness`)
 * with local R2/D1/KV/Durable Objects/rate limits. Captures go through the capture sidecar running local
 * Chromium (capturer b), DNS through a fake DoH endpoint, pages come from a local fixture site.
 *
 * Why not the Workers Vitest pool: @cloudflare/vitest-pool-workers 0.22 requires Vitest 4; this repo is on
 * Vitest 5. `createTestHarness` is Cloudflare's runner-agnostic integration API and runs the production
 * build, which is what these acceptance tests need.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CreateStageResponse,
  type JobEvent,
  parseStage,
  type RunResponse,
  validateStage,
} from '@wwm/schema';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { LocalChromiumCapturer } from '../node/local-chromium.ts';
import { type SidecarHandle, startCaptureSidecar } from '../node/sidecar.ts';
import { webpSize } from '../src/image/webp.ts';
import { parseSse } from '../src/job-events.ts';
import { createStaticResolver } from '../src/policy/dns.ts';
import { startFakeDoh } from './helpers/fake-doh.ts';
import {
  HAS_CHROMIUM,
  startFixtureSite,
  startInternalServer,
  type TestServer,
} from './helpers/fixture-site.ts';

const configPath = resolve(fileURLToPath(new URL('..', import.meta.url)), 'wrangler.jsonc');
/** Cached POST /api/stages latency budget; ×4 on CI runners (same factor as stage-builder's perf budget). */
const CACHE_HIT_BUDGET_MS = 100 * (process.env.CI ? 4 : 1);
const DNS = { 'rebind.attacker.dev': ['127.0.0.1'], 'mixed.attacker.dev': ['93.184.215.14', '10.9.9.9'] };

// CI stability: real workerd round trips; Vitest's default 5 s per test is too tight on a loaded CI runner.
describe.skipIf(!HAS_CHROMIUM)(
  'Worker integration (workerd + local bindings + local Chromium)',
  { timeout: 30_000 },
  () => {
    const server = createTestHarness();
    let internal: TestServer;
    let site: TestServer;
    let sidecar: SidecarHandle;
    let capturer: LocalChromiumCapturer;
    let doh: Awaited<ReturnType<typeof startFakeDoh>>;
    let ipSeq = 0;
    /** Each test gets its own client IP so per-IP limits don't interact. */
    const newIp = () => `198.51.100.${++ipSeq}`;

    const api = (
      path: string,
      ip: string,
      init: { method?: string; body?: string; headers?: Record<string, string> } = {},
    ) =>
      server.fetch(`http://localhost${path}`, {
        ...init,
        headers: { 'cf-connecting-ip': ip, ...init.headers },
      });
    const post = (body: unknown, ip: string) =>
      api('/api/stages', ip, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
    const events = async (jobId: string, ip: string): Promise<JobEvent[]> => {
      const r = await api(`/api/jobs/${jobId}`, ip);
      expect(r.headers.get('content-type')).toContain('text/event-stream');
      return parseSse(await r.text());
    };
    const build = async (path: string, ip: string) => {
      const r = await post({ url: `${site.origin}${path}` }, ip);
      expect(r.status).toBe(202);
      const { jobId } = (await r.json()) as { jobId: string };
      return { jobId, events: await events(jobId, ip) };
    };

    beforeAll(async () => {
      internal = await startInternalServer();
      site = await startFixtureSite(internal.origin);
      doh = await startFakeDoh(DNS);
      capturer = new LocalChromiumCapturer({
        guard: { resolver: createStaticResolver(DNS), allowHosts: [site.host] },
      });
      sidecar = await startCaptureSidecar({ capturer });
      await server.update({
        workers: [
          {
            configPath,
            vars: {
              CAPTURE_BACKEND: 'sidecar',
              CAPTURE_SIDECAR_URL: sidecar.url,
              DEV_ALLOWED_HOSTS: site.host,
              DOH_URL: doh.url,
              BUILD_LIMIT_PER_HOUR: '3',
              CAPTURE_BUDGET_MS: '8000',
            },
          },
        ],
      });
      await server.listen();
      await server.getWorker().applyD1Migrations('DB');
    }, 120_000);

    afterAll(async () => {
      await server.close();
      await sidecar?.close();
      await capturer?.close();
      await doh?.close();
      await site?.close();
      await internal?.close();
    });

    test('health', async () => {
      const r = await api('/api/health', newIp());
      expect(await r.json()).toMatchObject({ ok: true });
    });

    test('POST /api/stages → SSE in order → stored stage passes validateStage; texture is the DPR-2 slice', async () => {
      const ip = newIp();
      const { events: ev } = await build('/sparse', ip);
      expect(ev.map((e) => (e.type === 'progress' ? e.step : e.type))).toEqual([
        'queued',
        'capturing',
        'extracting',
        'building',
        'validating',
        'storing',
        'done',
      ]);
      const done = ev.at(-1);
      if (done?.type !== 'done') throw new Error('no done');
      expect(done.stageIds).toHaveLength(1);

      const sr = await api(`/api/stages/${done.stageIds[0]}`, ip);
      expect(sr.status).toBe(200);
      expect(sr.headers.get('cache-control')).toContain('immutable');
      const stage = parseStage(await sr.json());
      expect(validateStage(stage)).toEqual({ ok: true, errors: [] });
      expect(stage.source.url).toBe(`${site.origin}/sparse`);

      const tr = await api(`/api/stages/${stage.stageId}/${stage.texture.path.split('/').at(-1)}`, ip);
      expect(tr.status).toBe(200);
      expect(tr.headers.get('content-type')).toBe('image/webp');
      const size = webpSize(new Uint8Array(await tr.arrayBuffer()));
      expect(size).toEqual({ width: stage.texture.width, height: stage.texture.height });
      expect(stage.texture.width).toBe(stage.size.width * 2);

      const rr = await api(`/api/runs/${done.runId}`, ip);
      expect((await rr.json()) as RunResponse).toEqual({
        runId: done.runId,
        url: stage.source.url,
        title: 'Sparse fixture',
        stageIds: done.stageIds,
      });
    }, 60_000);

    test('a long page becomes a run: done after slice 0, the rest appear in /api/runs; the second POST is a cache hit < 100 ms', async () => {
      const ip = newIp();
      const t0 = Date.now();
      const { events: ev } = await build('/long', ip);
      const done = ev.at(-1);
      if (done?.type !== 'done') throw new Error(`no done: ${JSON.stringify(ev.at(-1))}`);
      const slice0Ms = Date.now() - t0;
      const first = parseStage(await (await api(`/api/stages/${done.stageIds[0]}`, ip)).json());
      const count = first.source.slice.count;
      expect(count).toBeGreaterThanOrEqual(2);

      let run: RunResponse | undefined;
      for (let i = 0; i < 100; i++) {
        run = (await (await api(`/api/runs/${done.runId}`, ip)).json()) as RunResponse;
        if (run.stageIds.length === count) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(run?.stageIds).toHaveLength(count);
      for (const [i, id] of (run?.stageIds ?? []).entries()) {
        const s = parseStage(await (await api(`/api/stages/${id}`, ip)).json());
        expect(s.source.slice.index).toBe(i);
        expect(validateStage(s).ok).toBe(true);
      }

      const siteHits = site.hits.length;
      const tHit = performance.now();
      const hit = await post({ url: `${site.origin}/long` }, ip);
      const hitMs = performance.now() - tHit;
      // A cache hit, structurally: 200 with the finished run (a miss is 202 {jobId}), and the page was not fetched again.
      expect(hit.status).toBe(200);
      expect((await hit.json()) as CreateStageResponse).toEqual({
        runId: done.runId,
        stageIds: run?.stageIds,
      });
      expect(site.hits.slice(siteHits)).toEqual([]);
      console.log(
        `[timing] /long cold slice0=${slice0Ms} ms (${count} slices); cached POST=${hitMs.toFixed(1)} ms`,
      );
      // …and fast: < 100 ms on a laptop. Loaded CI runners (every Vitest project in parallel on 2-4 vCPUs) measured
      // 155 ms, so CI gets the same ×4 factor as the stage-builder budget. Either way it is far below a real build.
      expect(hitMs).toBeLessThan(CACHE_HIT_BUDGET_MS);
      expect(hitMs).toBeLessThan(slice0Ms / 4);
    }, 90_000);

    test('URL_FORBIDDEN before any job: private literals, loopback ports, DNS answers in private ranges', async () => {
      const ip = newIp();
      for (const url of [
        'http://10.0.0.1/',
        'http://[::ffff:127.0.0.1]/',
        'http://2130706433/',
        internal.origin,
        'http://metadata.google.internal/',
        'https://rebind.attacker.dev/',
        'https://mixed.attacker.dev/',
        'file:///etc/passwd',
      ]) {
        const r = await post({ url }, ip);
        expect(r.status, url).toBe(400);
        expect(await r.json()).toMatchObject({ code: 'URL_FORBIDDEN' });
      }
      expect(doh.queries).toContain('rebind.attacker.dev/A');
      expect(internal.hits).toEqual([]);
    });

    test.each([
      ['/status403', 'CAPTURE_BLOCKED'],
      ['/challenge', 'CAPTURE_BLOCKED'],
      ['/slow', 'CAPTURE_TIMEOUT'],
      ['/redirect?to=REDIRECT_TARGET', 'URL_FORBIDDEN'],
    ])(
      'SSE error path %s → %s',
      async (path, code) => {
        const target = path.replace('REDIRECT_TARGET', encodeURIComponent(`${internal.origin}/admin`));
        const { events: ev } = await build(target, newIp());
        expect(ev.at(-1)).toMatchObject({ type: 'error', code });
        expect(ev.filter((e) => e.type !== 'progress')).toHaveLength(1);
        expect(internal.hits).toEqual([]);
      },
      30_000,
    );

    test('SSE error path: BUILD_FAILED when the build infrastructure fails (sidecar down)', async () => {
      await server.update((o) => ({
        ...o,
        workers: o.workers.map((w) => ({
          ...w,
          vars: { ...(w as { vars?: object }).vars, CAPTURE_SIDECAR_URL: 'http://127.0.0.1:9' },
        })),
      }));
      try {
        const { events: ev } = await build('/sparse?down=1', newIp());
        expect(ev.at(-1)).toMatchObject({ type: 'error', code: 'BUILD_FAILED' });
      } finally {
        await server.update((o) => ({
          ...o,
          workers: o.workers.map((w) => ({
            ...w,
            vars: { ...(w as { vars?: object }).vars, CAPTURE_SIDECAR_URL: sidecar.url },
          })),
        }));
      }
    }, 30_000);

    test('build rate limit: 3 new builds per hour per IP (test setting), then RATE_LIMITED with Retry-After', async () => {
      const ip = newIp();
      for (let i = 0; i < 3; i++)
        expect((await post({ url: `${site.origin}/sparse?rl=${i}` }, ip)).status).toBe(202);
      const r = await post({ url: `${site.origin}/sparse?rl=3` }, ip);
      expect(r.status).toBe(429);
      expect(await r.json()).toMatchObject({ code: 'RATE_LIMITED' });
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(3000);
      // Another client is unaffected.
      expect((await post({ url: `${site.origin}/sparse?rl=4` }, newIp())).status).toBe(202);
    }, 30_000);

    test('read rate limit: 100 reads per minute per IP', async () => {
      const ip = newIp();
      // The limiter counts in fixed 60 s windows, so on a slow runner the burst can straddle a window boundary and the
      // count restarts. Keep reading until the first 429: it must come after at least 100 allowed reads and no later
      // than two windows' worth (200), and nothing but 200s may precede it.
      const statuses: number[] = [];
      while (statuses.length < 205 && statuses.at(-1) !== 429)
        statuses.push((await api('/api/curated', ip)).status);
      const first429 = statuses.indexOf(429);
      expect(first429).toBeGreaterThanOrEqual(100);
      expect(first429).toBeLessThanOrEqual(200);
      expect(statuses.slice(0, first429).every((s) => s === 200)).toBe(true);
    }, 60_000);

    test('curated list reads Phase 10’s `curated` table (empty until it exists); 404s for unknown ids', async () => {
      const ip = newIp();
      expect(await (await api('/api/curated', ip)).json()).toEqual({ runs: [] });
      const env = await server.getWorker().getEnv();
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS curated (run_id TEXT PRIMARY KEY, title TEXT, url TEXT, thumb TEXT, stars INTEGER, position INTEGER)',
      );
      await env.DB.prepare('INSERT INTO curated VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind('r1', 'Example', 'https://example.com/', '/t.webp', 4, 1)
        .run();
      expect(await (await api('/api/curated', ip)).json()).toEqual({
        runs: [{ runId: 'r1', title: 'Example', url: 'https://example.com/', thumb: '/t.webp', stars: 4 }],
      });
      expect((await api(`/api/stages/${'0'.repeat(64)}`, ip)).status).toBe(404);
      expect((await api(`/api/runs/${'0'.repeat(64)}`, ip)).status).toBe(404);
      expect((await api('/api/jobs/00000000-0000-4000-8000-000000000000', ip)).status).toBe(404);
      expect((await api('/api/stages/nope', ip)).status).toBe(404);
    });

    test('retention cron deletes non-curated runs older than RETENTION_DAYS and keeps curated/new ones', async () => {
      const worker = server.getWorker();
      const env = await worker.getEnv();
      const old = new Date(Date.now() - 40 * 86400_000).toISOString();
      const insertRun = (id: string, cap: string, at: string) =>
        env.DB.prepare(
          `INSERT INTO runs (run_id, url, title, capture_id, slice_count, difficulty, seed, builder_version, created_at)
         VALUES (?1, 'https://example.com/', 't', ?2, 1, 'normal', 1, '0.0.0', ?3)`,
        )
          .bind(id, cap, at)
          .run();
      await insertRun('old-run', 'old-cap', old);
      await insertRun('old-curated', 'cur-cap', old);
      await env.DB.prepare('INSERT OR REPLACE INTO curated VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind('old-curated', 'c', 'u', 't', 3, 2)
        .run();
      await env.DB.prepare(
        `INSERT INTO stages (stage_id, run_id, slice_index, url, title, capture_id, builder_version, texture_key, islands, bridges, elevators, items, created_at)
       VALUES ('old-stage', 'old-run', 0, 'u', 't', 'old-cap', '0.0.0', 'textures/old-cap/0.webp', 1, 0, 0, 0, ?1)`,
      )
        .bind(old)
        .run();
      for (const k of [
        'stages/old-stage.json',
        'textures/old-cap/0.webp',
        'captures/old-cap/capture.json',
        'textures/cur-cap/0.webp',
      ])
        await env.STAGES.put(k, 'x');

      const res = await worker.scheduled({ cron: '17 3 * * *', scheduledTime: new Date() });
      expect(res.outcome).toBe('ok');
      for (const k of ['stages/old-stage.json', 'textures/old-cap/0.webp', 'captures/old-cap/capture.json'])
        expect(await env.STAGES.head(k), k).toBeNull();
      expect(await env.STAGES.head('textures/cur-cap/0.webp')).not.toBeNull();
      const left = await env.DB.prepare(
        "SELECT run_id FROM runs WHERE run_id IN ('old-run', 'old-curated')",
      ).all();
      expect(left.results).toEqual([{ run_id: 'old-curated' }]);
      // Fresh runs from the other tests survive.
      const fresh = (await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM runs WHERE run_id NOT LIKE 'old-%'",
      ).first()) as { n: number } | null;
      expect(fresh?.n).toBeGreaterThan(0);
    });
  },
);
