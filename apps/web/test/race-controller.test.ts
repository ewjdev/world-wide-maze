import { HostConnection } from '@wwm/net';
import { encodeInput, type RaceState } from '@wwm/schema';
import { ControlMessageSchema } from '@wwm/schema/zod';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeSocket } from '../../../packages/net/test/fake-ws.ts';
import { RaceControllerHost } from '../src/controller/race-host.ts';
import { ControllerSession } from '../src/controller/session.ts';

const race: RaceState = {
  version: 1,
  phase: 'racing',
  elapsedTicks: 120,
  simHz: 120,
  sector: 1,
  totalSectors: 8,
  practice: false,
  splitDeltaTicks: -24,
};
const legacy = { t: 'state', phase: 'play', score: 100, balls: 3, timeLeft: 90 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function hostRig() {
  const socket = new FakeSocket('wss://test');
  const conn = new HostConnection({
    url: socket.url,
    createSocket: () => socket,
    pingIntervalMs: 0,
    now: () => Date.now(),
  });
  conn.connect();
  socket.open();
  const onMenu = vi.fn();
  const onDisconnect = vi.fn();
  const host = new RaceControllerHost(
    { code: '123456', pairToken: 'secret', conn },
    { origin: 'https://test', frameYaw: () => 1.25, onMenu, onDisconnect },
  );
  return { socket, host, onMenu, onDisconnect };
}

function phoneRig() {
  const socket = new FakeSocket('wss://test-phone');
  const sensorTarget = new EventTarget();
  const session = new ControllerSession('123456', {
    origin: 'https://test',
    now: () => Date.now(),
    createSocket: () => socket,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    sensorTarget,
    visibilityTarget: new EventTarget(),
    isVisible: () => true,
    screenAngle: () => 0,
    DeviceOrientationEvent: {},
    log: () => {},
  });
  session.start();
  socket.open();
  return { socket, session, sensorTarget };
}

describe('Race controller compatibility', () => {
  test('optional Race state and negotiation round-trip through the actual connection parser', () => {
    const { socket, session } = phoneRig();
    socket.receive(legacy);
    expect(session.getView().host).toEqual(legacy);
    expect(socket.sentJson().some((m) => m.t === 'capabilities')).toBe(false);
    socket.receive({ t: 'capabilities-request' });
    expect(socket.sentJson()).toContainEqual({ t: 'capabilities', raceVersion: 1 });
    socket.receive({ ...legacy, race });
    expect(session.getView().host?.race).toEqual(race);
    socket.receive({ ...legacy, race: { ...race, simHz: 0 } });
    expect(session.getView().host?.race?.simHz).toBe(120);
    session.dispose();
  });

  test('old state still parses; impossible clocks and unknown versions do not', () => {
    expect(ControlMessageSchema.safeParse(legacy).success).toBe(true);
    for (const patch of [
      { version: 2 },
      { elapsedTicks: -1 },
      { elapsedTicks: 1.5 },
      { simHz: 0 },
      { phase: 'goal' },
    ]) {
      expect(ControlMessageSchema.safeParse({ ...legacy, race: { ...race, ...patch } }).success).toBe(false);
    }
    expect(ControlMessageSchema.safeParse({ t: 'capabilities', raceVersion: 2 }).success).toBe(false);
  });

  test('old phone cannot start Race; late response or reconnect can negotiate again', () => {
    const { socket, host } = hostRig();
    socket.receive({ t: 'peer', role: 'controller', connected: true });
    socket.receive({ t: 'calibrated' });
    expect(host.canStart).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(host.getView().raceSupport).toBe('unsupported');
    expect(host.getView().error).toContain('Refresh');
    socket.receive({ t: 'capabilities', raceVersion: 1 });
    expect(host.canStart).toBe(true);
    socket.receive({ t: 'peer', role: 'controller', connected: false });
    socket.receive({ t: 'peer', role: 'controller', connected: true });
    expect(host.getView()).toMatchObject({ raceSupport: 'pending', calibrated: false });
    expect(host.canStart).toBe(false);
    host.dispose();
  });

  test('new phone enables Race only after calibration, retaining host-authoritative elapsed ticks', () => {
    const { socket, host } = hostRig();
    const phone = phoneRig();
    // Same verbatim forwarding behavior as Room DO: each direction passes raw text/binary unchanged.
    socket.onSend = (m) => phone.socket.receive(m);
    phone.socket.onSend = (m) => socket.receive(m);
    phone.socket.receive({ t: 'peer', role: 'host', connected: true });
    socket.receive({ t: 'peer', role: 'controller', connected: true });
    expect(host.getView().raceSupport).toBe('supported');
    expect(host.canStart).toBe(false);
    phone.session.enableTilt();
    phone.sensorTarget.dispatchEvent(
      Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 45, gamma: 0 }),
    );
    phone.session.calibrateHere();
    expect(host.canStart).toBe(true);
    host.sendState(race);
    vi.advanceTimersByTime(1000);
    expect(phone.session.getView().host?.race).toEqual(race);
    expect(socket.sentJson().filter((m) => m.t === 'state')).toHaveLength(4);
    phone.session.dispose();
    host.dispose();
  });

  test('input keeps camera yaw, routes menu, goes neutral on silence and disposes all sends', () => {
    const { socket, host, onMenu, onDisconnect } = hostRig();
    socket.receive({ t: 'peer', role: 'controller', connected: true });
    socket.receive({ t: 'capabilities', raceVersion: 1 });
    socket.receive({ t: 'calibrated' });
    socket.receive(encodeInput({ seq: 1, tiltX: 0.2, tiltZ: -0.1, power: true, jump: true, menu: true }));
    expect(host.sample(Date.now())).toMatchObject({ frameYaw: 1.25, power: true, jump: true });
    expect(onMenu).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1600);
    expect(host.sample(Date.now())).toMatchObject({ tiltX: 0, tiltZ: 0, power: false, jump: false });
    expect(host.canStart).toBe(false);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    host.dispose();
    const sent = socket.sent.length;
    vi.advanceTimersByTime(6000);
    expect(socket.sent).toHaveLength(sent);
    expect(socket.readyState).toBe(3);
  });
});
