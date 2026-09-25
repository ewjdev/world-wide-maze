import { decodeInput, encodeInput } from '@wwm/schema';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  CLOSE_REPLACED,
  CLOSE_ROOM_NOT_FOUND,
  CLOSE_UNAUTHORIZED,
  ControllerConnection,
  HostConnection,
  MAX_BUFFERED_BYTES,
} from '../src/connection.ts';
import {
  createRoom,
  forgetPairToken,
  isRoomCode,
  pairingUrl,
  pairTokenFromFragment,
  recallHostRoom,
  rememberHostRoom,
  resolvePairToken,
  roomWsUrl,
} from '../src/rooms-api.ts';
import { socketFactory } from './fake-ws.ts';

let clock = 0;
const now = () => clock;
const TOK = 'AbCdEfGhIjKlMnOpQrSt_-';
const TOK2 = 'zYxWvUtSrQpOnMlKjIhG12';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('rooms api helpers', () => {
  test('URLs', () => {
    expect(roomWsUrl('https://wwm.example', '123456', 'controller')).toBe(
      'wss://wwm.example/api/rooms/123456/ws?role=controller',
    );
    expect(roomWsUrl('http://localhost:5173', '123456', 'host')).toBe(
      'ws://localhost:5173/api/rooms/123456/ws?role=host',
    );
    expect(pairingUrl('https://wwm.example/play/x', '654321')).toBe('https://wwm.example/c/654321');
    expect(isRoomCode('012345')).toBe(true);
    expect(isRoomCode('12345')).toBe(false);
  });

  test('v0.2.7: tokens in the ws URL (query) and in the pairing URL (fragment only)', () => {
    expect(roomWsUrl('https://wwm.example', '123456', 'host', TOK)).toBe(
      `wss://wwm.example/api/rooms/123456/ws?role=host&token=${TOK}`,
    );
    expect(roomWsUrl('https://wwm.example', '123456', 'controller', null)).toBe(
      'wss://wwm.example/api/rooms/123456/ws?role=controller',
    );
    const link = pairingUrl('https://wwm.example', '654321', TOK2);
    expect(link).toBe(`https://wwm.example/c/654321#p=${TOK2}`);
    const u = new URL(link);
    expect(u.pathname + u.search).toBe('/c/654321'); // what a server (or Referer) would ever see
    expect(pairTokenFromFragment(u.hash)).toBe(TOK2);
    expect(pairTokenFromFragment('#p=short')).toBeNull();
    expect(pairTokenFromFragment('')).toBeNull();
  });

  test('v0.2.7: the phone remembers its pair token per code in sessionStorage', () => {
    const store = memoryStorage();
    // First visit via the QR link: the fragment wins and is remembered.
    expect(resolvePairToken('111111', `#p=${TOK}`, store)).toBe(TOK);
    // Reload / reconnect without the fragment: recalled.
    expect(resolvePairToken('111111', '', store)).toBe(TOK);
    // Another code: nothing (typed-code path).
    expect(resolvePairToken('222222', '', store)).toBeNull();
    // A newer link for the same code replaces it.
    expect(resolvePairToken('111111', `#p=${TOK2}`, store)).toBe(TOK2);
    forgetPairToken('111111', store);
    expect(resolvePairToken('111111', '', store)).toBeNull();
    // No storage (private mode): still works from the fragment.
    expect(resolvePairToken('111111', `#p=${TOK}`, null)).toBe(TOK);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    };
    expect(resolvePairToken('111111', `#p=${TOK}`, broken)).toBe(TOK);
    expect(resolvePairToken('111111', '', broken)).toBeNull();
  });

  test('v0.2.7: the host remembers its room tokens (reload of /p/<code>), or takes them from #h=', () => {
    const store = memoryStorage();
    expect(recallHostRoom('333333', '', store)).toBeNull();
    rememberHostRoom('333333', { hostToken: TOK, pairToken: TOK2 }, store);
    expect(recallHostRoom('333333', '', store)).toEqual({ hostToken: TOK, pairToken: TOK2 });
    expect(recallHostRoom('444444', '', store)).toBeNull();
    expect(recallHostRoom('444444', `#h=${TOK2}&p=${TOK}`, store)).toEqual({
      hostToken: TOK2,
      pairToken: TOK,
    });
    expect(recallHostRoom('444444', `#h=${TOK2}`, null)).toEqual({ hostToken: TOK2, pairToken: null });
    store.setItem('wwm.room.555555', '{not json');
    expect(recallHostRoom('555555', '', store)).toBeNull();
  });

  test('createRoom posts and validates', async () => {
    const f = vi.fn(async () => Response.json({ code: '424242', hostToken: TOK, pairToken: TOK2 }));
    expect(await createRoom('http://x', f as unknown as typeof fetch)).toEqual({
      code: '424242',
      hostToken: TOK,
      pairToken: TOK2,
    });
    const bad = vi.fn(async () => Response.json({ code: 'nope', hostToken: TOK, pairToken: TOK2 }));
    await expect(createRoom('http://x', bad as unknown as typeof fetch)).rejects.toThrow(/malformed/);
    const legacy = vi.fn(async () => Response.json({ code: '424242' })); // pre-0.2.7 server
    await expect(createRoom('http://x', legacy as unknown as typeof fetch)).rejects.toThrow(/malformed/);
    const err = vi.fn(async () => new Response('', { status: 503 }));
    await expect(createRoom('http://x', err as unknown as typeof fetch)).rejects.toThrow(/503/);
  });
});

describe('RoomConnection', () => {
  test('answers relay and peer pings with pongs; measures RTT from its own pings', () => {
    const f = socketFactory();
    const host = new HostConnection({ url: 'ws://x', createSocket: f.create, now, pingIntervalMs: 1000 });
    const rtts: number[] = [];
    host.on('rtt', (ms) => rtts.push(ms));
    host.connect();
    const s = f.last();
    s.open();
    expect(host.state).toBe('open');
    s.receive({ t: 'ping', id: -5, ts: 999 });
    expect(s.sentJson()).toEqual([{ t: 'pong', id: -5, ts: 999 }]);
    // No peer yet: no pings.
    vi.advanceTimersByTime(1500);
    expect(s.sentJson()).toHaveLength(1);
    s.receive({ t: 'peer', role: 'controller', connected: true });
    expect(host.peerConnected).toBe(true);
    clock = 1000;
    vi.advanceTimersByTime(1000);
    const ping = s.sentJson().at(-1) as { t: string; id: number; ts: number };
    expect(ping).toMatchObject({ t: 'ping', ts: 1000 });
    expect(ping.id).toBeGreaterThan(0);
    clock = 1042;
    s.receive({ t: 'pong', id: ping.id, ts: ping.ts });
    expect(rtts).toEqual([42]);
    expect(host.rtt.summary().p50).toBe(42);
    host.close();
  });

  test('ignores malformed JSON and unknown messages; emits valid ones', () => {
    const f = socketFactory();
    const c = new ControllerConnection({ url: 'ws://x', createSocket: f.create, now, pingIntervalMs: 0 });
    const got: unknown[] = [];
    c.on('message', (m) => got.push(m));
    c.connect();
    f.last().open();
    f.last().receive('not json');
    f.last().receive({ t: 'evil', x: 1 });
    f.last().receive({ t: 'haptic', pattern: 'nope' });
    f.last().receive({ t: 'haptic', pattern: 'goal' });
    f.last().receive({ t: 'state', phase: 'play', score: 10, balls: 2, timeLeft: 99 });
    expect(got).toEqual([
      { t: 'haptic', pattern: 'goal' },
      { t: 'state', phase: 'play', score: 10, balls: 2, timeLeft: 99 },
    ]);
  });

  test('reconnects with exponential backoff; resets after a successful open', () => {
    const f = socketFactory();
    const c = new ControllerConnection({
      url: 'ws://x',
      createSocket: f.create,
      now,
      random: () => 0.5, // jitter factor 1.0
      backoffInitialMs: 250,
      backoffMaxMs: 2000,
    });
    const closes: boolean[] = [];
    c.on('close', (i) => closes.push(i.willReconnect));
    c.connect();
    expect(f.sockets).toHaveLength(1);
    f.last().serverClose(1006);
    expect(c.state).toBe('reconnecting');
    vi.advanceTimersByTime(249);
    expect(f.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(f.sockets).toHaveLength(2);
    f.last().serverClose(1006);
    vi.advanceTimersByTime(499);
    expect(f.sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(f.sockets).toHaveLength(3);
    for (let i = 0; i < 5; i++) {
      f.last().serverClose(1006);
      vi.advanceTimersByTime(2000); // capped
    }
    expect(f.sockets).toHaveLength(8);
    f.last().open();
    f.last().serverClose(1006);
    vi.advanceTimersByTime(250);
    expect(f.sockets).toHaveLength(9);
    expect(closes.every(Boolean)).toBe(true);
    c.close();
    expect(c.state).toBe('closed');
  });

  test('reconnectNow skips the backoff wait (phone unlocked)', () => {
    const f = socketFactory();
    const c = new ControllerConnection({
      url: 'ws://x',
      createSocket: f.create,
      now,
      backoffInitialMs: 5000,
    });
    c.connect();
    f.last().open();
    f.last().serverClose(1006);
    expect(f.sockets).toHaveLength(1);
    c.reconnectNow();
    expect(f.sockets).toHaveLength(2);
    // Already connecting: no duplicate.
    c.reconnectNow();
    expect(f.sockets).toHaveLength(2);
    vi.advanceTimersByTime(10_000);
    expect(f.sockets).toHaveLength(2);
  });

  test('reconnectIfSilent: a socket that looks open but went quiet (phone locked) is replaced at once', () => {
    const f = socketFactory();
    const c = new ControllerConnection({ url: 'ws://x', createSocket: f.create, now, pingIntervalMs: 0 });
    c.connect();
    f.last().open();
    clock = 1000;
    f.last().receive({ t: 'ping', id: -1, ts: 1 });
    clock = 2500;
    expect(c.reconnectIfSilent(3000)).toBe(false);
    clock = 9000;
    expect(c.reconnectIfSilent(3000)).toBe(true);
    expect(f.sockets).toHaveLength(2);
    expect(f.sockets[0]?.readyState).toBe(3);
    // Still connecting: no duplicate.
    expect(c.reconnectIfSilent(3000)).toBe(false);
    f.last().open();
    expect(c.state).toBe('open');
  });

  test('4404 room-not-found, 4409 replaced and 4401 unauthorized are fatal (no reconnect)', () => {
    for (const [code, err] of [
      [CLOSE_ROOM_NOT_FOUND, 'room-not-found'],
      [CLOSE_REPLACED, 'replaced'],
      [CLOSE_UNAUTHORIZED, 'unauthorized'],
    ] as const) {
      const f = socketFactory();
      const c = new ControllerConnection({ url: 'ws://x', createSocket: f.create, now });
      const errors: string[] = [];
      c.on('error', (e) => errors.push(e));
      c.connect();
      f.last().open();
      f.last().serverClose(code, 'x');
      vi.advanceTimersByTime(60_000);
      expect(f.sockets).toHaveLength(1);
      expect(errors).toEqual([err]);
      expect(c.state).toBe('closed');
    }
  });

  test('socket close marks the peer disconnected', () => {
    const f = socketFactory();
    const c = new ControllerConnection({ url: 'ws://x', createSocket: f.create, now });
    const peers: [string, boolean][] = [];
    c.on('peer', (r, on) => peers.push([r, on]));
    c.connect();
    f.last().open();
    f.last().receive({ t: 'peer', role: 'host', connected: true });
    f.last().serverClose(1006);
    expect(peers).toEqual([
      ['host', true],
      ['host', false],
    ]);
  });
});

describe('input frames end to end (controller → host)', () => {
  test('sendInput encodes 12-byte frames with increasing seq; host decodes them', () => {
    const f = socketFactory();
    const ctl = new ControllerConnection({ url: 'ws://c', createSocket: f.create, now });
    const host = new HostConnection({ url: 'ws://h', createSocket: f.create, now });
    ctl.connect();
    host.connect();
    const [cs, hs] = f.sockets;
    if (!cs || !hs) throw new Error('sockets');
    cs.open();
    hs.open();
    cs.onSend = (d) => hs.receive(d);
    const frames: unknown[] = [];
    host.on('input', (fr, at) => frames.push({ ...fr, at }));
    clock = 5;
    expect(ctl.sendInput({ tiltX: 0.1, tiltZ: -0.3, power: true, jump: false, menu: false })).toBe(true);
    expect(ctl.sendInput({ tiltX: 0, tiltZ: 0, power: false, jump: true, menu: true })).toBe(true);
    expect((cs.sent[0] as ArrayBuffer).byteLength).toBe(12);
    expect(frames).toEqual([
      {
        seq: 1,
        tiltX: expect.closeTo(0.1, 6),
        tiltZ: expect.closeTo(-0.3, 6),
        power: true,
        jump: false,
        menu: false,
        at: 5,
      },
      { seq: 2, tiltX: 0, tiltZ: 0, power: false, jump: true, menu: true, at: 5 },
    ]);
    // Frames are copies (the encode buffer is reused).
    expect(decodeInput(cs.sent[0] as ArrayBuffer)?.seq).toBe(1);
    // Backpressure: skip while the socket is backed up.
    cs.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    expect(ctl.sendInput({ tiltX: 0, tiltZ: 0, power: false, jump: false, menu: false })).toBe(false);
    expect(ctl.skipped).toBe(1);
    expect(ctl.sent).toBe(2);
  });

  test('codec round-trip through the host with ArrayBufferView data', () => {
    const f = socketFactory();
    const host = new HostConnection({ url: 'ws://h', createSocket: f.create, now });
    host.connect();
    f.last().open();
    const got: unknown[] = [];
    host.on('input', (fr) => got.push(fr));
    const buf = encodeInput({ seq: 65535, tiltX: 0.25, tiltZ: 0.5, power: true, jump: true, menu: true });
    const padded = new Uint8Array(20);
    padded.set(new Uint8Array(buf), 4);
    f.last().onmessage?.({ data: padded.subarray(4, 16) });
    f.last().receive(new ArrayBuffer(11)); // wrong size: dropped
    expect(got).toEqual([{ seq: 65535, tiltX: 0.25, tiltZ: 0.5, power: true, jump: true, menu: true }]);
  });
});
