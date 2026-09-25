import { encodeInput, KEYBOARD_TILT } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { HostConnection } from '../src/connection.ts';
import { GAMEPAD_DEADZONE, GamepadInputSource, type GamepadLike } from '../src/sources/gamepad.ts';
import {
  KEYBOARD_POWER_RELEASE_MS,
  KEYBOARD_RAMP_RAD_PER_SEC,
  KeyboardInputSource,
} from '../src/sources/keyboard.ts';
import { PhoneInputSource, STALE_INPUT_MS } from '../src/sources/phone.ts';
import { TouchInputSource } from '../src/sources/touch.ts';
import { socketFactory } from './fake-ws.ts';

// ── Phone ───────────────────────────────────────────────────────────────────────────────────────────

function phoneRig() {
  let clock = 0;
  const f = socketFactory();
  const conn = new HostConnection({
    url: 'ws://h',
    createSocket: f.create,
    now: () => clock,
    pingIntervalMs: 0,
  });
  conn.connect();
  const sock = f.last();
  sock.open();
  const src = new PhoneInputSource(conn, { frameYaw: () => 1.25 });
  const events: string[] = [];
  for (const e of ['menu', 'connected', 'disconnected'] as const) src.on(e, () => events.push(e));
  let seq = 0;
  const send = (
    at: number,
    p: Partial<{
      tiltX: number;
      tiltZ: number;
      power: boolean;
      jump: boolean;
      menu: boolean;
      seq: number;
    }> = {},
  ) => {
    clock = at;
    sock.receive(
      encodeInput({ tiltX: 0, tiltZ: 0, power: false, jump: false, menu: false, seq: p.seq ?? ++seq, ...p }),
    );
  };
  return { src, sock, send, events, setClock: (t: number) => (clock = t) };
}

describe('PhoneInputSource', () => {
  test('neutral before any input', () => {
    const { src } = phoneRig();
    expect(src.sample(0)).toEqual({ tiltX: 0, tiltZ: 0, frameYaw: 1.25, power: false, jump: false });
  });

  test('filters tilt and passes power; frameYaw comes from the host', () => {
    const { src, send } = phoneRig();
    send(0, { tiltX: 0.2, tiltZ: -0.1, power: true });
    const s0 = src.sample(0);
    expect(s0).toMatchObject({ tiltX: expect.closeTo(0.2, 6), power: true, frameYaw: 1.25 });
    send(16, { tiltX: 0.3, tiltZ: -0.1, power: true });
    const s1 = src.sample(16);
    // Filtered: moved toward 0.3 but not all the way.
    expect(s1.tiltX).toBeGreaterThan(0.2);
    expect(s1.tiltX).toBeLessThan(0.3);
  });

  test(`stale rule: no frame for > ${STALE_INPUT_MS} ms → neutral (tilt 0, power off)`, () => {
    const { src, send } = phoneRig();
    send(0, { tiltX: 0.2, tiltZ: 0.2, power: true });
    expect(src.sample(STALE_INPUT_MS).power).toBe(true);
    expect(src.sample(STALE_INPUT_MS + 1)).toEqual({
      tiltX: 0,
      tiltZ: 0,
      frameYaw: 1.25,
      power: false,
      jump: false,
    });
    expect(src.debug(STALE_INPUT_MS + 1).stale).toBe(true);
    // Fresh input again: the filter restarts from the new value (no glide from the stale one).
    send(1000, { tiltX: -0.1, tiltZ: 0, power: true });
    expect(src.sample(1000).tiltX).toBeCloseTo(-0.1, 6);
  });

  test('drops out-of-order frames (wrapping seq)', () => {
    const { src, send } = phoneRig();
    send(0, { seq: 65534, tiltX: 0.1 });
    send(5, { seq: 65535, tiltX: 0.1 });
    send(10, { seq: 0, tiltX: 0.1 }); // wrapped: newer
    send(12, { seq: 65535, tiltX: 0.3 }); // late duplicate: dropped
    expect(src.lastFrame?.seq).toBe(0);
    expect(src.droppedOutOfOrder).toBe(1);
  });

  test('JUMP is latched between samples; MENU fires on the rising edge', () => {
    const { src, send, events } = phoneRig();
    send(0);
    src.sample(0);
    send(5, { jump: true, menu: true });
    send(10, { jump: false, menu: true });
    send(15, { jump: false, menu: false });
    expect(src.sample(16).jump).toBe(true);
    expect(src.sample(20).jump).toBe(false);
    expect(events.filter((e) => e === 'menu')).toHaveLength(1);
  });

  test('frame silence (phone locked, socket lingering) → disconnected; frames resume → connected', () => {
    const { src, send, events, sock } = phoneRig();
    sock.receive({ t: 'peer', role: 'controller', connected: true });
    send(0, { power: true });
    src.sample(1000);
    expect(events).toEqual(['connected']);
    expect(src.sample(1501)).toMatchObject({ power: false });
    expect(events).toEqual(['connected', 'disconnected']);
    send(5000);
    expect(events).toEqual(['connected', 'disconnected', 'connected']);
  });

  test('connected / disconnected follow the controller peer and the host socket', () => {
    const { sock, events, src, send } = phoneRig();
    sock.receive({ t: 'peer', role: 'controller', connected: true });
    send(0, { tiltX: 0.2, power: true });
    sock.receive({ t: 'peer', role: 'controller', connected: false });
    expect(src.sample(1)).toMatchObject({ power: false, tiltX: 0 });
    sock.receive({ t: 'peer', role: 'controller', connected: true });
    sock.serverClose(1006);
    expect(events).toEqual(['connected', 'disconnected', 'connected', 'disconnected']);
    expect(src.connected).toBe(false);
  });
});

// ── Keyboard ────────────────────────────────────────────────────────────────────────────────────────

function key(type: 'keydown' | 'keyup', code: string, extra: Record<string, unknown> = {}) {
  const e = Object.assign(new Event(type), { code, ...extra });
  if ('editableTarget' in extra) Object.defineProperty(e, 'target', { value: extra.editableTarget });
  return e;
}

function kbRig() {
  const target = new EventTarget();
  let clock = 0;
  const src = new KeyboardInputSource({ target, now: () => clock });
  const menus: number[] = [];
  src.on('menu', () => menus.push(clock));
  const at = (t: number) => {
    clock = t;
  };
  return { target, src, menus, at };
}

describe('KeyboardInputSource', () => {
  test('arrow ramps toward ±25° at 162°/s; any arrow held = POWER', () => {
    const { target, src, at } = kbRig();
    src.sample(0);
    at(0);
    target.dispatchEvent(key('keydown', 'ArrowUp'));
    const s1 = src.sample(100);
    expect(s1.power).toBe(true);
    expect(s1.tiltZ).toBeCloseTo(KEYBOARD_RAMP_RAD_PER_SEC * 0.1, 9);
    expect(s1.tiltX).toBe(0);
    const s2 = src.sample(1000);
    expect(s2.tiltZ).toBeCloseTo(KEYBOARD_TILT, 9);
    target.dispatchEvent(key('keydown', 'ArrowLeft'));
    expect(src.sample(2000)).toMatchObject({ tiltX: -KEYBOARD_TILT, tiltZ: KEYBOARD_TILT });
  });

  test('POWER stays on 100 ms after the last arrow is released', () => {
    const { target, src, at } = kbRig();
    at(0);
    target.dispatchEvent(key('keydown', 'ArrowRight'));
    src.sample(0);
    at(500);
    target.dispatchEvent(key('keyup', 'ArrowRight'));
    expect(src.sample(500 + KEYBOARD_POWER_RELEASE_MS).power).toBe(true);
    expect(src.sample(501 + KEYBOARD_POWER_RELEASE_MS).power).toBe(false);
  });

  test('WASD mirror arrows; Shift forces POWER; opposite keys cancel', () => {
    const { target, src } = kbRig();
    target.dispatchEvent(key('keydown', 'KeyD'));
    target.dispatchEvent(key('keydown', 'KeyA'));
    src.sample(0);
    expect(src.sample(1000)).toMatchObject({ tiltX: 0, power: true });
    target.dispatchEvent(key('keyup', 'KeyD'));
    target.dispatchEvent(key('keyup', 'KeyA'));
    target.dispatchEvent(key('keydown', 'ShiftLeft'));
    expect(src.sample(5000).power).toBe(true);
    target.dispatchEvent(key('keyup', 'ShiftLeft'));
    expect(src.sample(6000).power).toBe(false);
  });

  test('Space = JUMP (latched, ignores repeat); M and Esc = map', () => {
    const { target, src, menus } = kbRig();
    target.dispatchEvent(key('keydown', 'Space'));
    target.dispatchEvent(key('keyup', 'Space'));
    expect(src.sample(0).jump).toBe(true);
    expect(src.sample(16).jump).toBe(false);
    target.dispatchEvent(key('keydown', '', { key: 'm' }));
    target.dispatchEvent(key('keydown', 'KeyM', { repeat: true }));
    target.dispatchEvent(key('keydown', 'Escape'));
    expect(menus).toHaveLength(2);
  });

  test('blur releases all keys; typing in an input is ignored; dispose unbinds', () => {
    const { target, src } = kbRig();
    target.dispatchEvent(key('keydown', 'ArrowUp'));
    target.dispatchEvent(new Event('blur'));
    src.sample(0);
    expect(src.sample(1000)).toMatchObject({ tiltZ: 0, power: false });
    target.dispatchEvent(key('keydown', 'ArrowUp', { editableTarget: { tagName: 'INPUT' } }));
    expect(src.sample(1500).power).toBe(false);
    src.dispose();
    target.dispatchEvent(key('keydown', 'ArrowUp'));
    expect(src.sample(2000).power).toBe(false);
  });
});

// ── Gamepad ─────────────────────────────────────────────────────────────────────────────────────────

function pad(axes: number[], pressed: number[] = [], values: Record<number, number> = {}): GamepadLike {
  return {
    connected: true,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? 0 })),
  };
}

describe('GamepadInputSource', () => {
  test('left stick = tilt with deadzone; magnitude = POWER; A = jump', () => {
    let pads: (GamepadLike | null)[] = [null];
    const src = new GamepadInputSource({ getGamepads: () => pads });
    const ev: string[] = [];
    for (const e of ['menu', 'connected', 'disconnected'] as const) src.on(e, () => ev.push(e));
    expect(src.sample(0)).toMatchObject({ power: false, tiltX: 0 });
    pads = [null, pad([GAMEPAD_DEADZONE / 2, 0])];
    expect(src.sample(1)).toMatchObject({ power: false, tiltX: 0 });
    pads = [pad([1, 0])];
    expect(src.sample(2)).toMatchObject({ power: true, tiltX: KEYBOARD_TILT, tiltZ: -0 });
    pads = [pad([0, -1], [0])]; // stick up = forward
    expect(src.sample(3)).toMatchObject({ power: true, tiltZ: KEYBOARD_TILT, jump: true });
    pads = [pad([0, 0], [], { 7: 0.8 })]; // RT holds power at centre
    expect(src.sample(4)).toMatchObject({ power: true, tiltX: 0 });
    pads = [pad([0, 0], [9])];
    src.sample(5);
    src.sample(6);
    pads = [];
    src.sample(7);
    expect(ev).toEqual(['connected', 'menu', 'disconnected']);
  });
});

// ── Touch ───────────────────────────────────────────────────────────────────────────────────────────

describe('TouchInputSource', () => {
  test('virtual stick = tilt; deflection = POWER; jump latched; menu', () => {
    const src = new TouchInputSource();
    let menus = 0;
    src.on('menu', () => menus++);
    expect(src.sample(0)).toMatchObject({ power: false });
    src.setStick(0, 1);
    expect(src.sample(1)).toMatchObject({ power: true, tiltZ: KEYBOARD_TILT, tiltX: 0 });
    src.setStick(3, 4); // clamped to the unit circle
    const s = src.sample(2);
    expect(Math.hypot(s.tiltX, s.tiltZ)).toBeCloseTo(KEYBOARD_TILT, 9);
    src.setJump(true);
    src.setJump(false);
    expect(src.sample(3).jump).toBe(true);
    expect(src.sample(4).jump).toBe(false);
    src.pressMenu();
    expect(menus).toBe(1);
  });

  test('attachStick maps pointer drags from the element centre', () => {
    const src = new TouchInputSource();
    const el = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    const detach = src.attachStick(el);
    const pe = (type: string, x: number, y: number) =>
      el.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX: x, clientY: y }));
    pe('pointerdown', 200, 100); // right rim
    expect(src.sample(0)).toMatchObject({ power: true, tiltX: KEYBOARD_TILT });
    pe('pointermove', 100, 0); // top rim = forward
    expect(src.sample(1).tiltZ).toBeCloseTo(KEYBOARD_TILT, 9);
    pe('pointerup', 100, 0);
    expect(src.sample(2).power).toBe(false);
    detach();
    pe('pointerdown', 200, 100);
    expect(src.sample(3).power).toBe(false);
  });
});
