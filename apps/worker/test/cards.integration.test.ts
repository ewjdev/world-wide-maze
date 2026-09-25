/**
 * Integration (Phase 18): share cards on the real Worker in workerd (wrangler `createTestHarness`, local
 * D1/R2/DO/rate limits, as in scores.integration.test.ts). Every card kind renders to a 1200×630 PNG through
 * resvg-wasm, is cached in R2, and every shareable route answers link-preview crawlers with complete tags.
 * `CARDS_SAVE=1` also writes the Worker-rendered PNGs to docs/build-log/assets/share-cards/worker-*.png.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHYSICS_VERSION } from '@wwm/physics';
import type { StageData } from '@wwm/schema';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const configPath = resolve(root, 'apps/worker/wrangler.jsonc');
const stage = JSON.parse(
  readFileSync(resolve(root, 'fixtures/stages/handmade-simple.json'), 'utf8'),
) as StageData;
const texturePng = readFileSync(resolve(root, 'fixtures/stages/handmade-simple.png'));
const inputs = JSON.parse(
  readFileSync(resolve(root, 'fixtures/replays/handmade-simple.keyboard.json'), 'utf8'),
);
const REPLAY_SCORE = 1479;
/** A "real" website stage: the same geometry under an https URL, with its capture screenshot in R2. */
const web: StageData = {
  ...stage,
  stageId: 'd'.repeat(64),
  source: {
    ...stage.source,
    url: 'https://news.example.org/front',
    title: 'Example News',
    captureId: 'cap-web',
  },
};

const CRAWLERS = {
  linkedin: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  twitter: 'Twitterbot/1.0',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
} as const;

function pngInfo(b: Uint8Array) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { sig, width: dv.getUint32(16), height: dv.getUint32(20) };
}

function b64url(s: string) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The tags a link unfurl needs, pulled out of an HTML page. */
function tags(html: string) {
  const meta = (attr: 'property' | 'name', key: string) =>
    new RegExp(`<meta ${attr}="${key.replace(/[:.]/g, '\\$&')}" content="([^"]*)">`).exec(html)?.[1] ?? null;
  return {
    title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null,
    canonical: /<link rel="canonical" href="([^"]*)">/.exec(html)?.[1] ?? null,
    ogTitle: meta('property', 'og:title'),
    ogDescription: meta('property', 'og:description'),
    ogUrl: meta('property', 'og:url'),
    ogImage: meta('property', 'og:image'),
    ogImageWidth: meta('property', 'og:image:width'),
    ogImageHeight: meta('property', 'og:image:height'),
    ogImageAlt: meta('property', 'og:image:alt'),
    twitterCard: meta('name', 'twitter:card'),
    twitterImage: meta('name', 'twitter:image'),
  };
}

const unesc = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

describe('share cards (workerd)', () => {
  const server = createTestHarness();
  let ipSeq = 0;
  const newIp = () => `198.51.100.${++ipSeq}`;
  const get = (path: string, ua = 'vitest', ip = newIp()) =>
    server.fetch(`http://localhost${path}`, {
      redirect: 'manual',
      headers: { 'cf-connecting-ip': ip, 'user-agent': ua },
    });
  const post = (body: unknown) =>
    server.fetch('http://localhost/api/scores', {
      method: 'POST',
      headers: { 'cf-connecting-ip': newIp(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const saved: Record<string, Uint8Array> = {};
  let stageScoreId = '';
  let unverifiedScoreId = '';
  let runScoreId = '';

  beforeAll(async () => {
    await server.update({ workers: [{ configPath }] });
    await server.listen();
    const w = server.getWorker<{
      STAGES: { put(key: string, value: string | Uint8Array): Promise<unknown> };
      DB: { prepare(q: string): { bind(...a: unknown[]): { run(): Promise<unknown> } } };
    }>();
    await w.applyD1Migrations('DB' as never);
    const env = await w.getEnv();
    for (const s of [stage, web]) await env.STAGES.put(`stages/${s.stageId}.json`, JSON.stringify(s));
    await env.STAGES.put('captures/cap-web/screenshot.png', new Uint8Array(texturePng));
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO runs (run_id, url, title, capture_id, slice_count, difficulty, seed, builder_version, status, created_at)
       VALUES (?1, ?2, ?3, 'cap-web', 1, 'normal', 1, 'x', 'complete', ?4)`,
    )
      .bind('run-web', web.source.url, web.source.title, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO stages (stage_id, run_id, slice_index, url, title, capture_id, builder_version, texture_key,
         islands, bridges, elevators, items, created_at)
       VALUES (?1, 'run-web', 0, ?2, ?3, 'cap-web', 'x', 'textures/cap-web/0.webp', 4, 3, 1, 11, ?4)`,
    )
      .bind(web.stageId, web.source.url, web.source.title, now)
      .run();

    const verified = await post({
      kind: 'stage',
      stageId: web.stageId,
      name: 'cocktail_hancock',
      score: REPLAY_SCORE,
      timeMs: 45_300,
      replay: { physicsVersion: PHYSICS_VERSION, inputs },
    });
    expect(verified.status).toBe(201);
    const vb = (await verified.json()) as { scoreId: string; verified: boolean };
    expect(vb.verified).toBe(true);
    expect(vb.scoreId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    stageScoreId = vb.scoreId;
    const plain = await post({
      kind: 'stage',
      stageId: web.stageId,
      name: 'plain_ann',
      score: 300,
      timeMs: 90_000,
    });
    unverifiedScoreId = ((await plain.json()) as { scoreId: string }).scoreId;
    const run = await post({
      kind: 'run',
      name: 'saqoosha_fan',
      totalScore: REPLAY_SCORE + 300,
      stages: [
        { stageId: web.stageId, score: REPLAY_SCORE, timeMs: 45_300 },
        { stageId: stage.stageId, score: 300, timeMs: 90_000 },
      ],
    });
    expect(run.status).toBe(201);
    runScoreId = ((await run.json()) as { scoreId: string }).scoreId;
    expect(runScoreId).toMatch(/^[A-Za-z0-9_-]{16}$/);
  }, 180_000);

  afterAll(async () => {
    if (process.env.CARDS_SAVE) {
      const out = resolve(root, 'docs/build-log/assets/share-cards');
      mkdirSync(out, { recursive: true });
      for (const [k, v] of Object.entries(saved)) writeFileSync(resolve(out, `worker-${k}.png`), v);
    }
    await server.close();
  }, 60_000);

  const timings: Record<string, number> = {};
  const requestMs: Record<string, number> = {};
  const journeyTrail = b64url(
    JSON.stringify({
      v: 1,
      s: [
        ['news.ycombinator.com', 'Hacker News'],
        ['grantland.com', 'The Board Game of the Alpha Nerds'],
        ['en.wikipedia.org', 'Maze', web.stageId], // a server stage: its real host wins
        ['python.org', 'Python'],
      ],
      p: 4200,
      n: 'roller',
    }),
  );

  const cases: [string, () => string][] = [
    ['stage', () => `/api/cards/stage/${web.stageId}.png`],
    ['stage-fixture', () => `/api/cards/stage/${stage.stageId}.png`],
    ['score', () => `/api/cards/score/${stageScoreId}.png`],
    ['score-unverified', () => `/api/cards/score/${unverifiedScoreId}.png`],
    ['run', () => `/api/cards/run/${runScoreId}.png`],
    ['journey', () => `/api/cards/journey/${journeyTrail}.png`],
    ['site', () => '/api/cards/site/default.png'],
  ];

  test.each(cases)(
    '%s card renders to a 1200×630 PNG and is then served from R2',
    async (name, path) => {
      const t0 = performance.now();
      const r = await get(path());
      requestMs[name] = Math.round(performance.now() - t0);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/png');
      expect(r.headers.get('x-card')).toBe('render');
      expect(r.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      timings[name] = Number(r.headers.get('x-render-ms'));
      const png = new Uint8Array(await r.arrayBuffer());
      expect(pngInfo(png)).toEqual({ sig: true, width: 1200, height: 630 });
      expect(png.byteLength).toBeGreaterThan(20_000); // not a blank image
      saved[name] = png;
      // R2 put happens in waitUntil; the next request is a cache hit with the same bytes
      let again = await get(path());
      for (let i = 0; i < 20 && again.headers.get('x-card') !== 'hit'; i++) {
        await new Promise((res) => setTimeout(res, 100));
        again = await get(path());
      }
      expect(again.headers.get('x-card')).toBe('hit');
      expect(new Uint8Array(await again.arrayBuffer())).toEqual(png);
    },
    60_000,
  );

  test('render timings (logged for the build log)', () => {
    process.stdout.write(`\n[phase-18] card render ms in workerd: ${JSON.stringify(timings)}\n`);
    process.stdout.write(
      `[phase-18] first request (load + art + render + R2 read) ms: ${JSON.stringify(requestMs)}\n`,
    );
    expect(Object.keys(timings).length).toBe(cases.length);
  });

  test('unknown ids and kinds are 404; the ?v= version makes the image immutable', async () => {
    expect((await get('/api/cards/score/AAAAAAAAAAAAAAAA.png')).status).toBe(404);
    expect((await get(`/api/cards/stage/${'e'.repeat(64)}.png`)).status).toBe(404);
    expect((await get('/api/cards/nope/x.png')).status).toBe(404);
    expect((await get('/api/cards/site/other.png')).status).toBe(404);
    const page = await (await get(`/s/${web.stageId}`)).text();
    const img = new URL(unesc(tags(page).ogImage ?? ''));
    const r = await get(img.pathname + img.search);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const stale = await get(`${img.pathname}?v=0000000000000000`);
    expect(stale.headers.get('cache-control')).toBe('public, max-age=600');
  });

  describe.each(Object.entries(CRAWLERS))('crawler %s', (_bot, ua) => {
    const pages: [string, () => string, (t: ReturnType<typeof tags>) => void][] = [
      [
        'stage invite',
        () => `/s/${web.stageId}`,
        (t) => expect(t.ogTitle).toBe('Play Example News as a maze'),
      ],
      [
        'stage score',
        () => `/s/${web.stageId}/r/${stageScoreId}`,
        (t) => {
          expect(t.ogTitle).toBe('cocktail_hancock scored 1,479 on Example News. Can you beat it?');
          expect(t.ogDescription).toContain('#1 on this maze (replay verified)');
        },
      ],
      [
        'unverified score',
        () => `/s/${web.stageId}/r/${unverifiedScoreId}`,
        (t) => {
          expect(t.ogTitle).toBe('plain_ann scored 300 on Example News. Can you beat it?');
          expect(t.ogDescription).not.toContain('verified');
        },
      ],
      [
        'run',
        () => `/r/${runScoreId}`,
        (t) => {
          expect(t.ogTitle).toBe('saqoosha_fan is #1 on the World Wide Maze leaderboard');
          expect(t.ogDescription).toContain('1,779 points');
        },
      ],
      [
        'journey',
        () => `/j/${journeyTrail}`,
        (t) => {
          expect(t.ogTitle).toBe('roller’s web journey: 4 sites turned into mazes');
          expect(t.ogDescription).toContain(
            'news.ycombinator.com → grantland.com → news.example.org → python.org',
          );
        },
      ],
      ['home', () => '/', (t) => expect(t.ogTitle).toContain('World Wide Maze')],
      ['build log', () => '/log', (t) => expect(t.ogImage).toBe('http://localhost/og/log.png')],
    ];
    test.each(pages)('%s: complete Open Graph + Twitter tags', async (_name, path, check) => {
      const r = await get(path(), ua);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/html');
      const t = tags(await r.text());
      for (const [k, v] of Object.entries(t)) expect(v, k).toBeTruthy();
      expect(t.twitterCard).toBe('summary_large_image');
      expect(t.ogImageWidth).toBe('1200');
      expect(t.ogImageHeight).toBe('630');
      expect(t.ogUrl).toBe(t.canonical);
      expect(t.canonical).toBe(`http://localhost${path()}`);
      expect(t.ogImage).toMatch(/^http:\/\/localhost\//);
      expect(t.twitterImage).toBe(t.ogImage);
      check(t);
    });
  });

  test('link parameters never reach a preview: ?beat=&by= keeps the plain invite', async () => {
    const r = await get(`/s/${web.stageId}?beat=999999&by=spoofer`, CRAWLERS.linkedin);
    const html = await r.text();
    const t = tags(html);
    expect(t.ogTitle).toBe('Play Example News as a maze');
    expect(html).not.toContain('999,999');
    expect(t.ogImage).toContain(`/api/cards/stage/${web.stageId}.png?v=`);
    expect(t.ogImage).not.toContain('beat');
    // the game still gets the challenge
    expect(html).toContain(`/play/${web.stageId}?beat=999999&amp;by=spoofer`);
    // score permalinks pass the SERVER's values on to the game
    const s = await (await get(`/s/${web.stageId}/r/${stageScoreId}`)).text();
    expect(s).toContain(`/play/${web.stageId}?beat=1479&amp;by=cocktail_hancock`);
    // a score id under the wrong stage is not found
    expect((await get(`/s/${stage.stageId}/r/${stageScoreId}`)).status).toBe(404);
  });

  test('journey links are distrusted: implausible totals and bad names are dropped, text is escaped', async () => {
    const trail = b64url(
      JSON.stringify({
        v: 1,
        s: [
          ['evil.example', '<script>alert(1)</script>'],
          ['fuck.example', 'x'],
        ],
        p: 99_999_999,
        n: 'sh1t_head',
      }),
    );
    const html = await (await get(`/j/${trail}`, CRAWLERS.twitter)).text();
    const t = tags(html);
    expect(html).not.toContain('<script>alert');
    expect(t.ogDescription).not.toContain('99,999,999');
    expect(t.ogTitle).toBe('A web journey: 2 sites turned into mazes');
    expect(t.ogDescription).toContain('evil.example → another site');
    const bad = await get('/j/not-a-trail!', CRAWLERS.twitter);
    expect(bad.status).toBe(404); // no assets in tests; in production the app shows its "invalid link" page
  });

  test('pairing links stay generic: /c/* is not a Worker route', async () => {
    const r = await get('/c/123456', CRAWLERS.slack);
    expect(r.status).toBe(404); // assets-only route (the app shell's generic tags in production)
  });
});
