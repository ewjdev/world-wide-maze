/**
 * The bot's hands: turns (ball state, current leg) into an InputSample through the same channel a player uses.
 * - frameYaw = heading towards the pursuit point (a chase camera looking where the ball is going; G0),
 * - POWER held while steering, released to brake hard,
 * - tilt = the gravity rotation that produces the wanted acceleration (rolling sphere: a = 5/7·g·sin θ),
 *   clamped to the phone limits (pitch ±45°, roll ±20°),
 * - pure pursuit along the leg with a speed profile (caps, corners, braking) from plan.ts.
 * It only uses what a player can see: the stage and the ball.
 */
import {
  GRAVITY_MPS2,
  type InputSample,
  MAX_TILT_PITCH,
  MAX_TILT_ROLL,
  pxToMeters,
  type Vec2,
} from '@wwm/schema';
import type { Leg, LegVertex } from './plan.ts';

export interface PilotGains {
  /** Velocity-error gain (1/s). */
  kv: number;
  /** Feed-forward against damping: a += kff · v_des. */
  kff: number;
  /** Pursuit look-ahead: L = clamp(l0 + lv · speed, l0, lMax) (m). */
  l0: number;
  lv: number;
  lMax: number;
  /** Max tilt: pitch / roll (rad). Default: phone limits. */
  maxPitch: number;
  maxRoll: number;
  /** Turns sharper than this (rad) are driven through the vertex instead of cut. */
  cornerClampRad: number;
  /** Distance (m) at which a clamped corner counts as reached. */
  cornerReach: number;
}

export const DEFAULT_GAINS: Readonly<PilotGains> = Object.freeze({
  kv: 3.2,
  kff: 1.3,
  l0: 0.55,
  lv: 0.2,
  lMax: 2.2,
  maxPitch: MAX_TILT_PITCH,
  maxRoll: MAX_TILT_ROLL,
  cornerClampRad: 0.7,
  cornerReach: 0.35,
});

/** Horizontal acceleration of a rolling solid sphere per unit sin(tilt) (m/s²). */
const A_ROLL = (5 / 7) * GRAVITY_MPS2;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0; // no -0: replays survive JSON

export const NEUTRAL: Readonly<InputSample> = Object.freeze({
  tiltX: 0,
  tiltZ: 0,
  frameYaw: 0,
  power: false,
  jump: false,
});

export interface Tracking {
  /** Current segment index (monotonic within a leg). */
  seg: number;
  /** Arc length (m) of the projection. */
  s: number;
  /** Distance from the leg (m). */
  cross: number;
  /** Distance to the leg end (m). */
  toEnd: number;
  /** Last yaw sent (rad) — held when the target is right under the ball. */
  yaw: number;
}

export function newTracking(): Tracking {
  return { seg: 0, s: 0, cross: 0, toEnd: Number.POSITIVE_INFINITY, yaw: 0 };
}

function vm(p: Vec2): [number, number] {
  return [pxToMeters(p[0]), pxToMeters(p[1])];
}

/** Project (x, z) (m) onto the leg near the current segment; updates `t`. */
export function track(leg: Leg, x: number, z: number, t: Tracking): void {
  const vs = leg.verts;
  if (vs.length < 2) {
    const [px, pz] = vm((vs[0] as LegVertex).p);
    t.s = 0;
    t.cross = Math.hypot(px - x, pz - z);
    t.toEnd = t.cross;
    return;
  }
  let best = Number.POSITIVE_INFINITY;
  let bestSeg = t.seg;
  let bestS = t.s;
  const last = Math.min(vs.length - 2, t.seg + 4);
  for (let j = Math.max(0, t.seg - 1); j <= last; j++) {
    const a = vs[j] as LegVertex;
    const b = vs[j + 1] as LegVertex;
    const [ax, az] = vm(a.p);
    const [bx, bz] = vm(b.p);
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    const u = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    const d = Math.hypot(ax + dx * u - x, az + dz * u - z);
    // Prefer later segments on ties (the path doubles back through the same cell around elevator axes).
    if (d < best - 1e-6 || (d <= best + 0.05 && j > bestSeg)) {
      best = d;
      bestSeg = j;
      bestS = a.s + (b.s - a.s) * u;
    }
  }
  t.seg = Math.max(t.seg, bestSeg);
  t.s = bestS;
  t.cross = best;
  t.toEnd = leg.length - bestS;
}

/** Point on the leg at arc length s (m, clamped). */
export function pointAt(leg: Leg, s: number, fromSeg = 0): [number, number] {
  const vs = leg.verts;
  if (s <= 0 || vs.length < 2) return vm((vs[0] as LegVertex).p);
  for (let j = Math.max(0, fromSeg); j < vs.length - 1; j++) {
    const a = vs[j] as LegVertex;
    const b = vs[j + 1] as LegVertex;
    if (s <= b.s || j === vs.length - 2) {
      const u = b.s > a.s ? clamp((s - a.s) / (b.s - a.s), 0, 1) : 1;
      const [ax, az] = vm(a.p);
      const [bx, bz] = vm(b.p);
      return [ax + (bx - ax) * u, az + (bz - az) * u];
    }
  }
  return vm((vs[vs.length - 1] as LegVertex).p);
}

/** Speed limit (m/s) at arc length s: the segment cap and every upcoming vertex's braking curve. */
export function speedLimit(leg: Leg, t: Tracking, brake: number): number {
  const vs = leg.verts;
  let v = (vs[t.seg] as LegVertex).cap;
  for (let k = t.seg + 1; k < vs.length; k++) {
    const vk = vs[k] as LegVertex;
    const ds = vk.s - t.s;
    if (ds > 40) break;
    v = Math.min(v, Math.sqrt(vk.v * vk.v + 2 * brake * Math.max(0, ds)));
  }
  return v;
}

/**
 * One control step. `pos`/`vel` are world (m); returns the InputSample (rounded to 1e-4 so replays are
 * compact and exactly reproducible).
 */
export function steer(
  leg: Leg,
  t: Tracking,
  pos: readonly [number, number, number],
  vel: readonly [number, number, number],
  gains: PilotGains,
  brake: number,
  speedScale = 1,
): InputSample {
  const x = pos[0];
  const z = pos[2];
  track(leg, x, z, t);
  const speed = Math.hypot(vel[0], vel[2]);
  const L = clamp(gains.l0 + gains.lv * speed, gains.l0, gains.lMax);
  let [tx, tz] = pointAt(leg, t.s + L, t.seg);
  // Don't cut sharp corners: aim at the corner vertex itself until the ball is close to it.
  const corner = leg.verts[t.seg + 1];
  if (corner && t.seg + 2 < leg.verts.length && corner.turn > gains.cornerClampRad) {
    const [cx, cz] = vm(corner.p);
    if (Math.hypot(cx - x, cz - z) > gains.cornerReach && t.s + L > corner.s) {
      tx = cx;
      tz = cz;
    }
  }
  let dx = tx - x;
  let dz = tz - z;
  let dist = Math.hypot(dx, dz);
  if (dist < 1e-3) {
    dx = -Math.sin(t.yaw);
    dz = -Math.cos(t.yaw);
    dist = 1;
  }
  const vDes = speedLimit(leg, t, brake) * speedScale;
  const ux = dx / dist;
  const uz = dz / dist;
  const ax = gains.kv * (vDes * ux - vel[0]) + gains.kff * vDes * ux;
  const az = gains.kv * (vDes * uz - vel[2]) + gains.kff * vDes * uz;
  const yaw = Math.atan2(-ux, -uz);
  t.yaw = yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const af = ax * fx + az * fz;
  const ar = ax * rx + az * rz;
  const tiltZ = clamp(Math.asin(clamp(af / A_ROLL, -1, 1)), -gains.maxPitch, gains.maxPitch);
  const tiltX = clamp(Math.asin(clamp(ar / A_ROLL, -1, 1)), -gains.maxRoll, gains.maxRoll);
  return { tiltX: r4(tiltX), tiltZ: r4(tiltZ), frameYaw: r4(yaw), power: true, jump: false };
}
