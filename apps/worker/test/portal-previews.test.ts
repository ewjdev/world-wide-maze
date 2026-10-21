/**
 * Portal previews (contracts §10.6, CCR-PW-1; plans/portal-windows-execution.md M3): `POST /api/portals/previews`
 * and the catalog lookups behind it, on the production migrations in SQLite (helpers/catalog-fixture.ts).
 */
import { MAX_PORTALS } from '@wwm/schema';
import { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import type { AppEnv } from '../src/app-env.ts';
import type { Services } from '../src/config.ts';
import { defaultSeed, runCacheKey } from '../src/ids.ts';
import { normalizeTargetUrl } from '../src/policy/url-policy.ts';
import { stagesRoutes } from '../src/routes/stages.ts';
import { fixture } from './helpers/catalog-fixture.ts';

const BUILDER = 'v1';
const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.close();
});

/** A catalog fixture plus helpers to add runs at a given difficulty/seed/builder and time. */
function setup() {
  const f = fixture();
  fixtures.push(f);
  const addRun = async (
    id: string,
    url: string,
    o: {
      difficulty?: string;
      seed?: number;
      builder?: string;
      at?: string;
      status?: 'approved' | 'pending_review' | 'blocked';
      submittedUrl?: string;
      runStatus?: string;
    } = {},
  ) => {
    const captureId = `capture-${id}`;
    const at = o.at ?? '2026-10-01T00:00:00Z';
    f.sqlite
      .prepare(
        `INSERT INTO runs(run_id,url,title,capture_id,slice_count,difficulty,seed,builder_version,status,created_at)
         VALUES (?,?,?,?,1,?,?,?,?,?)`,
      )
      .run(
        id,
        url,
        id,
        captureId,
        o.difficulty ?? 'normal',
        o.seed ?? defaultSeed(url),
        o.builder ?? BUILDER,
        o.runStatus ?? 'complete',
        at,
      );
    f.sqlite
      .prepare(`INSERT INTO stages VALUES (?, ?,0,?,?,?,?,?,1,0,0,0,?)`)
      .run(`stage-${id}`, id, url, id, captureId, o.builder ?? BUILDER, `textures/${captureId}/0.webp`, at);
    f.objects.set(`stages/stage-${id}.json`, 'stage');
    f.objects.set(`textures/${captureId}/0.webp`, 'texture');
    await f.record(id, o.status ?? 'approved', url, null, captureId, o.submittedUrl ?? url);
  };
  return { ...f, addRun };
}

/** Everything the route may touch, with the calls it must never make recorded. */
function app(f: ReturnType<typeof setup>, o: { optedOut?: string[] } = {}) {
  const forbidden: string[] = [];
  const catalogCalls: string[] = [];
  const catalog = new Proxy(f.cat, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        catalogCalls.push(String(prop));
        if (['claimBuild', 'publishVariant', 'resolveVariant', 'recordRun', 'decide'].includes(String(prop)))
          forbidden.push(`catalog.${String(prop)}`);
        return v.apply(target, args);
      };
    },
  });
  const store = new Proxy(
    { catalog },
    {
      get(target, prop) {
        if (prop === 'catalog') return target.catalog;
        return () => {
          forbidden.push(`store.${String(prop)}`);
          throw new Error(`store.${String(prop)} must not be called`);
        };
      },
    },
  );
  const services = {
    store,
    policy: { isOptedOut: async (host: string) => (o.optedOut ?? []).includes(host) },
    builder: { version: BUILDER },
    log: { info() {}, warn() {}, error() {} },
  } as unknown as Services;
  const cacheWrites: string[] = [];
  const env = {
    READ_LIMITER: { limit: async () => ({ success: true }) },
    CACHE: {
      get: (key: string) => f.cache.get(key) ?? null,
      put: async (key: string) => {
        cacheWrites.push(key);
      },
    },
  } as unknown as Env;
  const h = new Hono<AppEnv>();
  h.use('*', async (c, next) => {
    c.set('services', services);
    c.set('ip', '198.51.100.7');
    await next();
  });
  h.route('/api', stagesRoutes);
  const post = (body: unknown) =>
    h.request(
      '/api/portals/previews',
      { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) },
      env,
    );
  return { post, forbidden, catalogCalls, cacheWrites };
}

const A = 'https://a.example.org/page';
const B = 'https://b.example.org/';

describe('catalog lookups', () => {
  test('peekVariant finds the published pointer and the legacy match, and never writes', async () => {
    const f = setup();
    await f.addRun('legacy', A);
    const key = await runCacheKey(normalizeTargetUrl(A), 'normal', BUILDER);
    const legacy = { url: A, difficulty: 'normal', seed: defaultSeed(A), builderVersion: BUILDER };
    const before = {
      variants: f.sqlite.prepare('SELECT COUNT(*) AS n FROM url_variants').get(),
      keys: f.sqlite.prepare('SELECT cache_key FROM moderation_cases ORDER BY run_id').all(),
    };
    expect(await f.cat.peekVariant(key, legacy)).toBe('legacy');
    expect({
      variants: f.sqlite.prepare('SELECT COUNT(*) AS n FROM url_variants').get(),
      keys: f.sqlite.prepare('SELECT cache_key FROM moderation_cases ORDER BY run_id').all(),
    }).toEqual(before);
    await f.addRun('pointed', A, { difficulty: 'hard', at: '2026-09-01T00:00:00Z' });
    f.sqlite.prepare('INSERT INTO url_variants VALUES (?,?,?)').run(key, 'pointed', '2026-09-01T00:00:00Z');
    expect(await f.cat.peekVariant(key, legacy)).toBe('pointed');
  });

  test('newestServableRun: newest approved run for the page or its submitted URL; never pending', async () => {
    const f = setup();
    await f.addRun('old', A, { at: '2026-09-01T00:00:00Z' });
    await f.addRun('new', A, { at: '2026-10-01T00:00:00Z', difficulty: 'hard' });
    await f.addRun('pending', A, { at: '2026-10-05T00:00:00Z', status: 'pending_review' });
    expect(await f.cat.newestServableRun(A)).toBe('new');
    await f.addRun('redirected', 'https://c.example.org/landing', { submittedUrl: B });
    expect(await f.cat.newestServableRun(B)).toBe('redirected');
    expect(await f.cat.firstStageId('new')).toBe('stage-new');
  });

  test('the candidate query uses the moderation_cases URL indexes, not a table scan', () => {
    const f = setup();
    const plan = f.sqlite
      .prepare(`EXPLAIN QUERY PLAN SELECT r.run_id FROM moderation_cases m JOIN runs r ON r.run_id=m.run_id
        WHERE (m.url=?1 OR m.submitted_url=?1) AND +m.status='approved' AND +m.artifacts_available=1
        AND r.status IN ('complete','partial')
        AND EXISTS (SELECT 1 FROM stages s WHERE s.run_id=r.run_id AND s.slice_index=0)
        ORDER BY r.created_at DESC LIMIT 1`)
      .all('x') as { detail: string }[];
    const details = plan.map((p) => p.detail).join(' | ');
    expect(details).toMatch(/moderation_cases_url|moderation_cases_submitted/);
    expect(details).not.toMatch(/SCAN m\b(?! USING)/);
  });
});

describe('POST /api/portals/previews', () => {
  test('per URL, in request order: the exact variant wins over a newer run at another difficulty', async () => {
    const f = setup();
    await f.addRun('exact', A, { at: '2026-09-01T00:00:00Z' });
    await f.addRun('newer-hard', A, { at: '2026-10-01T00:00:00Z', difficulty: 'hard' });
    await f.addRun('b-hard', B, { difficulty: 'hard' });
    const { post, forbidden, cacheWrites } = app(f);
    const urls = ['https://unknown.example.org/', `${A}#frag`, B];
    const res = await post({ urls });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      items: [
        { url: urls[0], stageId: null },
        { url: urls[1], stageId: 'stage-exact' }, // echoed as sent; looked up normalized
        { url: B, stageId: 'stage-b-hard' }, // no exact variant: the newest servable run
      ],
    });
    expect(forbidden).toEqual([]);
    expect(cacheWrites).toEqual([]);
  });

  test('a builder upgrade falls back to the newest servable run (the picture is still the page)', async () => {
    const f = setup();
    await f.addRun('old-builder', A, { builder: 'v0' });
    const { post } = app(f);
    expect((await (await post({ urls: [A] })).json()) as unknown).toEqual({
      items: [{ url: A, stageId: 'stage-old-builder' }],
    });
  });

  test('blocked URL, blocked submitted URL, opted-out host, pending and policy-refused URLs give null', async () => {
    const f = setup();
    await f.addRun('blocked', A);
    await f.cat.setRule('url', A, true, 'Fixture block', 'operator@example.org');
    await f.addRun('via', 'https://d.example.org/', { submittedUrl: 'https://e.example.org/' });
    await f.cat.setRule('url', 'https://e.example.org/', true, 'Fixture block', 'operator@example.org');
    await f.addRun('opted', 'https://opted.example.net/');
    await f.addRun('pending', B, { status: 'pending_review' });
    const { post } = app(f, { optedOut: ['opted.example.net'] });
    const urls = [
      A,
      'https://d.example.org/',
      'https://opted.example.net/',
      B,
      'http://127.0.0.1/',
      'ftp://x/',
    ];
    const body = (await (await post({ urls })).json()) as { items: { stageId: string | null }[] };
    expect(body.items.map((i) => i.stageId)).toEqual([null, null, null, null, null, null]);
  });

  test('the kill switch answers all-null without touching D1', async () => {
    const f = setup();
    await f.addRun('a', A);
    f.cache.set('kill:portal-previews', '1');
    const { post, catalogCalls } = app(f);
    const res = await post({ urls: [A] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ url: A, stageId: null }] });
    expect(catalogCalls).toEqual([]);
  });

  test('limits: 0 URLs, too many URLs, an over-long URL, junk and an over-cap body are refused', async () => {
    const f = setup();
    const { post } = app(f);
    expect((await post({ urls: [] })).status).toBe(400);
    expect(
      (await post({ urls: Array.from({ length: MAX_PORTALS + 1 }, (_, i) => `https://e${i}.example/`) }))
        .status,
    ).toBe(400);
    expect((await post({ urls: [`https://example.com/${'a'.repeat(2048)}`] })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post({ urls: ['x'.repeat(20 * 1024)] })).status).toBe(413);
    const ok = await post({
      urls: Array.from({ length: MAX_PORTALS }, (_, i) => `https://e${i}.example/${'a'.repeat(2000)}`),
    });
    expect(ok.status).toBe(200);
  });

  test('D1 reads per lookup stay bounded (measured for the build log)', async () => {
    const f = setup();
    for (const [i, url] of [A, B].entries()) await f.addRun(`r${i}`, url);
    let reads = 0;
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    (f.env.DB as { prepare: typeof prepare }).prepare = (sql: string) => {
      reads++;
      return prepare(sql);
    };
    const { post } = app(f);
    const urls = Array.from({ length: MAX_PORTALS }, (_, i) => (i % 2 ? A : B));
    await post({ urls });
    console.info(`[portal-previews] ${reads} D1 statements for ${urls.length} URLs`);
    expect(reads).toBeLessThanOrEqual(urls.length * 9);
  });
});
