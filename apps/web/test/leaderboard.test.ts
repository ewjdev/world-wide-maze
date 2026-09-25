/**
 * Phase 08b: the game's boards — Phase 10's HTTP client with the device fallback (offline / stages the server
 * doesn't know / 5xx), the replay-less resend on a replay mismatch, and the device board's ordering.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  GameBoards,
  type KeyValueStore,
  LocalRankingClient,
  rankOf,
  rankRows,
} from '../src/game/leaderboard.ts';

const HEX = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const at = '2026-09-25T10:00:00.000Z';

function store(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function boardsWith(handler: Handler) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return handler(url, init);
  });
  const boards = new GameBoards({ fetch: f as unknown as typeof fetch, store: store(), timeoutMs: 1000 });
  return { boards, calls };
}

describe('device board', () => {
  test('best entry per name, score desc then time asc; ranks', async () => {
    const lb = new LocalRankingClient(store(), () => new Date(at));
    expect((await lb.submitRun({ name: 'a', totalScore: 500, stages: [] })).ok).toBe(true);
    await lb.submitRun({ name: 'b', totalScore: 900, stages: [] });
    const c = await lb.submitRun({ name: 'c', totalScore: 100, stages: [] });
    expect(c).toMatchObject({ ok: true, rank: 3, stored: 'device' });
    await lb.submitRun({ name: 'a', totalScore: 200, stages: [] }); // worse than a's 500: not a new row
    expect((await lb.runBoard()).map((e) => [e.name, e.score])).toEqual([
      ['b', 900],
      ['a', 500],
      ['c', 100],
    ]);
    await lb.submitStage({ stageId: 's', name: 'a', score: 10, timeMs: 2000 });
    await lb.submitStage({ stageId: 's', name: 'b', score: 10, timeMs: 1000 });
    expect((await lb.stageBoard('s')).map((e) => e.name)).toEqual(['b', 'a']);
    expect((await lb.submitStage({ stageId: 's', name: 'Bad Name', score: 1, timeMs: 1 })).ok).toBe(false);
    expect(await lb.ghost()).toBeNull();
  });
  test('rankOf / rankRows', () => {
    const rows = [
      { name: 'x', score: 10, timeMs: 5, at },
      { name: 'y', score: 10, timeMs: 3, at },
      { name: 'x', score: 4, timeMs: 1, at },
    ];
    expect(rankRows(rows).map((e) => e.name)).toEqual(['y', 'x']);
    expect(rankOf(rows, 'z', 10, 4)).toBe(2);
    expect(rankOf(rows, 'z', 11)).toBe(1);
  });
});

describe('GameBoards', () => {
  test('whereStage: server only for stages that came from the Worker; no probing requests', async () => {
    const { boards, calls } = boardsWith(() => json({}));
    expect(boards.whereStage(HEX, true)).toBe('server');
    expect(boards.whereStage(HEX, false)).toBe('device');
    expect(boards.whereStage('practice', true)).toBe('device');
    const s = (stageId: string, fromServer: boolean) => ({ stageId, fromServer });
    expect(boards.whereRun([s(HEX, true), s(OTHER, false)])).toBe('device');
    expect(boards.whereRun([s(HEX, true), s(OTHER, true)])).toBe('server');
    expect(boards.whereRun([])).toBe('device');
    expect(calls).toHaveLength(0);
  });

  test('server submission: 201 → stored on the server', async () => {
    const { boards, calls } = boardsWith(() => json({ rank: 2, verified: true }, 201));
    const r = await boards.submitStage({ stageId: HEX, name: 'ana', score: 50, timeMs: 9000 }, 'server');
    expect(r).toMatchObject({ ok: true, rank: 2, verified: true, stored: 'server' });
    expect(calls[0]?.body).toMatchObject({ kind: 'stage', stageId: HEX, name: 'ana' });
  });

  test('network failure → saved on the device, and the server is skipped for a while', async () => {
    const { boards, calls } = boardsWith(() => {
      throw new TypeError('Failed to fetch');
    });
    const r = await boards.submitRun({ name: 'ana', totalScore: 70, stages: [] }, 'server');
    expect(r).toMatchObject({ ok: true, rank: 1, stored: 'device' });
    expect(boards.offline).toBe(true);
    expect(boards.whereStage(HEX, true)).toBe('device');
    expect(calls).toHaveLength(1);
    expect((await boards.device.runBoard())[0]?.name).toBe('ana');
  });

  test('unknown stage (404) and 5xx fall back to the device; player errors do not', async () => {
    let status = 404;
    const { boards } = boardsWith(() => json({ error: 'x', message: 'x' }, status));
    expect(
      await boards.submitStage({ stageId: HEX, name: 'ana', score: 1, timeMs: 1 }, 'server'),
    ).toMatchObject({
      ok: true,
      stored: 'device',
    });
    status = 503;
    expect((await boards.submitRun({ name: 'ana', totalScore: 1, stages: [] }, 'server')).ok).toBe(true);
    status = 429;
    expect(await boards.submitRun({ name: 'ana', totalScore: 1, stages: [] }, 'server')).toMatchObject({
      ok: false,
      error: 'rate-limited',
    });
  });

  test('a replay mismatch (422) is resent once without the replay (stored unverified)', async () => {
    const { boards, calls } = boardsWith((_u, init) => {
      const body = JSON.parse(String(init?.body));
      return body.replay
        ? json({ error: 'replay mismatch', message: 'the replay reproduces 10 points, not 25' }, 422)
        : json({ rank: 4 }, 201);
    });
    const replay = {
      physicsVersion: '0.1.0',
      inputs: [{ tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false }],
    };
    const r = await boards.submitStage(
      { stageId: HEX, name: 'ana', score: 25, timeMs: 9000, replay },
      'server',
    );
    expect(r).toMatchObject({ ok: true, rank: 4, verified: false });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).not.toHaveProperty('replay');
  });

  test('ghost: asked for only when the stage board has entries (a 404 would log a console error)', async () => {
    const ghost = { name: 'kai', score: 99, timeMs: 1000, physicsVersion: '0.1.0', inputs: [] };
    let entries: unknown[] = [];
    const { boards, calls } = boardsWith((url) => (url.endsWith('/ghost') ? json(ghost) : json({ entries })));
    expect(await boards.ghost(HEX)).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/ghost'))).toBe(false);
    entries = [{ name: 'kai', score: 99, at }];
    expect(await boards.ghost(HEX)).toEqual(ghost);
    expect(await boards.ghost('practice')).toBeNull();
  });

  test('rankFor: the rank a total would get before submission', async () => {
    const { boards } = boardsWith(() => json({ entries: [{ name: 'x', score: 100, at }] }));
    expect(await boards.rankFor(50, 'server')).toBe(2);
    expect(await boards.rankFor(150, 'server')).toBe(1);
    expect(await boards.rankFor(100, 'server')).toBe(2); // a tie ranks behind the earlier entry
  });
});
