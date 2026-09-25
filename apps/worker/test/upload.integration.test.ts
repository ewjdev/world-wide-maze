/**
 * Phase 14 integration: `POST /api/stages/upload` on the real Worker in workerd (wrangler `createTestHarness`,
 * as in scores.integration.test.ts), with local R2/D1/KV/DO/rate limits. The real builder and the solver hook
 * run on the uploaded capture. No browser is needed: the uploads are fixture captures.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CaptureBundle,
  type CreateStageResponse,
  parseStage,
  type RunResponse,
  sliceCount,
  validateStage,
} from '@wwm/schema';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { readPngHeader } from '../src/image/png.ts';
import { LOCAL_CAPTURE_NOTE, UPLOAD_LIMITS } from '../src/routes/upload-limits.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const configPath = resolve(root, 'apps/worker/wrangler.jsonc');
const fixture = (slug: string) => ({
  bundle: JSON.parse(
    readFileSync(resolve(root, `fixtures/captures/${slug}/capture.json`), 'utf8'),
  ) as CaptureBundle,
  png: new Uint8Array(readFileSync(resolve(root, `fixtures/captures/${slug}/screenshot.png`))),
});
const HN = fixture('hn-front'); // one slice
const GOV = fixture('govuk-card-grid'); // three slices

type Parts = Record<string, string | Uint8Array>;

// CI stability: real workerd round trips; Vitest's default 5 s per test is too tight on a loaded CI runner.
describe('POST /api/stages/upload (workerd)', { timeout: 30_000 }, () => {
  const server = createTestHarness();
  let ipSeq = 0;
  const newIp = () => `192.0.2.${++ipSeq}`;

  function form(parts: Parts): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(parts))
      if (typeof v === 'string') f.append(k, v);
      else f.append(k, new Blob([v as Uint8Array<ArrayBuffer>]), k);
    return f;
  }
  /** Encoded here: the harness's fetch would stringify a Node `FormData` body. */
  const upload = async (parts: Parts, ip = newIp(), headers: Record<string, string> = {}) => {
    const req = new Request('http://localhost/', { method: 'POST', body: form(parts) });
    return server.fetch('http://localhost/api/stages/upload', {
      method: 'POST',
      body: new Uint8Array(await req.arrayBuffer()),
      headers: {
        'cf-connecting-ip': ip,
        'content-type': req.headers.get('content-type') ?? '',
        ...headers,
      },
    });
  };
  const get = (path: string) =>
    server.fetch(`http://localhost${path}`, { headers: { 'cf-connecting-ip': newIp() } });
  const local = (f: { bundle: CaptureBundle; png: Uint8Array }, extra: Parts = {}): Parts => ({
    bundle: JSON.stringify({ ...f.bundle, url: 'https://intranet.example/dashboard' }),
    image: f.png,
    ...extra,
  });

  beforeAll(async () => {
    await server.update({ workers: [{ configPath, vars: { BUILD_LIMIT_PER_HOUR: '3' } }] });
    await server.listen();
    await server.getWorker().applyD1Migrations('DB');
  }, 120_000);

  afterAll(async () => {
    await server.close();
  });

  test('bundle + image → 200 {runId, stageIds}; stored stage is valid, tagged local-capture, texture cropped by the Worker', async () => {
    const r = await upload(local(HN));
    expect(r.status).toBe(200);
    const body = (await r.json()) as CreateStageResponse;
    if (!('runId' in body)) throw new Error('no runId');
    expect(body.stageIds).toHaveLength(1);

    const stage = parseStage(await (await get(`/api/stages/${body.stageIds[0]}`)).json());
    expect(validateStage(stage)).toEqual({ ok: true, errors: [] });
    expect(stage.provenance.notes).toContain(LOCAL_CAPTURE_NOTE);
    expect(stage.source.url).toBe('https://intranet.example/dashboard');
    // server-derived capture id, never the client's
    expect(stage.source.captureId).not.toBe(HN.bundle.captureId);

    const tex = await get(`/api/stages/${stage.stageId}/texture`);
    expect(tex.status).toBe(200);
    expect(tex.headers.get('content-type')).toBe('image/png');
    const head = readPngHeader(new Uint8Array(await tex.arrayBuffer()));
    expect([head.width, head.height]).toEqual([stage.texture.width, stage.texture.height]);
    expect(stage.texture.scale).toBe(1);

    const run = (await (await get(`/api/runs/${body.runId}`)).json()) as RunResponse;
    expect(run.stageIds).toEqual(body.stageIds);
    // unlisted: never in the curated list
    expect(((await (await get('/api/curated')).json()) as { runs: unknown[] }).runs).toEqual([]);
  }, 120_000);

  test('client slice textures are stored as sent; a multi-slice page becomes a full run', async () => {
    // Three slices of the govuk page; textures are the Worker-free path (PNG at scale 1, cut here in Node).
    const count = sliceCount(GOV.bundle);
    expect(count).toBe(3);
    const r0 = await upload(local(GOV));
    expect(r0.status).toBe(200);
    const body = (await r0.json()) as { runId: string; stageIds: string[] };
    expect(body.stageIds).toHaveLength(3);
    for (const [i, id] of body.stageIds.entries()) {
      const s = parseStage(await (await get(`/api/stages/${id}`)).json());
      expect(s.source.slice.index).toBe(i);
      expect(validateStage(s).ok).toBe(true);
    }

    // hn-front with its own screenshot as the one slice texture (scale 1, PNG)
    const r1 = await upload(local(HN, { texture0: HN.png }));
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { stageIds: string[] };
    const tex = new Uint8Array(await (await get(`/api/stages/${b1.stageIds[0]}/texture`)).arrayBuffer());
    expect(tex).toEqual(HN.png);
  }, 240_000);

  test('the same capture claiming another run’s captureId cannot overwrite it', async () => {
    const a = (await (await upload(local(HN))).json()) as { stageIds: string[] };
    const forged = JSON.stringify({
      ...HN.bundle,
      captureId: 'f'.repeat(64),
      url: 'https://intranet.example/dashboard',
    });
    const b = (await (await upload({ bundle: forged, image: HN.png })).json()) as { stageIds: string[] };
    const sa = parseStage(await (await get(`/api/stages/${a.stageIds[0]}`)).json());
    const sb = parseStage(await (await get(`/api/stages/${b.stageIds[0]}`)).json());
    expect(sb.source.captureId).not.toBe('f'.repeat(64));
    // identical content → identical content-derived id (idempotent)
    expect(sb.source.captureId).toBe(sa.source.captureId);
  }, 120_000);

  test('rejects malformed uploads with 400/413/415, before counting a build', async () => {
    const ip = newIp();
    const cases: [Parts | 'json' | 'huge', number, RegExp][] = [
      ['json', 415, /multipart/],
      ['huge', 413, /larger/],
      [{ image: HN.png }, 400, /missing "bundle"/],
      [{ bundle: JSON.stringify(HN.bundle) }, 400, /missing "image"/],
      [{ bundle: '{nope', image: HN.png }, 400, /not JSON/],
      [{ bundle: JSON.stringify({ ...HN.bundle, schema: 'x' }), image: HN.png }, 400, /invalid capture/],
      [{ ...local(HN), image: new TextEncoder().encode('GIF89a not a png') }, 415, /PNG/],
      [local(HN, { extra: 'x' }), 400, /unexpected field/],
      [{ ...local(GOV), image: HN.png }, 400, /bundle says/],
      [local(GOV, { texture0: GOV.png }), 400, /expected 3 textures/],
      [local(HN, { texture0: new Uint8Array(40) }), 415, /WebP or PNG/],
      [
        { bundle: JSON.stringify({ ...HN.bundle, url: 'file:///etc/passwd' }), image: HN.png },
        400,
        /http\(s\)/,
      ],
      [
        {
          bundle: JSON.stringify({ ...HN.bundle, elements: Array(20_001).fill(HN.bundle.elements[0]) }),
          image: HN.png,
        },
        400,
        /invalid capture/,
      ],
    ];
    for (const [parts, status, msg] of cases) {
      const r =
        parts === 'json'
          ? await server.fetch('http://localhost/api/stages/upload', {
              method: 'POST',
              body: '{}',
              headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
            })
          : parts === 'huge'
            ? await server.fetch('http://localhost/api/stages/upload', {
                method: 'POST',
                body: new Uint8Array(UPLOAD_LIMITS.bodyBytes + 1),
                headers: { 'cf-connecting-ip': ip, 'content-type': 'multipart/form-data; boundary=x' },
              })
            : await upload(parts, ip);
      const j = (await r.json()) as { message: string };
      expect([r.status, j.message]).toEqual([status, expect.stringMatching(msg)]);
    }
    // none of those counted against this IP's 3 builds per hour
    for (let i = 0; i < 3; i++) expect((await upload(local(HN), ip)).status).toBe(200);
    const limited = await upload(local(HN), ip);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { code: string }).code).toBe('RATE_LIMITED');
    expect(limited.headers.get('retry-after')).toBeTruthy();
  }, 240_000);

  test('cross-site uploads are refused (Sec-Fetch-Site)', async () => {
    const r = await upload(local(HN), newIp(), { 'sec-fetch-site': 'cross-site' });
    expect(r.status).toBe(403);
  });
});
