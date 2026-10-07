import { gravityFromOrientation, type OrientationAngles, TiltInputSource } from '@wwm/net';
import { describe, expect, test } from 'vitest';
import { Countdown } from '../src/game/countdown.ts';
import { transition } from '../src/game/machine.ts';
import { mobileTiltEnabled } from '../src/input/flags.ts';
import { readMotionPreferences } from '../src/input/motion-preferences.ts';
import {
  canAdvance,
  canResume,
  canStart,
  type MotionEnvironment,
  type MotionReading,
  MotionSession,
} from '../src/input/motion-session.ts';

function rig(options: Partial<MotionEnvironment> = {}) {
  let now = 0;
  let visible = true;
  let orientation: ((reading: OrientationAngles) => void) | null = null;
  let motion: ((reading: MotionReading) => void) | null = null;
  let inactive: ((reason: 'focus' | 'rotation') => void) | null = null;
  let check: (() => void) | null = null;
  let angles: OrientationAngles = { alpha: null, beta: 0, gamma: 0 };
  const source = new TiltInputSource();
  const env: MotionEnvironment = {
    now: () => now,
    visible: () => visible,
    secure: () => true,
    supported: () => true,
    angle: () => 0,
    orientation: (listener) => {
      orientation = listener;
      return () => {
        orientation = null;
      };
    },
    motion: (listener) => {
      motion = listener;
      return () => {
        motion = null;
      };
    },
    inactive: (listener) => {
      inactive = listener;
      return () => {
        inactive = null;
      };
    },
    interval: (listener) => {
      check = listener;
      return () => {
        check = null;
      };
    },
    ...options,
  };
  const session = new MotionSession(source, env);
  const advance = (ms: number) => {
    now += ms;
    check?.();
  };
  const emit = (beta = 0, gamma = 0) => {
    angles = { alpha: null, beta, gamma };
    orientation?.(angles);
  };
  const heartbeat = (beta = angles.beta ?? 0, gamma = angles.gamma ?? 0) => {
    const gravity = gravityFromOrientation({ alpha: null, beta, gamma });
    if (!gravity) throw new Error('Invalid synthetic gravity');
    motion?.({
      gravity: { x: -gravity[0] * 9.8, y: -gravity[1] * 9.8, z: -gravity[2] * 9.8 },
      rotation: { beta: 0, gamma: 0 },
    });
  };
  const calibrate = async () => {
    await session.enableTilt();
    emit();
    heartbeat();
    advance(100);
    emit(8);
    heartbeat();
    advance(100);
    heartbeat();
    for (let n = 0; n < 8; n++) {
      advance(100);
      heartbeat();
    }
    expect(session.getSnapshot().state).toBe('ready');
  };
  return {
    session,
    source,
    advance,
    emit,
    heartbeat,
    calibrate,
    hide: () => {
      visible = false;
      inactive?.('focus');
    },
    rotate: () => inactive?.('rotation'),
    listening: () => !!orientation,
  };
}

describe('motion setup and health', () => {
  test('no request on construction; both permission APIs run synchronously in the Enable gesture', async () => {
    const calls: string[] = [];
    let release!: (value: string) => void;
    const r = rig({
      requestOrientation: () => {
        calls.push('orientation');
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      requestMotion: () => {
        calls.push('motion');
        return Promise.resolve('granted');
      },
    });
    expect(calls).toEqual([]);
    const pending = r.session.enableTilt();
    expect(calls).toEqual(['orientation', 'motion']);
    r.advance(5000);
    expect(r.session.getSnapshot().state).toBe('requesting');
    release('granted');
    await pending;
    expect(r.session.getSnapshot().state).toBe('probing');
    r.session.dispose();
  });
  test('absent permission methods work; zeros, movement and a steady grip reach ready', async () => {
    const r = rig();
    await r.calibrate();
    expect(r.source.peek(0).power).toBe(false);
    r.session.dispose();
  });
  test('permission denial, insecure context, unusable readings and static/frozen probes never arm', async () => {
    for (const options of [
      { requestOrientation: async () => 'denied' },
      {
        requestOrientation: async () => {
          throw new Error('Blocked permission request');
        },
      },
      { secure: () => false },
      { supported: () => false },
      {},
    ]) {
      const r = rig(options);
      await r.session.enableTilt();
      r.advance(2600);
      expect(['denied', 'unavailable']).toContain(r.session.getSnapshot().state);
      expect(r.listening()).toBe(false);
      r.session.dispose();
    }
    const r = rig();
    await r.session.enableTilt();
    r.emit();
    for (let n = 0; n < 121; n++) {
      r.heartbeat();
      r.advance(100);
    }
    expect(r.session.getSnapshot().state).toBe('unavailable');
    r.session.dispose();
  });
  test('fallback/disposal invalidates late permission completion and duplicate enable does not create listeners', async () => {
    let release!: (value: string) => void;
    const r = rig({
      requestOrientation: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const pending = r.session.enableTilt();
    await r.session.enableTilt();
    r.session.reset();
    release('granted');
    await pending;
    expect(r.listening()).toBe(false);
    expect(r.session.getSnapshot().state).toBe('idle');
    r.session.dispose();
  });
  test('still neutral and steady steering remain healthy with motion heartbeats; lost heartbeats pause', async () => {
    const r = rig();
    await r.calibrate();
    for (let n = 0; n < 300; n++) {
      r.advance(100);
      r.heartbeat();
    }
    expect(r.session.getSnapshot().state).toBe('ready');
    r.emit(8, 12);
    for (let n = 0; n < 300; n++) {
      r.advance(100);
      r.heartbeat();
    }
    expect(r.session.getSnapshot().state).toBe('ready');
    expect(r.source.peek(0).power).toBe(true);
    r.source.reset();
    expect(r.source.peek(0).power).toBe(false);
    r.session.restoreInput();
    expect(r.source.peek(0).power).toBe(true);
    r.advance(1600);
    expect(r.session.getSnapshot().state).toBe('interrupted');
    expect(r.source.peek(0).power).toBe(false);
    r.session.dispose();
  });
  test('live companion gravity cannot certify frozen orientation, and rotation/visibility require a new check', async () => {
    const r = rig();
    await r.calibrate();
    for (let n = 0; n < 10; n++) {
      r.heartbeat(8, 30);
      r.advance(100);
    }
    expect(r.session.getSnapshot().state).toBe('interrupted');
    await r.calibrate();
    r.rotate();
    expect(r.session.getSnapshot().state).toBe('interrupted');
    await r.calibrate();
    r.hide();
    expect(r.session.getSnapshot().state).toBe('interrupted');
    r.session.dispose();
  });
  test('sustained null/nonfinite orientation is rejected even with a live companion', async () => {
    const r = rig();
    await r.calibrate();
    for (let n = 0; n < 10; n++) {
      r.emit(NaN);
      r.heartbeat(8);
      r.advance(100);
    }
    expect(r.session.getSnapshot().state).toBe('interrupted');
    r.session.dispose();
  });
});

test('readiness alone is insufficient: actual driver, intent, ownership and contact release are checked', async () => {
  const r = rig();
  await r.calibrate();
  const context = {
    selected: true,
    snapshot: r.session.getSnapshot(),
    visible: true,
    driverKind: 'lockstep',
    intent: true,
    armed: true,
    ownsInput: true,
    contactsReleased: true,
  };
  expect(canStart(context)).toBe(true);
  expect(canResume(context)).toBe(true);
  expect(canAdvance(context)).toBe(true);
  expect(canStart({ ...context, intent: false })).toBe(false);
  expect(canStart({ ...context, driverKind: 'worker' })).toBe(false);
  expect(canResume({ ...context, contactsReleased: false })).toBe(false);
  expect(canAdvance({ ...context, ownsInput: false })).toBe(false);
  for (const state of [
    'idle',
    'requesting',
    'probing',
    'calibrating',
    'interrupted',
    'denied',
    'unavailable',
    'disposed',
  ] as const)
    expect(canStart({ ...context, snapshot: { ...context.snapshot, state } })).toBe(false);
  r.session.dispose();
});

test('Original retains every fractional countdown beat across repeated pauses, and Go happens once', () => {
  for (let beat = 3; beat >= 1; beat--) {
    const countdown = new Countdown();
    countdown.advance((3 - beat) * 0.6 + 0.27);
    expect(countdown.beat).toBe(beat);
    expect(countdown.remaining).toBeCloseTo(0.33);
    for (let n = 0; n < 3; n++) {
      expect(transition('countdown', { type: 'MENU' })).toBe('paused');
      expect(transition('paused', { type: 'RESUME', destination: 'countdown' })).toBe('countdown');
      expect(countdown.remaining).toBeCloseTo(0.33);
    }
    expect(countdown.advance(0.32)).toEqual([]);
    expect(countdown.advance(0.02)).toEqual([beat - 1]);
    countdown.advance(4);
    expect(countdown.beat).toBe(0);
    expect(countdown.advance(4)).toEqual([]);
  }
});

test('tilt requires explicit flag and motion preferences tolerate broken or denied storage', () => {
  expect(mobileTiltEnabled({})).toBe(false);
  expect(mobileTiltEnabled({ VITE_MOBILE_TILT_ENABLED: 'true' })).toBe(true);
  expect(mobileTiltEnabled({ VITE_MOBILE_TILT_ENABLED: '1' })).toBe(false);
  expect(readMotionPreferences({ getItem: () => '{broken' }).mode).toBe('tilt');
  expect(
    readMotionPreferences({ getItem: () => '{"mode":"joystick","sensitivity":100,"showJump":true}' }),
  ).toEqual({ mode: 'joystick', sensitivity: 1.5, showJump: true });
});
