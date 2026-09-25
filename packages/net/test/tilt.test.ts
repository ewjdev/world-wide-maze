import { MAX_TILT_PITCH, MAX_TILT_ROLL } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import {
  CALIBRATION_HOLD_MS,
  CALIBRATION_TIMEOUT_MS,
  CalibrationDetector,
  deviceToScreen,
  gravityFromOrientation,
  indicator,
  orientationToTilt,
  screenToDevice,
  TooTiltedDetector,
  tiltFromGravity,
  type Vec3,
} from '../src/tilt.ts';

const DEG = Math.PI / 180;
const close = (a: Vec3, b: Vec3, d = 9) => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i] as number, d);
};

describe('gravity from DeviceOrientation', () => {
  test('flat, upright, rolled', () => {
    close(gravityFromOrientation({ alpha: 0, beta: 0, gamma: 0 }) as Vec3, [0, 0, -1]);
    close(gravityFromOrientation({ alpha: 0, beta: 90, gamma: 0 }) as Vec3, [0, -1, 0]);
    close(gravityFromOrientation({ alpha: 0, beta: 0, gamma: 30 }) as Vec3, [
      Math.sin(30 * DEG),
      0,
      -Math.cos(30 * DEG),
    ]);
    expect(gravityFromOrientation({ alpha: null, beta: null, gamma: null })).toBeNull();
  });

  test('compass heading (alpha) never changes gravity', () => {
    const a = gravityFromOrientation({ alpha: 0, beta: 40, gamma: 10 }) as Vec3;
    const b = gravityFromOrientation({ alpha: 137, beta: 40, gamma: 10 }) as Vec3;
    close(a, b);
  });

  test('screen rotation: landscape 90° maps device top to screen right', () => {
    // Device +y (top) points down → gravity has +y; in landscape-90 that is screen +x.
    close(deviceToScreen([0, 1, 0], 90), [1, 0, 0]);
    close(deviceToScreen([1, 0, 0], 90), [0, -1, 0]);
    close(deviceToScreen([0.3, 0.4, -0.8], 0), [0.3, 0.4, -0.8]);
  });
});

describe('calibrated tilt', () => {
  const held = gravityFromOrientation({ alpha: 0, beta: 45, gamma: 0 }) as Vec3;
  const zero = held; // portrait: device frame = screen frame

  test('the held pose reads as zero tilt', () => {
    const t = tiltFromGravity(held, zero);
    expect(t.tiltX).toBeCloseTo(0, 9);
    expect(t.tiltZ).toBeCloseTo(0, 9);
  });

  test('tipping the top away = +pitch; right edge down = +roll', () => {
    const away = orientationToTilt({ alpha: 0, beta: 45 - 10, gamma: 0 }, 0, zero);
    expect(away?.raw.tiltZ).toBeCloseTo(10 * DEG, 6);
    expect(away?.raw.tiltX).toBeCloseTo(0, 6);
    const toward = orientationToTilt({ alpha: 0, beta: 45 + 10, gamma: 0 }, 0, zero);
    expect(toward?.raw.tiltZ).toBeCloseTo(-10 * DEG, 6);
    const right = orientationToTilt({ alpha: 0, beta: 0, gamma: 10 }, 0);
    expect(right?.raw.tiltX).toBeCloseTo(10 * DEG, 6);
  });

  test('rolling 10° about the long axis while held at 45° reads as 10° roll, no pitch cross-talk', () => {
    const g = gravityFromOrientation({ alpha: 0, beta: 45, gamma: 10 }) as Vec3;
    const t = tiltFromGravity(g, zero);
    expect(t.tiltX).toBeCloseTo(10 * DEG, 9);
    expect(t.tiltZ).toBeCloseTo(0, 9);
  });

  test('pitch then roll from the zero decomposes exactly', () => {
    for (const [dp, dr] of [
      [15, 12],
      [-30, -5],
      [40, 19],
    ] as const) {
      const g = gravityFromOrientation({ alpha: 0, beta: 45 - dp, gamma: dr }) as Vec3;
      const t = tiltFromGravity(g, zero);
      expect(t.tiltZ).toBeCloseTo(dp * DEG, 9);
      expect(t.tiltX).toBeCloseTo(dr * DEG, 9);
    }
  });

  test('works near upright without gimbal blow-ups', () => {
    const up = gravityFromOrientation({ alpha: 0, beta: 80, gamma: 0 }) as Vec3;
    const t = orientationToTilt({ alpha: 50, beta: 89.9, gamma: 3 }, 0, up);
    expect(Number.isFinite(t?.raw.tiltX)).toBe(true);
    expect(Math.abs(t?.raw.tiltZ ?? 9)).toBeLessThan(10 * DEG);
  });

  test('clamps per axis (±20° roll, ±45° pitch)', () => {
    const t = orientationToTilt({ alpha: 0, beta: -30, gamma: 40 }, 0);
    expect(t?.clamped.tiltX).toBe(MAX_TILT_ROLL);
    expect(t?.clamped.tiltZ).toBeCloseTo(Math.min(MAX_TILT_PITCH, t?.raw.tiltZ ?? 0), 9);
    const t2 = orientationToTilt({ alpha: 0, beta: -80, gamma: 0 }, 0);
    expect(t2?.clamped.tiltZ).toBe(MAX_TILT_PITCH);
  });

  test('landscape: same physical tilt gives the same screen-relative tilt', () => {
    // In landscape-90 the screen's right edge is the device top. Tipping the device top down = roll right.
    const t = orientationToTilt({ alpha: 0, beta: -10, gamma: 0 }, 90)?.raw;
    expect(t?.tiltX).toBeCloseTo(10 * DEG, 6);
    expect(t?.tiltZ).toBeCloseTo(0, 6);
    // A device-frame zero survives a screen rotation: the rest pose still reads as zero.
    const restDevice = gravityFromOrientation({ alpha: 0, beta: 20, gamma: -30 }) as Vec3;
    for (const angle of [0, 90, 180, 270]) {
      const r = orientationToTilt({ alpha: 0, beta: 20, gamma: -30 }, angle, restDevice)?.raw;
      expect(Math.abs(r?.tiltX ?? 1) + Math.abs(r?.tiltZ ?? 1)).toBeLessThan(1e-9);
    }
    close(screenToDevice(deviceToScreen(restDevice, 90), 90), restDevice);
  });
});

describe('CalibrationDetector', () => {
  const g45 = gravityFromOrientation({ alpha: 0, beta: 45, gamma: 0 }) as Vec3;
  const g47 = gravityFromOrientation({ alpha: 0, beta: 45.8, gamma: 0.5 }) as Vec3;

  test('succeeds after holding steady within 2°, zero = held pose', () => {
    const c = new CalibrationDetector(0);
    let s = c.update(g45, 0);
    for (let t = 16; s.state === 'waiting' && t < 2000; t += 16) s = c.update(t % 32 ? g45 : g47, t);
    expect(s.state).toBe('done');
    if (s.state !== 'done') return;
    // The zero is a pose that was actually held (either sample), within 2° of both.
    const t = tiltFromGravity(g45, s.zero);
    expect(Math.abs(t.tiltX) + Math.abs(t.tiltZ)).toBeLessThan(2 * DEG);
  });

  test('moving more than 2° restarts the hold', () => {
    const c = new CalibrationDetector(0);
    c.update(g45, 0);
    c.update(g45, CALIBRATION_HOLD_MS - 10);
    const moved = gravityFromOrientation({ alpha: 0, beta: 50, gamma: 0 }) as Vec3;
    expect(c.update(moved, CALIBRATION_HOLD_MS)).toMatchObject({ state: 'waiting', progress: 0 });
    expect(c.update(moved, CALIBRATION_HOLD_MS * 2 + 1).state).toBe('done');
  });

  test('a pose far from the neutral (upside down) never auto-calibrates; times out after 15 s', () => {
    const c = new CalibrationDetector(1000);
    const upsideDown = gravityFromOrientation({ alpha: 0, beta: 180, gamma: 0 }) as Vec3;
    let s = c.update(upsideDown, 1000);
    for (let t = 1000; t < 1000 + CALIBRATION_TIMEOUT_MS - 1; t += 100) s = c.update(upsideDown, t);
    expect(s.state).toBe('waiting');
    expect(c.update(upsideDown, 1000 + CALIBRATION_TIMEOUT_MS).state).toBe('timeout');
    expect(c.update(g45, 1000 + CALIBRATION_TIMEOUT_MS + 5000).state).toBe('timeout');
  });

  test('manual "use this position"', () => {
    const c = new CalibrationDetector(0);
    expect(c.force(g45).state).toBe('done');
  });
});

describe('TooTiltedDetector', () => {
  test('shows past the limit, hides only after 500 ms below', () => {
    const d = new TooTiltedDetector();
    expect(d.update({ tiltX: 0.1, tiltZ: 0.1 }, 0)).toBe(false);
    expect(d.update({ tiltX: MAX_TILT_ROLL * 1.2, tiltZ: 0 }, 100)).toBe(true);
    expect(d.update({ tiltX: 0, tiltZ: 0 }, 200)).toBe(true);
    expect(d.update({ tiltX: 0, tiltZ: 0 }, 650)).toBe(true);
    expect(d.update({ tiltX: 0, tiltZ: 0 }, 700)).toBe(false);
    expect(indicator({ tiltX: MAX_TILT_ROLL, tiltZ: 0 }).r).toBeCloseTo(1);
  });
});
