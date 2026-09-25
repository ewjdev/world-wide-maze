/**
 * Integration (Phase 10): leaderboards and share pages on the real Worker in workerd (wrangler's
 * `createTestHarness`, same approach as worker.integration.test.ts), with local D1/R2/DO/rate limits.
 * No browser is needed: the stage is seeded straight into R2 (the `handmade-simple` fixture).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHYSICS_VERSION } from '@wwm/physics';
import { type ScoresResponse, type StageData, TIME_SCORE } from '@wwm/schema';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { SUBMIT_LIMIT, stageLimits } from '../src/routes/scores-rules.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const configPath = resolve(root, 'apps/worker/wrangler.jsonc');
const stage = JSON.parse(
  readFileSync(resolve(root, 'fixtures/stages/handmade-simple.json'), 'utf8'),
) as StageData;
const inputs = JSON.parse(
  readFileSync(resolve(root, 'fixtures/replays/handmade-simple.keyboard.json'), 'utf8'),
);
const limits = stageLimits(stage);
/** The fixture replay collects 9 small + 2 large and reaches the goal at tick 5429 (checked in Node). */
const REPLAY_SCORE = 1479;
const other = { ...stage, stageId: 'b'.repeat(64) };

describe('scores + share (workerd)', () => {
  const server = createTestHarness();
  let ipSeq = 0;
  const newIp = () => `203.0.113.${++ipSeq}`;
  const api = (path: string, ip: string, init: { method?: string; body?: string } = {}) =>
    server.fetch(`http://localhost${path}`, {
      ...init,
      redirect: 'manual',
      headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
    });
  const submit = (body: unknown, ip = newIp()) =>
    api('/api/scores', ip, { method: 'POST', body: JSON.stringify(body) });
  const stageScore = (name: string, score: number, timeMs = 60_000, extra: object = {}) =>
    submit({ kind: 'stage', stageId: stage.stageId, name, score, timeMs, ...extra });
  const board = async (path: string) => ((await (await api(path, newIp())).json()) as ScoresResponse).entries;

  beforeAll(async () => {
    await server.update({ workers: [{ configPath }] });
    await server.listen();
    const w = server.getWorker<{ STAGES: { put(key: string, value: string): Promise<unknown> } }>();
    await w.applyD1Migrations('DB' as never);
    const env = await w.getEnv();
    for (const s of [stage, other]) await env.STAGES.put(`stages/${s.stageId}.json`, JSON.stringify(s));
  }, 120_000);

  afterAll(async () => {
    await server.close();
  });

  test('curated table exists and /api/curated reads it (empty until approval)', async () => {
    const r = await api('/api/curated', newIp());
    expect(await r.json()).toEqual({ runs: [] });
  });

  test('name validation: format and profanity', async () => {
    for (const name of ['', 'Bad Name', 'UPPER', 'x'.repeat(33), 'dash-y', 'émile']) {
      const r = await stageScore(name, 10);
      expect(r.status, name).toBe(400);
    }
    for (const name of ['fuck', 'sh1t_head', 'a55hole', 'n_a_z_i']) {
      const r = await stageScore(name, 10);
      expect(r.status, name).toBe(400);
      expect(await r.json()).toMatchObject({ reason: 'profanity' });
    }
    expect((await stageScore('cocktail_hancock', 10)).status).toBe(201);
  });

  test('plausibility: score above the stage maximum and impossible times are rejected', async () => {
    const tooHigh = await stageScore('greedy', limits.maxScore + 1);
    expect(tooHigh.status).toBe(422);
    expect(((await tooHigh.json()) as { message: string }).message).toContain('maximum');
    const tooFast = await stageScore('speedy', 50, Math.floor(limits.minTimeMs) - 1);
    expect(tooFast.status).toBe(422);
    expect(((await tooFast.json()) as { message: string }).message).toContain('physically');
    expect((await stageScore('fair', limits.maxScore, Math.ceil(limits.minTimeMs))).status).toBe(201);
    const unknown = await submit({
      kind: 'stage',
      stageId: 'c'.repeat(64),
      name: 'x',
      score: 1,
      timeMs: 9e4,
    });
    expect(unknown.status).toBe(404);
  });

  test('rate limit: submissions per IP per window', async () => {
    const ip = newIp();
    const statuses: number[] = [];
    for (let i = 0; i <= SUBMIT_LIMIT; i++)
      statuses.push(
        (await submit({ kind: 'stage', stageId: other.stageId, name: `rl${i}`, score: 1, timeMs: 9e4 }, ip))
          .status,
      );
    expect(statuses.slice(0, SUBMIT_LIMIT).every((s) => s === 201)).toBe(true);
    const last = await submit(
      { kind: 'stage', stageId: other.stageId, name: 'rlx', score: 1, timeMs: 9e4 },
      ip,
    );
    expect(last.status).toBe(429);
    expect(last.headers.get('retry-after')).toBeTruthy();
    expect(await last.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });

  test('top-N ordering: score desc, then time asc; one row per name (their best); rank returned', async () => {
    const id = other.stageId;
    const put = (name: string, score: number, timeMs: number) =>
      submit({ kind: 'stage', stageId: id, name, score, timeMs });
    await put('alice', 300, 90_000);
    await put('bob', 500, 80_000);
    await put('carol', 500, 70_000);
    await put('alice', 200, 60_000); // worse than her 300: must not replace it
    const r = await put('dave', 400, 60_000);
    expect(await r.json()).toMatchObject({ rank: 3 }); // behind carol and bob
    const entries = await board(`/api/scores/stage/${id}`);
    const named = entries.filter((e) => ['alice', 'bob', 'carol', 'dave'].includes(e.name));
    expect(named.map((e) => [e.name, e.score])).toEqual([
      ['carol', 500],
      ['bob', 500],
      ['dave', 400],
      ['alice', 300],
    ]);
    expect(entries.length).toBeLessThanOrEqual(50);
    expect(entries[0]).toHaveProperty('at');
    for (let i = 1; i < entries.length; i++)
      expect((entries[i - 1] as { score: number }).score).toBeGreaterThanOrEqual(
        (entries[i] as { score: number }).score,
      );
  });

  test('board is capped at 50', async () => {
    const id = other.stageId;
    for (let i = 0; i < 55; i++)
      await submit({ kind: 'stage', stageId: id, name: `cap${i}`, score: 2 + i, timeMs: 9e4 });
    expect((await board(`/api/scores/stage/${id}`)).length).toBe(50);
  });

  test('replay verification: matching replay is verified and becomes the ghost; a lie is rejected', async () => {
    const replay = { physicsVersion: PHYSICS_VERSION, inputs };
    const t0 = performance.now();
    const ok = await stageScore('replayer', REPLAY_SCORE, 45_300, { replay });
    const ms = performance.now() - t0;
    expect(ok.status).toBe(201);
    const okBody = await ok.json();
    expect(okBody).toMatchObject({ verified: true });
    process.stdout.write(
      `\n[phase-10] verified a ${inputs.length}-tick replay in workerd, request took ${ms.toFixed(0)} ms\n`,
    );

    const lie = await stageScore('liar', REPLAY_SCORE + 100, 45_300, { replay });
    expect(lie.status).toBe(422);
    expect(await lie.json()).toMatchObject({ error: 'replay mismatch' });

    const old = await stageScore('oldphys', REPLAY_SCORE - TIME_SCORE, 45_300, {
      replay: { physicsVersion: '0.0.0-old', inputs },
    });
    expect(await old.json()).toMatchObject({ verified: false });
    const bare = await stageScore('bare', REPLAY_SCORE, 45_300, { replay: inputs.slice(0, 10) });
    expect(await bare.json()).toMatchObject({ verified: false });

    const ghost = await api(`/api/scores/stage/${stage.stageId}/ghost`, newIp());
    expect(ghost.status).toBe(200);
    const g = (await ghost.json()) as { name: string; physicsVersion: string; inputs: unknown[] };
    expect(g.name).toBe('replayer');
    expect(g.physicsVersion).toBe(PHYSICS_VERSION);
    expect(g.inputs).toHaveLength(inputs.length);
  }, 60_000);

  test('run board: totals must add up, per-stage plausibility, global ordering', async () => {
    const mismatch = await submit({
      kind: 'run',
      name: 'runner',
      totalScore: 999,
      stages: [{ stageId: stage.stageId, score: 100, timeMs: 60_000 }],
    });
    expect(mismatch.status).toBe(422);
    const tooHigh = await submit({
      kind: 'run',
      name: 'runner',
      totalScore: limits.maxScore + 5,
      stages: [{ stageId: stage.stageId, score: limits.maxScore + 5, timeMs: 60_000 }],
    });
    expect(tooHigh.status).toBe(422);
    // Last stage = game over: items only, any time. Earlier stages must be finished in a plausible time.
    const ok = await submit({
      kind: 'run',
      name: 'runner',
      totalScore: 1400,
      stages: [
        { stageId: stage.stageId, score: 1300, timeMs: 60_000 },
        { stageId: other.stageId, score: 100, timeMs: 10 },
      ],
    });
    expect(ok.status).toBe(201);
    // Phase 18: + the entry's permalink id (`/r/<scoreId>`)
    expect(await ok.json()).toEqual({ rank: 1, scoreId: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/) });
    await submit({
      kind: 'run',
      name: 'second',
      totalScore: 20,
      stages: [{ stageId: stage.stageId, score: 20, timeMs: 60_000 }],
    });
    const entries = await board('/api/scores/run');
    expect(entries.map((e) => e.name)).toEqual(['runner', 'second']);
    expect(entries[0]).toMatchObject({ score: 1400, timeMs: 60_010 });
  });

  test('share page: OG/Twitter tags, beat param, escaping; card falls back to the texture', async () => {
    const r = await api(`/s/${stage.stageId}?beat=1479&by=replayer`, newIp());
    expect(r.status).toBe(200);
    const html = await r.text();
    // Phase 18: the rendered invite card; link parameters stay out of the preview (no spoofable numbers)…
    expect(html).toContain(
      `<meta property="og:image" content="http://localhost/api/cards/stage/${stage.stageId}.png?v=`,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).not.toContain('1,479');
    expect(html).not.toContain('replayer’s');
    // …but still reach the game's challenge banner.
    expect(html).toContain(`/play/${stage.stageId}?beat=1479&amp;by=replayer`);
    const evil = await (await api(`/s/${stage.stageId}?beat=1&by=%3Cscript%3E`, newIp())).text();
    expect(evil).not.toContain('<script>');
    expect((await api('/s/nope', newIp())).status).toBe(404);
    const card = await api(`/api/share/${stage.stageId}/card`, newIp());
    expect(card.status).toBe(302);
    expect(card.headers.get('location')).toBe(`/api/stages/${stage.stageId}/texture`);
  });
});
