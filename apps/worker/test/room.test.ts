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

function connect(code: string, role: string, answerPings = true): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new NodeWS(`${base.replace(/^http/, 'ws')}/api/rooms/${code}/ws?role=${role}`);
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
      next(pred, ms = 3000) {
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
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

async function newRoom(): Promise<string> {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string };
  expect(body.code).toMatch(/^\d{6}$/);
  return body.code;
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('Room DO relay', () => {
  test('POST /api/rooms allocates distinct 6-digit codes', async () => {
    const codes = new Set(await Promise.all(Array.from({ length: 5 }, newRoom)));
    expect(codes.size).toBe(5);
  });

  test('relays binary input and JSON both ways, with peer notifications', async () => {
    const code = await newRoom();
    const host = await connect(code, 'host');
    expect(await host.next((m) => m.t === 'peer')).toEqual({
      t: 'peer',
      role: 'controller',
      connected: false,
    });
    const ctl = await connect(code, 'controller');
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

  test('a new controller replaces the old one with notice (4409); host sees no disconnect', async () => {
    const code = await newRoom();
    const host = await connect(code, 'host');
    await host.next((m) => m.t === 'peer' && m.connected === false);
    const c1 = await connect(code, 'controller');
    await host.next((m) => m.t === 'peer' && m.connected === true);
    const c2 = await connect(code, 'controller');
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
    expect(stats.log.some((l) => l.includes('controller connected (replaced previous)'))).toBe(true);
    c2.ws.close(1000);
    host.ws.close(1000);
  });

  test('unknown room → close 4404; bad role → close 4400; bad code → HTTP 400', async () => {
    const ghost = await connect('100000', 'host').catch(() => null);
    // The upgrade is accepted then closed with an app code so the browser can tell the user.
    if (ghost) expect((await ghost.closed).code).toBe(4404);
    const code = await newRoom();
    const bad = await connect(code, 'spectator').catch(() => null);
    if (bad) expect((await bad.closed).code).toBe(4400);
    const res = await fetch(`${base}/api/rooms/12ab56/ws?role=host`);
    expect(res.status).toBe(400);
    expect((await fetch(`${base}/api/rooms`)).status).toBe(405);
  });

  test('host reconnect with the same code resumes the room', async () => {
    const code = await newRoom();
    const h1 = await connect(code, 'host');
    const ctl = await connect(code, 'controller');
    await h1.next((m) => m.t === 'peer' && m.connected === true);
    expect(await ctl.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'host', connected: true });
    h1.ws.close(1000);
    expect(await ctl.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'host', connected: false });
    const h2 = await connect(code, 'host');
    expect(await h2.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'controller', connected: true });
    expect(await ctl.next((m) => m.t === 'peer')).toEqual({ t: 'peer', role: 'host', connected: true });
    ctl.ws.close(1000);
    h2.ws.close(1000);
  });

  test('stats endpoint reports input frames and button presses', async () => {
    const code = await newRoom();
    const host = await connect(code, 'host');
    const ctl = await connect(code, 'controller');
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

  test('keepalive pings measure per-role RTT; pongs to relay pings are not forwarded', async () => {
    const code = await newRoom();
    const host = await connect(code, 'host');
    const ctl = await connect(code, 'controller');
    await host.next((m) => m.t === 'ping' && (m.id as number) < 0);
    await ctl.next((m) => m.t === 'ping' && (m.id as number) < 0);
    await new Promise((r) => setTimeout(r, 400));
    const stats = (await (await fetch(`${base}/api/rooms/${code}/stats`)).json()) as {
      rtt: Record<string, { count: number; p50: number | null }>;
    };
    expect(stats.rtt.host?.count).toBeGreaterThan(0);
    expect(stats.rtt.controller?.count).toBeGreaterThan(0);
    expect(host.texts.some((m) => m.t === 'pong')).toBe(false);
    expect(ctl.texts.some((m) => m.t === 'pong')).toBe(false);
    ctl.ws.close(1000);
    host.ws.close(1000);
  });

  test('rooms expire after the idle window with no sockets (code becomes free)', {
    timeout: 20_000,
  }, async () => {
    const code = await newRoom();
    const h = await connect(code, 'host');
    h.ws.close(1000);
    await new Promise((r) => setTimeout(r, 500));
    // Still inside the idle window: reconnecting works.
    const h2 = await connect(code, 'host');
    expect(await h2.next((m) => m.t === 'peer')).toMatchObject({ connected: false });
    h2.ws.close(1000);
    await new Promise((r) => setTimeout(r, IDLE_MS + 1500));
    expect((await fetch(`${base}/api/rooms/${code}/stats`)).status).toBe(404);
    const late = await connect(code, 'host');
    expect((await late.closed).code).toBe(4404);
  });
});
