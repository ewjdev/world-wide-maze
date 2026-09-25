import { describe, expect, test } from 'vitest';
import { handleRooms, ROOM_CODE_ATTEMPTS, randomRoomCode } from '../src/routes/rooms.ts';

/** Fake ROOM namespace: `taken` codes refuse `claim`, and every call is recorded. */
function fakeEnv(taken: Set<string>) {
  const claims: string[] = [];
  const fetched: string[] = [];
  const ROOM = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      async claim(code: string) {
        expect(code).toBe(id);
        claims.push(code);
        if (taken.has(code)) return false;
        taken.add(code);
        return true;
      },
      async fetch(req: Request) {
        fetched.push(`${id} ${new URL(req.url).pathname}`);
        return new Response('ok');
      },
    }),
  };
  return { env: { ROOM }, claims, fetched };
}

/** Deterministic random stream yielding the given codes in order. */
function codes(...cs: number[]) {
  let i = 0;
  return () => ((cs[i++ % cs.length] ?? 100000) - 100000 + 0.5) / 900000;
}

describe('room code allocation', () => {
  test('codes are 6 digits without a leading zero', () => {
    expect(randomRoomCode(() => 0)).toBe('100000');
    expect(randomRoomCode(() => 0.999999999)).toBe('999999');
    for (let i = 0; i < 200; i++) expect(randomRoomCode()).toMatch(/^[1-9]\d{5}$/);
  });

  test('retries on collision until a free code is claimed', async () => {
    const { env, claims } = fakeEnv(new Set(['111111', '222222']));
    const res = await handleRooms(new Request('http://x/api/rooms', { method: 'POST' }), env, {
      random: codes(111111, 222222, 333333),
    });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ code: '333333' });
    expect(claims).toEqual(['111111', '222222', '333333']);
  });

  test('gives up with 503 after too many collisions', async () => {
    const { env, claims } = fakeEnv(new Set(['111111']));
    const res = await handleRooms(new Request('http://x/api/rooms', { method: 'POST' }), env, {
      random: codes(111111),
    });
    expect(res?.status).toBe(503);
    expect(claims).toHaveLength(ROOM_CODE_ATTEMPTS);
  });

  test('routes ws/stats to the DO for that code and validates input', async () => {
    const { env, fetched } = fakeEnv(new Set());
    const ws = await handleRooms(
      new Request('http://x/api/rooms/123456/ws?role=host', { headers: { Upgrade: 'websocket' } }),
      env,
    );
    expect(ws?.status).toBe(200);
    await handleRooms(new Request('http://x/api/rooms/123456/stats'), env);
    expect(fetched).toEqual(['123456 /api/rooms/123456/ws', '123456 /api/rooms/123456/stats']);
    expect((await handleRooms(new Request('http://x/api/rooms/123456/ws'), env))?.status).toBe(426);
    expect((await handleRooms(new Request('http://x/api/rooms/12345/stats'), env))?.status).toBe(400);
    expect((await handleRooms(new Request('http://x/api/rooms/123456/nope'), env))?.status).toBe(404);
    expect((await handleRooms(new Request('http://x/api/rooms'), env))?.status).toBe(405);
    expect(await handleRooms(new Request('http://x/api/stages'), env)).toBeNull();
  });
});
