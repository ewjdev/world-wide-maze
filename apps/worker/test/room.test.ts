/**
 * Room Durable Object integration tests: the real Worker + DO running in workerd via Miniflare
 * (`wrangler`'s `unstable_startWorker`), driven over real WebSockets from Node.
 * (`@cloudflare/vitest-pool-workers` peers on Vitest 4; this repo is on Vitest 5.)
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeInput, encodeInput } from '@wwm/schema';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

type Worker = Awaited<ReturnType<typeof import('wrangler').unstable_startWorker>>;

const IDLE_MS = 2500;
/**
 * CI stability: how long to wait for a message or condition. These are deadlines, not delays (a wait returns as soon
 * as the condition holds), so they are generous: loaded CI runners run every Vitest project in parallel.
 */
const WAIT_MS = 10_000;
/** Per-test timeout (Vitest's default 5 s is too tight for real workerd round trips on a loaded runner). */
const TEST_MS = 30_000;
let worker: Worker;
let base: string;

beforeAll(async () => {
  const { unstable_startWorker } = await import('wrangler');
  worker = await unstable_startWorker({
    config: resolve(dirname(fileURLToPath(import.meta.url)), '../wrangler.jsonc'),
    dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, persist: false, logLevel: 'warn' },
    // Short intervals so expiry and keepalive RTT can be observed in a test run.
    bindings: {
      ROOM_IDLE_EXPIRY_MS: { type: 'plain_text', value: String(IDLE_MS) },
      ROOM_KEEPALIVE_MS: { type: 'plain_text', value: '250' },
    },
  } as Parameters<typeof unstable_startWorker>[0]);
  await worker.ready;
  base = (await worker.url).toString().replace(/\/$/, '');
}, 60_000);

afterAll(async () => {
  await worker?.dispose();
});

/** Node's (undici) browser-style WebSocket; this project's types are the Workers runtime's. */
interface NodeWebSocket {
  readonly readyState: number;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number): void;
}
const NodeWS = (globalThis as unknown as { WebSocket: new (url: string) => NodeWebSocket }).WebSocket;
const OPEN = 1;

interface Client {
  ws: NodeWebSocket;
  texts: Record<string, unknown>[];
  frames: ArrayBuffer[];
  closed: Promise<{ code: number; reason: string }>;
  next(pred: (m: Record<string, unknown>) => boolean, ms?: number): Promise<Record<string, unknown>>;
}

interface Room {
  code: string;
  hostToken: string;
  pairToken: string;
}

/** `token`: a string to send, or omitted (typed-code controller / missing host token). */
function connect(code: string, role: string, token?: string, answerPings = true): Promise<Client> {
  return new Promise((resolve, reject) => {
    const q = token === undefined ? '' : `&token=${encodeURIComponent(token)}`;
    const ws = new NodeWS(`${base.replace(/^http/, 'ws')}/api/rooms/${code}/ws?role=${role}${q}`);
    ws.binaryType = 'arraybuffer';
    const texts: Record<string, unknown>[] = [];
    const frames: ArrayBuffer[] = [];
    const waiters: {
      pred: (m: Record<string, unknown>) => boolean;
      res: (m: Record<string, unknown>) => void;
    }[] = [];
    let closeRes: (v: { code: number; reason: string }) => void = () => {};
    const closed = new Promise<{ code: number; reason: string }>((r) => {
      closeRes = r;
    });
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') {
        frames.push(e.data as ArrayBuffer);
        return;
      }
      const m = JSON.parse(e.data) as Record<string, unknown>;
      if (answerPings && m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', id: m.id, ts: m.ts }));
      texts.push(m);
      for (const w of [...waiters]) {
        if (w.pred(m)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.res(m);
        }
      }
    };
    ws.onclose = (e) => closeRes({ code: e.code, reason: e.reason });
    ws.onerror = () => {};
    const client: Client = {
      ws,
      texts,
      frames,
      closed,
      next(pred, ms = WAIT_MS) {
        const hit = texts.find(pred);
        if (hit) {
          texts.splice(texts.indexOf(hit), 1);
          return Promise.resolve(hit);
        }
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout waiting for message')), ms);
          waiters.push({
            pred,
            res: (m) => {
              clearTimeout(t);
              texts.splice(texts.indexOf(m), 1);
              res(m);
            },
          });
        });
      },
    };
    ws.onopen = () => resolve(client);
    setTimeout(() => reject(new Error('connect timeout')), WAIT_MS);
  });
}

async function newRoom(): Promise<Room> {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Room;
  expect(body.code).toMatch(/^\d{6}$/);
  return body;
}
/** Host with its token. */
const hostOf = (r: Room, answerPings = true) => connect(r.code, 'host', r.hostToken, answerPings);
/** Controller that scanned the QR code (pair token). */
const phoneOf = (r: Room, answerPings = true) => connect(r.code, 'controller', r.pairToken, answerPings);

const until = async (cond: () => boolean, ms = WAIT_MS) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};
/** `until` for conditions that need a request (e.g. the stats endpoint). */
const untilAsync = async (cond: () => Promise<boolean>, ms = WAIT_MS) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('condition timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
};

interface RoomStats {
  rtt: Record<string, { count: number; p50: number | null }>;
  input: { frames: number };
  dropped: { rate: number; oversize: number };
}
const statsOf = async (code: string) =>
  (await (await fetch(`${base}/api/rooms/${code}/stats`)).json()) as RoomStats;

describe('Room DO relay', { timeout: TEST_MS }, () => {
  test('POST /api/rooms allocates distinct 6-digit codes', async () => {
    const rooms = await Promise.all(Array.from({ length: 5 }, newRoom));
    expect(new Set(rooms.map((r) => r.code)).size).toBe(5);
    // v0.2.7: two distinct 128-bit base64url tokens per room, never reused.
    const tokens = rooms.flatMap((r) => [r.hostToken, r.pairToken]);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new Set(tokens).size).toBe(10);
  });

  test('relays binary input and JSON both ways, with peer notifications', async () => {
    const room = await newRoom();
    const host = await hostOf(room);
    expect(await host.next((m) => m.t === 'peer')).toEqual({
      t: 'peer',
      role: 'controller',
      connected: false,
    });
    const ctl = await phoneOf(room);
    expect(await ctl.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'host', connected: true });
    expect(await host.next((m) => m.t === 'peer')).toEqual({
      t: 'peer',
      role: 'controller',
      connected: true,
    });

    ctl.ws.send(encodeInput({ seq: 42, power: true, jump: false, menu: true, tiltX: 0.25, tiltZ: -0.5 }));
    ctl.ws.send(JSON.stringify({ t: 'calibrated' }));
    host.ws.send(JSON.stringify({ t: 'state', phase: 'play', score: 12, balls: 3, timeLeft: 250 }));
    host.ws.send(JSON.stringify({ t: 'ping', id: 7, ts: 123 }));

    await until(() => host.frames.length === 1);
    expect(decodeInput(host.frames[0] as ArrayBuffer)).toEqual({
      seq: 42,
      power: true,
      jump: false,
      menu: true,
      tiltX: 0.25,
      tiltZ: -0.5,
    });
    expect(await host.next((m) => m.t === 'calibrated')).toEqual({ t: 'calibrated' });
    expect(await ctl.next((m) => m.t === 'state')).toMatchObject({ phase: 'play', score: 12 });
    // Peer pings (positive ids) are relayed, not answered by the relay.
    expect(await ctl.next((m) => m.t === 'ping')).toEqual({ t: 'ping', id: 7, ts: 123 });
    // Frames are never echoed back to the sender.
    expect(ctl.frames).toHaveLength(0);

    ctl.ws.close(1000);
    expect(await host.next((m) => m.t === 'peer')).toEqual({
      t: 'peer',
      role: 'controller',
      connected: false,
    });
    host.ws.close(1000);
  });

  test('a new controller with the pair token replaces the old one (4409); host sees no disconnect', async () => {
    const room = await newRoom();
    const { code } = room;
    const host = await hostOf(room);
    await host.next((m) => m.t === 'peer' && m.connected === false);
    const c1 = await connect(code, 'controller'); // typed code (no controller yet: allowed)
    await host.next((m) => m.t === 'peer' && m.connected === true);
    const c2 = await phoneOf(room);
    // The relay sends Close 4409 at once. (Browsers fire `close` ≤ 2 s later because wrangler dev keeps the
    // TCP connection open after the handshake; undici waits 30 s, so check the state instead.)
    await until(() => c1.ws.readyState !== OPEN);
    expect(await host.next((m) => m.t === 'peer')).toEqual({
      t: 'peer',
      role: 'controller',
      connected: true,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(host.texts.some((m) => m.t === 'peer' && m.connected === false)).toBe(false);
    c2.ws.send(encodeInput({ seq: 1, power: false, jump: true, menu: false, tiltX: 0, tiltZ: 0 }));
    await until(() => host.frames.length === 1);
    const stats = (await (await fetch(`${base}/api/rooms/${code}/stats`)).json()) as { log: string[] };
    expect(stats.log.some((l) => l.includes('controller connected by code'))).toBe(true);
    expect(stats.log.some((l) => l.includes('controller connected by token (replaced previous)'))).toBe(true);
    c2.ws.close(1000);
    host.ws.close(1000);
  });

  test('unknown room → close 4404; bad role → close 4400; bad code → HTTP 400', async () => {
    const ghost = await connect('100000', 'host').catch(() => null);
    // The upgrade is accepted then closed with an app code so the browser can tell the user.
    if (ghost) expect((await ghost.closed).code).toBe(4404);
    const { code } = await newRoom();
    const bad = await connect(code, 'spectator').catch(() => null);
    if (bad) expect((await bad.closed).code).toBe(4400);
    const res = await fetch(`${base}/api/rooms/12ab56/ws?role=host`);
    expect(res.status).toBe(400);
    expect((await fetch(`${base}/api/rooms`)).status).toBe(405);
  });

  test('host reconnect with the same code resumes the room', async () => {
    const room = await newRoom();
    const h1 = await hostOf(room);
    const ctl = await phoneOf(room);
    await h1.next((m) => m.t === 'peer' && m.connected === true);
    expect(await ctl.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'host', connected: true });
    h1.ws.close(1000);
    expect(await ctl.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'host', connected: false });
    const h2 = await hostOf(room);
    expect(await h2.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'controller', connected: true });
    expect(await ctl.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'host', connected: true });
    ctl.ws.close(1000);
    h2.ws.close(1000);
  });

  test('stats endpoint reports input frames and button presses', async () => {
    const room = await newRoom();
    const { code } = room;
    const host = await hostOf(room);
    const ctl = await phoneOf(room);
    for (let seq = 1; seq <= 10; seq++) {
      ctl.ws.send(encodeInput({ seq, power: seq > 5, jump: seq === 3, menu: false, tiltX: 0.1, tiltZ: 0.2 }));
    }
    ctl.ws.send(encodeInput({ seq: 13, power: true, jump: false, menu: false, tiltX: 0.1, tiltZ: 0.2 }));
    ctl.ws.send(JSON.stringify({ t: 'calibrated' }));
    await until(() => host.frames.length === 11);
    await host.next((m) => m.t === 'calibrated');
    const stats = (await (await fetch(`${base}/api/rooms/${code}/stats`)).json()) as {
      host: boolean;
      controller: boolean;
      input: { frames: number; lost: number; buttonPresses: { power: number; jump: number } };
      counts: { calibrated: number };
    };
    expect(stats.host && stats.controller).toBe(true);
    expect(stats.input.frames).toBe(11);
    expect(stats.input.lost).toBe(2);
    expect(stats.input.buttonPresses).toMatchObject({ power: 1, jump: 1 });
    expect(stats.counts.calibrated).toBe(1);
    expect((await fetch(`${base}/api/rooms/999998/stats`)).status).toBe(404);
    ctl.ws.close(1000);
    host.ws.close(1000);
  });

  test('Phase 12: oversized frames close the socket with 1009', async () => {
    const room = await newRoom();
    const host = await hostOf(room);
    const ctl = await phoneOf(room);
    ctl.ws.send(new ArrayBuffer(65));
    expect((await ctl.closed).code).toBe(1009);
    host.ws.send(JSON.stringify({ t: 'state', pad: 'x'.repeat(5000) }));
    expect((await host.closed).code).toBe(1009);
  });

  test('Phase 12: a flood beyond the token bucket is dropped, not relayed', async () => {
    const room = await newRoom();
    const { code } = room;
    // Neither side answers keepalive pings: the only messages through the controller's bucket are the 500 below.
    const host = await hostOf(room, false);
    const ctl = await phoneOf(room, false);
    const t0 = performance.now();
    for (let seq = 1; seq <= 500; seq++)
      ctl.ws.send(encodeInput({ seq, power: false, jump: false, menu: false, tiltX: 0, tiltZ: 0 }));
    // Quiescence, not a fixed sleep: first the relay has handled all 500 frames (each one relayed or dropped)…
    let stats = await statsOf(code);
    await untilAsync(async () => {
      stats = await statsOf(code);
      return stats.input.frames + stats.dropped.rate >= 500;
    }, 20_000);
    const elapsedSec = (performance.now() - t0) / 1000;
    expect(stats.input.frames + stats.dropped.rate).toBe(500);
    // …then every relayed frame has reached the host (they can still be in flight when the relay is done).
    await until(() => host.frames.length >= stats.input.frames);
    expect(host.frames.length).toBe(stats.input.frames);
    // Burst 300, plus whatever the bucket refilled (150/s) while the frames were arriving. Bound the upper limit by
    // the measured elapsed time so a loaded machine doesn't make this flaky; the rest must have been dropped.
    expect(host.frames.length).toBeGreaterThanOrEqual(300);
    expect(host.frames.length).toBeLessThanOrEqual(Math.min(499, 300 + Math.ceil(150 * elapsedSec) + 10));
    expect(stats.dropped.rate).toBe(500 - host.frames.length);
    ctl.ws.close(1000);
    host.ws.close(1000);
  });

  test('keepalive pings measure per-role RTT; pongs to relay pings are not forwarded', async () => {
    const room = await newRoom();
    const { code } = room;
    const host = await hostOf(room);
    const ctl = await phoneOf(room);
    await host.next((m) => m.t === 'ping' && (m.id as number) < 0);
    await ctl.next((m) => m.t === 'ping' && (m.id as number) < 0);
    // Both clients answer every relay ping; wait until the relay has consumed at least one pong per role.
    await untilAsync(async () => {
      const { rtt } = await statsOf(code);
      return (rtt.host?.count ?? 0) > 0 && (rtt.controller?.count ?? 0) > 0;
    });
    // Barrier instead of a sleep: the relay handles each socket's messages in order, and each recipient gets them
    // in order, so once a message sent after those pongs has crossed, a forwarded pong would already be here.
    host.ws.send(JSON.stringify({ t: 'state', phase: 'barrier' }));
    await ctl.next((m) => m.t === 'state' && m.phase === 'barrier');
    ctl.ws.send(JSON.stringify({ t: 'calibrated' }));
    await host.next((m) => m.t === 'calibrated');
    expect(host.texts.some((m) => m.t === 'pong')).toBe(false);
    expect(ctl.texts.some((m) => m.t === 'pong')).toBe(false);
    ctl.ws.close(1000);
    host.ws.close(1000);
  });

  test('rooms expire after the idle window with no sockets (code becomes free)', {
    timeout: 45_000,
  }, async () => {
    const room = await newRoom();
    const { code } = room;
    const h = await hostOf(room);
    h.ws.close(1000);
    await new Promise((r) => setTimeout(r, 500));
    // Still inside the idle window: reconnecting works.
    const h2 = await hostOf(room);
    expect(await h2.next((m) => m.t === 'peer')).toMatchObject({ connected: false });
    h2.ws.close(1000);
    const closedAt = Date.now();
    // Poll for the expiry (the alarm can fire late on a loaded machine), but never before the idle window is over.
    await untilAsync(
      async () => (await fetch(`${base}/api/rooms/${code}/stats`)).status === 404,
      IDLE_MS + 20_000,
    );
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(IDLE_MS - 250);
    const late = await hostOf(room);
    expect((await late.closed).code).toBe(4404);
  });
});

describe('Room DO pairing secret (contracts v0.2.7, CCR-12-2)', { timeout: TEST_MS }, () => {
  const closeCode = async (c: Promise<Client>) => (await (await c).closed).code;

  test('POST /api/rooms is not cacheable (it carries secrets)', async () => {
    const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('host needs its token: missing or wrong → 4401; the pair token is not a host token', async () => {
    const room = await newRoom();
    expect(await closeCode(connect(room.code, 'host'))).toBe(4401);
    expect(await closeCode(connect(room.code, 'host', 'A'.repeat(22)))).toBe(4401);
    expect(await closeCode(connect(room.code, 'host', room.pairToken))).toBe(4401);
    const h = await hostOf(room);
    expect(await h.next((m) => m.t === 'peer')).toMatchObject({ connected: false });
    h.ws.close(1000);
  });

  test('a malformed token is refused before it reaches the room (HTTP 400)', async () => {
    const room = await newRoom();
    // The upgrade fails outright (HTTP 400, see rooms-route.test.ts), so the socket never opens.
    const opened = await new Promise<boolean>((resolve) => {
      const ws = new NodeWS(
        `${base.replace(/^http/, 'ws')}/api/rooms/${room.code}/ws?role=controller&token=not%20a%20token`,
      );
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      ws.onclose = () => resolve(false);
    });
    expect(opened).toBe(false);
  });

  test('typed code (no token) works while no controller is connected', async () => {
    const room = await newRoom();
    const host = await hostOf(room);
    const ctl = await connect(room.code, 'controller');
    expect(await ctl.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'host', connected: true });
    ctl.ws.send(encodeInput({ seq: 1, power: true, jump: false, menu: false, tiltX: 0, tiltZ: 0 }));
    await until(() => host.frames.length === 1);
    ctl.ws.close(1000);
    host.ws.close(1000);
  });

  test('ATTACK: a second controller guessing the code cannot replace a connected one', {
    timeout: 45_000,
  }, async () => {
    const room = await newRoom();
    const host = await hostOf(room);
    await host.next((m) => m.t === 'peer' && m.connected === false);
    const phone = await phoneOf(room);
    await host.next((m) => m.t === 'peer' && m.connected === true);
    // The legitimate phone streams input (the real controller sends ≥ 4 Hz even before play).
    let seq = 0;
    const stream = setInterval(
      () =>
        phone.ws.send(
          encodeInput({ seq: ++seq, power: false, jump: false, menu: false, tiltX: 0, tiltZ: 0 }),
        ),
      50,
    );
    try {
      // The attacker knows the 6-digit code: no token, a guessed token, the other role's token… all refused.
      expect(await closeCode(connect(room.code, 'controller'))).toBe(4401);
      expect(await closeCode(connect(room.code, 'controller', 'B'.repeat(22)))).toBe(4401);
      expect(await closeCode(connect(room.code, 'controller', room.hostToken))).toBe(4401);
      // …and still refused well past the liveness window while the phone streams.
      await new Promise((r) => setTimeout(r, 3300));
      expect(await closeCode(connect(room.code, 'controller'))).toBe(4401);
      // The legitimate phone was never replaced and the host never saw a disconnect or a new controller.
      expect(phone.ws.readyState).toBe(OPEN);
      expect(host.texts.some((m) => m.t === 'peer')).toBe(false);
      const before = host.frames.length;
      await until(() => host.frames.length > before + 2);
      const stats = (await (await fetch(`${base}/api/rooms/${room.code}/stats`)).json()) as {
        counts: { unauthorized: number; replaced: number };
      };
      expect(stats.counts).toMatchObject({ unauthorized: 4, replaced: 0 });
    } finally {
      clearInterval(stream);
    }
    phone.ws.close(1000);
    host.ws.close(1000);
  });

  test('a typed-code phone whose socket went silent (locked) can rejoin by code', {
    timeout: 45_000,
  }, async () => {
    const room = await newRoom();
    const host = await hostOf(room);
    // Silent: doesn't answer the relay's keepalive pings and sends nothing (a suspended page).
    const stale = await connect(room.code, 'controller', undefined, false);
    await host.next((m) => m.t === 'peer' && m.connected === true);
    expect(await closeCode(connect(room.code, 'controller'))).toBe(4401); // still live (just connected)
    await new Promise((r) => setTimeout(r, 3300));
    const again = await connect(room.code, 'controller');
    await until(() => stale.ws.readyState !== OPEN); // replaced (4409)
    expect(await again.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'host', connected: true });
    again.ws.close(1000);
    host.ws.close(1000);
  });

  test('the QR phone (pair token) takes over from a typed-code controller', async () => {
    const room = await newRoom();
    const host = await hostOf(room);
    const typed = await connect(room.code, 'controller');
    const qr = await phoneOf(room);
    await until(() => typed.ws.readyState !== OPEN);
    expect(qr.ws.readyState).toBe(OPEN);
    qr.ws.close(1000);
    host.ws.close(1000);
  });
});
