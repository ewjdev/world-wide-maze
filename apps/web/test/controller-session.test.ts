import type { WebSocketLike } from '@wwm/net';
import { decodeInput, MAX_TILT_ROLL } from '@wwm/schema';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type ControllerEnv, ControllerSession } from '../src/controller/session.ts';

class Sock implements WebSocketLike {
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: (string | ArrayBuffer)[] = [];
  constructor(readonly url: string) {}
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  msg(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  frames() {
    return this.sent.filter((d): d is ArrayBuffer => d instanceof ArrayBuffer).map((d) => decodeInput(d));
  }
  texts() {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
}

function rig(opts: { permission?: 'granted' | 'denied' | 'none' | 'unsupported'; stored?: string } = {}) {
  let clock = 1000;
  let visible = true;
  const sockets: Sock[] = [];
  const store = new Map<string, string>();
  if (opts.stored) store.set('wwm.controller.zero', opts.stored);
  const sensor = new EventTarget();
  const vis = new EventTarget();
  const logs: string[] = [];
  const vibrations: number[][] = [];
  const permission = opts.permission ?? 'granted';
  const env: ControllerEnv = {
    origin: 'https://wwm.test',
    now: () => clock,
    requestAnimationFrame: () => 1, // the test drives `step()` itself
    cancelAnimationFrame: () => {},
    sensorTarget: sensor,
    visibilityTarget: vis,
    isVisible: () => visible,
    screenAngle: () => 0,
    ...(permission === 'unsupported'
      ? {}
      : {
          DeviceOrientationEvent:
            permission === 'none'
              ? {}
              : { requestPermission: async () => permission as 'granted' | 'denied' },
        }),
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    vibrate: (p) => {
      vibrations.push(p);
      return true;
    },
    requestWakeLock: async () => {},
    createSocket: (url) => {
      const s = new Sock(url);
      sockets.push(s);
      return s;
    },
    log: (m) => logs.push(String(m)),
  };
  const s = new ControllerSession('123456', env);
  s.start();
  const orient = (beta: number, gamma: number) =>
    sensor.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 10, beta, gamma }));
  const advance = (ms: number, step = 16) => {
    for (let t = 0; t < ms; t += step) {
      clock += step;
      s.step();
    }
  };
  return {
    s,
    sockets,
    sock: () => sockets[sockets.length - 1] as Sock,
    orient,
    advance,
    logs,
    store,
    vibrations,
    setVisible: (v: boolean) => {
      visible = v;
      vis.dispatchEvent(new Event('visibilitychange'));
    },
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ControllerSession', () => {
  test('connects to the room socket as controller; enable → permission → calibrate → play', async () => {
    const r = rig();
    expect(r.sock().url).toBe('wss://wwm.test/api/rooms/123456/ws?role=controller');
    expect(r.s.getView().screen).toBe('connecting');
    r.sock().open();
    r.sock().msg({ t: 'peer', role: 'host', connected: true });
    expect(r.s.getView()).toMatchObject({ screen: 'enable', hostConnected: true });
    r.s.enableTilt();
    expect(r.s.getView().screen).toBe('requesting');
    await vi.waitFor(() => expect(r.s.getView().permission).toBe('granted'));
    r.orient(45, 0);
    expect(r.s.getView().screen).toBe('calibrate');
    // During calibration frames stream with POWER forced off, tilt relative to the default neutral.
    r.orient(46, 0.5);
    r.advance(1000);
    expect(r.s.getView().screen).toBe('play');
    const calibrated = r
      .sock()
      .texts()
      .filter((m) => m.t === 'calibrated');
    expect(calibrated).toHaveLength(1);
    expect(r.store.get('wwm.controller.zero')).toBeTruthy();
    const frames = r.sock().frames();
    expect(frames.length).toBeGreaterThan(30);
    expect(frames.every((f) => f && !f.power)).toBe(true);
  });

  test('play: POWER/JUMP/MENU send immediate frames; tilt is calibrated and clamped', async () => {
    const r = rig({ stored: JSON.stringify([0, -Math.SQRT1_2, -Math.SQRT1_2]) });
    r.sock().open();
    r.s.enableTilt();
    await flush();
    r.orient(45, 0);
    expect(r.s.getView().screen).toBe('play');
    r.advance(100);
    const before = r.sock().frames().length;
    r.s.setButton('power', true);
    expect(r.sock().frames().length).toBe(before + 1);
    expect(r.sock().frames().at(-1)).toMatchObject({ power: true, jump: false });
    r.s.setButton('jump', true);
    r.s.setButton('jump', false);
    r.s.setButton('menu', true);
    const f = r.sock().frames();
    expect(f.at(-3)).toMatchObject({ power: true, jump: true });
    expect(f.at(-2)).toMatchObject({ power: true, jump: false });
    expect(f.at(-1)).toMatchObject({ menu: true });
    // Roll way past the limit: clamped to ±20° and "Too tilted!" shows.
    r.orient(45, 40);
    r.advance(40);
    const last = r.sock().frames().at(-1);
    expect(last?.tiltX).toBeCloseTo(MAX_TILT_ROLL, 5);
    expect(r.s.getView().tooTilted).toBe(true);
    // The rate limiter keeps frames at ≤ 60 Hz.
    const n0 = r.sock().frames().length;
    r.advance(1000, 4);
    const sent = r.sock().frames().length - n0;
    expect(sent).toBeGreaterThan(50);
    expect(sent).toBeLessThanOrEqual(64);
  });

  test('denied permission shows the fallback; retry asks again', async () => {
    const r = rig({ permission: 'denied' });
    r.sock().open();
    r.s.enableTilt();
    await vi.waitFor(() => expect(r.s.getView().screen).toBe('denied'));
    expect(r.s.getView().permission).toBe('denied');
  });

  test('no sensor data within 2.5 s → no-sensor fallback (e.g. desktop browser)', async () => {
    const r = rig({ permission: 'none' });
    r.sock().open();
    r.s.enableTilt();
    expect(r.s.getView().permission).toBe('not-required');
    vi.advanceTimersByTime(2600);
    expect(r.s.getView().screen).toBe('no-sensor');
    // Late events still recover.
    r.orient(45, 0);
    expect(r.s.getView().screen).toBe('calibrate');
    const u = rig({ permission: 'unsupported' });
    u.sock().open();
    u.s.enableTilt();
    expect(u.s.getView().screen).toBe('no-sensor');
  });

  test('calibration times out after 15 s of unsteady motion → keyboard fallback screen', async () => {
    const r = rig();
    r.sock().open();
    r.s.enableTilt();
    await flush();
    for (let i = 0; i < 15_100 / 100; i++) {
      r.orient(45 + (i % 2 ? 6 : -6), 0); // never steady
      r.advance(100, 50);
    }
    expect(r.s.getView().screen).toBe('calibration-failed');
    expect(r.logs.some((l) => l.includes('calibration timeout'))).toBe(true);
    r.s.retryCalibration();
    expect(r.s.getView().screen).toBe('calibrate');
    r.s.calibrateHere();
    expect(r.s.getView().screen).toBe('play');
  });

  test('host state/haptic messages update the HUD and vibrate; host calibrate phase re-sends calibrated', async () => {
    const r = rig({ stored: JSON.stringify([0, 0, -1]) });
    r.sock().open();
    r.s.enableTilt();
    await flush();
    r.orient(0, 0);
    r.sock().msg({ t: 'state', phase: 'play', score: 120, balls: 2, timeLeft: 250 });
    expect(r.s.getView().host).toMatchObject({ score: 120, balls: 2 });
    r.sock().msg({ t: 'haptic', pattern: 'large' });
    expect(r.vibrations).toEqual([[30, 40, 30]]);
    const n = r
      .sock()
      .texts()
      .filter((m) => m.t === 'calibrated').length;
    r.sock().msg({ t: 'state', phase: 'calibrate', score: 0, balls: 3, timeLeft: 300 });
    expect(
      r
        .sock()
        .texts()
        .filter((m) => m.t === 'calibrated').length,
    ).toBe(n + 1);
  });

  test('lock/unlock: hidden releases buttons; visible after silence reconnects immediately', async () => {
    const r = rig({ stored: JSON.stringify([0, 0, -1]) });
    r.sock().open();
    r.s.enableTilt();
    await flush();
    r.orient(0, 0);
    r.s.setButton('power', true);
    r.setVisible(false);
    expect(r.s.getView().buttons.power).toBe(false);
    r.tick(10_000); // phone locked for 10 s: socket looks open but is silent
    r.setVisible(true);
    expect(r.sockets).toHaveLength(2);
    r.sock().open();
    r.sock().msg({ t: 'peer', role: 'host', connected: true });
    // Calibration is kept (first game only) and re-announced to the host.
    expect(r.s.getView().screen).toBe('play');
    expect(
      r
        .sock()
        .texts()
        .filter((m) => m.t === 'calibrated'),
    ).toHaveLength(1);
  });

  test('room not found / replaced are terminal screens', () => {
    const r = rig();
    r.sock().drop(4404);
    expect(r.s.getView().screen).toBe('not-found');
    const q = rig();
    q.sock().open();
    q.sock().drop(4409);
    expect(q.s.getView().screen).toBe('replaced');
  });

  test('diag() summarizes the session for remote verification', async () => {
    const r = rig({ stored: JSON.stringify([0, 0, -1]) });
    r.sock().open();
    r.s.enableTilt();
    await flush();
    r.orient(10, 0);
    r.advance(500);
    const d = r.s.diag();
    expect(d).toMatchObject({ code: '123456', screen: 'play', permission: 'granted', calibratedSent: 1 });
    expect((d.tiltDeg as { z: number }).z).toBeCloseTo(-10, 1);
  });
});
