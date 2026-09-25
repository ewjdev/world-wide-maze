/**
 * Controller-side tilt pipeline (contracts §6: tilts are radians, calibrated, clamped per axis).
 *
 * 1. DeviceOrientation (alpha, beta, gamma in degrees, intrinsic Z-X'-Y') → the gravity direction in the
 *    device frame. Alpha (compass heading) drops out, so turning your body (or compass drift) never tilts
 *    the ball.
 * 2. Rotate into the *screen* frame using `screen.orientation.angle`, so "forward" is always the top of
 *    what the player sees.
 * 3. Calibration stores the **zero pose** as a gravity vector in the device frame (screen-independent, so a
 *    rotation mid-game keeps the same rest pose).
 * 4. Tilt = the rotation about the screen x axis (pitch) and then the screen y axis (roll) that carries the
 *    zero gravity onto the current gravity, solved in closed form. This is rotation-based, with no Euler
 *    angle subtraction, so a phone held at 45° that rolls 10° about its long axis reads as 10° of roll
 *    (flattening gravity would read ≈ 7°).
 * 5. Clamp to MAX_TILT_ROLL / MAX_TILT_PITCH (E: phone ±20° roll, ±45° pitch).
 *
 * Frames: x = right, y = toward the top of the screen, z = out of the screen (W3C device frame).
 * Output: tiltX + = right edge down (roll right), tiltZ + = top edge down (pitch forward / away).
 */
import { MAX_TILT_PITCH, MAX_TILT_ROLL } from '@wwm/schema';

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

export interface OrientationAngles {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

/** Gravity (unit vector pointing down) in the device frame. Returns null if beta/gamma are unavailable. */
export function gravityFromOrientation(o: OrientationAngles): Vec3 | null {
  if (o.beta == null || o.gamma == null || !Number.isFinite(o.beta) || !Number.isFinite(o.gamma)) return null;
  const b = o.beta * DEG;
  const g = o.gamma * DEG;
  const cb = Math.cos(b);
  // The third row of Rz(α)·Rx(β)·Ry(γ) is world "up" in device coords; gravity is its negation.
  return [cb * Math.sin(g), -Math.sin(b), -cb * Math.cos(g)];
}

/** Rotate a device-frame vector into the screen frame for `screen.orientation.angle` (degrees). */
export function deviceToScreen(v: Vec3, screenAngleDeg: number): Vec3 {
  const t = (screenAngleDeg || 0) * DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]];
}

export function screenToDevice(v: Vec3, screenAngleDeg: number): Vec3 {
  return deviceToScreen(v, -(screenAngleDeg || 0));
}

export function normalize3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Angle between two vectors in radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const [ax, ay, az] = normalize3(a);
  const [bx, by, bz] = normalize3(b);
  const d = Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz));
  return Math.acos(d);
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Gravity of a phone lying flat, screen up: the default zero. */
export const FLAT_GRAVITY: Vec3 = [0, 0, -1];

/**
 * R: the 2013 PC side assumed a pitch neutral of 45° toward the player (gamma −45° in its grip). In a
 * portrait grip that's beta = 45°. The calibration dots guide the player toward this pose; the zero is then
 * recorded from whatever pose they actually hold.
 */
export const DEFAULT_NEUTRAL_GRAVITY: Vec3 = [0, -Math.SQRT1_2, -Math.SQRT1_2];

export interface Tilt {
  /** rad, roll, + = right. */
  tiltX: number;
  /** rad, pitch, + = forward (top edge away from the player). */
  tiltZ: number;
}

/**
 * Unclamped tilt of screen-frame gravity `g` relative to the screen-frame zero gravity `zero`:
 * the pitch θ about x and then roll φ about y with R_y(φ)·R_x(θ)·zero = g.
 */
export function tiltFromGravity(g: Vec3, zero: Vec3 = FLAT_GRAVITY): Tilt {
  const [gx, gy, gz] = normalize3(g);
  const [zx, zy, zz] = normalize3(zero);
  // Rotation about y keeps the y component, so pitch alone must produce g_y:
  // zy·cosθ − zz·sinθ = gy  ⇔  r·cos(θ − δ) = gy.
  const r = Math.hypot(zy, zz);
  let theta = 0;
  if (r > 1e-6) {
    const delta = Math.atan2(-zz, zy);
    const a = Math.acos(Math.min(1, Math.max(-1, gy / r)));
    const t1 = wrap(delta + a);
    const t2 = wrap(delta - a);
    theta = Math.abs(t1) < Math.abs(t2) ? t1 : t2;
  }
  // v = R_x(θ)·zero, then roll is the remaining angle in the x–z plane.
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const vx = zx;
  const vz = zy * s + zz * c;
  const phi = wrap(Math.atan2(gx, -gz) - Math.atan2(vx, -vz));
  return { tiltX: phi, tiltZ: theta };
}

export function clampTilt(t: Tilt): Tilt {
  const c = (v: number, m: number) => (v > m ? m : v < -m ? -m : v);
  return { tiltX: c(t.tiltX, MAX_TILT_ROLL), tiltZ: c(t.tiltZ, MAX_TILT_PITCH) };
}

/**
 * Tilt indicator position, normalized so ±1 = the clamp limit on each axis (roll ±20°, pitch ±45°).
 * `r` is the radial distance used by "Too tilted!" and the calibration dots.
 */
export function indicator(t: Tilt): { x: number; z: number; r: number } {
  const x = t.tiltX / MAX_TILT_ROLL;
  const z = t.tiltZ / MAX_TILT_PITCH;
  return { x, z, r: Math.hypot(x, z) };
}

/**
 * The whole pipeline: orientation event → calibrated tilt. `zeroDevice` is the calibrated rest gravity in
 * the device frame (default: flat). Returns null if the event carries no sensor data.
 */
export function orientationToTilt(
  o: OrientationAngles,
  screenAngleDeg: number,
  zeroDevice: Vec3 = FLAT_GRAVITY,
): { raw: Tilt; clamped: Tilt; gravity: Vec3 } | null {
  const gd = gravityFromOrientation(o);
  if (!gd) return null;
  const gravity = deviceToScreen(gd, screenAngleDeg);
  const raw = tiltFromGravity(gravity, deviceToScreen(zeroDevice, screenAngleDeg));
  return { raw, clamped: clampTilt(raw), gravity };
}

// ── Calibration (E: first game only, 15 s timeout → keyboard; success ≈ within 2° of the zero pose) ──

export const CALIBRATION_TIMEOUT_MS = 15_000;
/** E: indicator within 3 of 90 px of centre ≈ 2°. Here the held pose must stay within 2° while held. */
export const CALIBRATION_TOLERANCE_RAD = 2 * DEG;
/** N: how long the pose must be held steady. */
export const CALIBRATION_HOLD_MS = 700;
/** N: an auto-detected zero must be within this angle of the default neutral (45° toward the player). */
export const CALIBRATION_CAPTURE_RAD = 40 * DEG;

export type CalibrationStatus =
  | { state: 'waiting'; progress: number; offNeutral: number }
  | { state: 'done'; zero: Vec3 }
  | { state: 'timeout' };

/**
 * "Tilt the phone to match the dots": success once screen-frame gravity stays within
 * CALIBRATION_TOLERANCE_RAD of a candidate pose for CALIBRATION_HOLD_MS, with the candidate inside the
 * capture zone around the default neutral. The zero (returned in the same frame as the input) is the held
 * pose (R).
 */
export class CalibrationDetector {
  readonly startedAt: number;
  readonly timeoutMs: number;
  #candidate: Vec3 | null = null;
  #candidateSince = 0;
  #done: CalibrationStatus | null = null;

  constructor(nowMs: number, timeoutMs = CALIBRATION_TIMEOUT_MS) {
    this.startedAt = nowMs;
    this.timeoutMs = timeoutMs;
  }

  update(gravity: Vec3 | null, nowMs: number): CalibrationStatus {
    if (this.#done) return this.#done;
    if (nowMs - this.startedAt >= this.timeoutMs) {
      this.#done = { state: 'timeout' };
      return this.#done;
    }
    if (!gravity) return { state: 'waiting', progress: 0, offNeutral: Number.NaN };
    const g = normalize3(gravity);
    const offNeutral = angleBetween(g, DEFAULT_NEUTRAL_GRAVITY);
    if (
      !this.#candidate ||
      angleBetween(g, this.#candidate) > CALIBRATION_TOLERANCE_RAD ||
      offNeutral > CALIBRATION_CAPTURE_RAD
    ) {
      this.#candidate = g;
      this.#candidateSince = nowMs;
      return { state: 'waiting', progress: 0, offNeutral };
    }
    const held = nowMs - this.#candidateSince;
    if (held >= CALIBRATION_HOLD_MS) {
      this.#done = { state: 'done', zero: this.#candidate };
      return this.#done;
    }
    return { state: 'waiting', progress: held / CALIBRATION_HOLD_MS, offNeutral };
  }

  /** Manual "Use this position" tap. */
  force(gravity: Vec3): CalibrationStatus {
    this.#done = { state: 'done', zero: normalize3(gravity) };
    return this.#done;
  }
}

// ── "Too tilted!" (E: > 45/90 of the indicator ≈ half its range, 500 ms hysteresis) ──

/**
 * R: the 2013 indicator ring spans ±2× the max tilt, so "beyond half range" = beyond the clamp limit,
 * i.e. normalized radius > 1. Shows immediately; hides only after 500 ms continuously below.
 */
export class TooTiltedDetector {
  threshold: number;
  hysteresisMs: number;
  #visible = false;
  #belowSince: number | null = null;

  constructor(threshold = 1, hysteresisMs = 500) {
    this.threshold = threshold;
    this.hysteresisMs = hysteresisMs;
  }

  update(t: Tilt, nowMs: number): boolean {
    const over = indicator(t).r > this.threshold;
    if (over) {
      this.#visible = true;
      this.#belowSince = null;
    } else if (this.#visible) {
      if (this.#belowSince === null) this.#belowSince = nowMs;
      if (nowMs - this.#belowSince >= this.hysteresisMs) this.#visible = false;
    }
    return this.#visible;
  }

  get visible(): boolean {
    return this.#visible;
  }
}
