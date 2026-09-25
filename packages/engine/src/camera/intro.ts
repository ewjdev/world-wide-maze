/**
 * The "website becomes maze" opening (E: `stage.startIntro`, `followcamera.opening`, `world` OPENING):
 * 1. the page stands upright, then folds flat; 2. islands extrude; 3. bridges rise; 4. rails, items and the
 * goal appear; 5. the camera flies over from start to goal; 6. the ball drops in a cage.
 *
 * 2013 took ≈ 20 s. `full` (first play) keeps the sequence at 16 s; `fast` compresses it to < 8 s (N).
 * Pure timing + camera-key maths; the engine applies it.
 */
import { Vector3 } from 'three/webgpu';

export type IntroMode = 'full' | 'fast';

export interface Window {
  start: number;
  end: number;
}

export interface IntroTimeline {
  total: number;
  /** page upright → flat */
  fold: Window;
  /** island slabs extrude out of the page */
  extrude: Window;
  /** page background sinks and fades */
  pageFade: Window;
  /** bridges rise from below */
  bridges: Window;
  /** rails, items and goal scale / fade in */
  appear: Window;
  /** camera fly-over start → goal */
  fly: Window;
  /** camera settles behind the start */
  settle: Window;
  /** the ball drops in its cage */
  ballDrop: Window;
  /** the page texture switches to nearest filtering (E: 10 s into the intro), when the pixel look is on */
  pixelAt: number;
}

export function introTimeline(mode: IntroMode): IntroTimeline {
  if (mode === 'fast') {
    return {
      fold: { start: 0.3, end: 2.0 },
      extrude: { start: 1.8, end: 3.3 },
      pageFade: { start: 2.0, end: 3.4 },
      bridges: { start: 2.6, end: 4.1 },
      appear: { start: 2.8, end: 4.3 },
      fly: { start: 3.9, end: 5.2 },
      settle: { start: 5.2, end: 5.9 },
      ballDrop: { start: 5.9, end: 7.9 },
      pixelAt: 5.0,
      total: 7.9,
    };
  }
  return {
    fold: { start: 1.0, end: 5.0 },
    extrude: { start: 4.6, end: 7.6 },
    pageFade: { start: 5.0, end: 8.0 },
    bridges: { start: 6.2, end: 9.2 },
    appear: { start: 6.6, end: 9.6 },
    fly: { start: 9.4, end: 12.4 },
    settle: { start: 12.4, end: 13.2 },
    ballDrop: { start: 13.2, end: 16.2 },
    pixelAt: 10,
    total: 16.2,
  };
}

/** 0..1 progress through a window. */
export function progress(t: number, w: Window): number {
  if (w.end <= w.start) return t >= w.end ? 1 : 0;
  return Math.min(1, Math.max(0, (t - w.start) / (w.end - w.start)));
}

export const ease = {
  cubicInOut: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  cubicOut: (x: number) => 1 - (1 - x) ** 3,
  quintIn: (x: number) => x ** 5,
  backOut: (x: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
  },
  sineInOut: (x: number) => -(Math.cos(Math.PI * x) - 1) / 2,
};

export interface CamKey {
  t: number;
  pos: Vector3;
  target: Vector3;
}

/**
 * C¹ interpolation through time-stamped keys (Catmull–Rom tangents with non-uniform knots, zero velocity
 * at both ends).
 */
export function sampleKeys(keys: readonly CamKey[], t: number, outPos: Vector3, outTarget: Vector3): void {
  const n = keys.length;
  if (n === 0) return;
  const first = keys[0] as CamKey;
  const last = keys[n - 1] as CamKey;
  if (t <= first.t || n === 1) {
    outPos.copy(first.pos);
    outTarget.copy(first.target);
    return;
  }
  if (t >= last.t) {
    outPos.copy(last.pos);
    outTarget.copy(last.target);
    return;
  }
  let i = 0;
  while (i < n - 2 && t >= (keys[i + 1] as CamKey).t) i++;
  const k0 = keys[i - 1];
  const k1 = keys[i] as CamKey;
  const k2 = keys[i + 1] as CamKey;
  const k3 = keys[i + 2];
  const dt = k2.t - k1.t;
  const u = (t - k1.t) / dt;
  hermite(k0?.pos, k1.pos, k2.pos, k3?.pos, k0?.t, k1.t, k2.t, k3?.t, u, dt, outPos);
  hermite(k0?.target, k1.target, k2.target, k3?.target, k0?.t, k1.t, k2.t, k3?.t, u, dt, outTarget);
}

function hermite(
  p0: Vector3 | undefined,
  p1: Vector3,
  p2: Vector3,
  p3: Vector3 | undefined,
  t0: number | undefined,
  t1: number,
  t2: number,
  t3: number | undefined,
  u: number,
  dt: number,
  out: Vector3,
): void {
  const m1 = new Vector3();
  const m2 = new Vector3();
  if (p0 && t0 !== undefined) m1.subVectors(p2, p0).divideScalar(t2 - t0).multiplyScalar(dt);
  if (p3 && t3 !== undefined) m2.subVectors(p3, p1).divideScalar(t3 - t1).multiplyScalar(dt);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  out
    .copy(p1)
    .multiplyScalar(h00)
    .addScaledVector(m1, h10)
    .addScaledVector(p2, h01)
    .addScaledVector(m2, h11);
}

export interface IntroGeometry {
  /** Stage extent (m). */
  width: number;
  depth: number;
  /** Y of the flat page (m). */
  pageY: number;
  /** Mean island top (m). */
  meanY: number;
  start: Vector3;
  goal: Vector3;
  /** Chase pose behind the start facing the goal. */
  chasePos: Vector3;
  chaseTarget: Vector3;
  fovDeg: number;
  aspect: number;
}

/** Distance that fits a w × h rectangle facing the camera. */
export function fitDistance(w: number, h: number, fovDeg: number, aspect: number): number {
  const t = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  return Math.max(h / 2 / t, w / 2 / (t * aspect));
}

/**
 * The page hinges on its bottom edge (z = depth). Upright, it faces +Z; the camera starts head-on so the
 * site is instantly recognisable, then follows the fold down to an oblique overview.
 */
export function pageFoldAngle(t: number, tl: IntroTimeline): number {
  // π/2 = upright, 0 = flat
  return (Math.PI / 2) * (1 - ease.cubicInOut(progress(t, tl.fold)));
}

export function introCameraKeys(g: IntroGeometry, tl: IntroTimeline): CamKey[] {
  const keys: CamKey[] = [];
  const W = g.width;
  const D = g.depth;
  const fit = fitDistance(W, D, g.fovDeg, g.aspect) * 1.04;
  const center = (phi: number) => new Vector3(W / 2, g.pageY + (D / 2) * Math.sin(phi), D - (D / 2) * Math.cos(phi));
  // head-on, then follow the fold: camera elevation 0° → 52°, distance grows a little
  const foldSamples = 5;
  keys.push({ t: 0, pos: new Vector3(W / 2, g.pageY + D / 2, D + fit), target: center(Math.PI / 2) });
  for (let i = 0; i <= foldSamples; i++) {
    const s = i / foldSamples;
    const t = tl.fold.start + (tl.fold.end - tl.fold.start) * s;
    const phi = pageFoldAngle(t, tl);
    const c = center(phi);
    const elev = ((52 * Math.PI) / 180) * ease.sineInOut(s);
    const dist = fit * (1 + 0.12 * s);
    // aim at the page centre, looking along −Z (from the south)
    const pos = new Vector3(W / 2, c.y + Math.sin(elev) * dist, c.z + Math.cos(elev) * dist);
    keys.push({ t, pos, target: c });
  }
  const flatC = new Vector3(W / 2, g.meanY, D / 2);
  // extrusion: swing round to the south-east and lower, to see the slabs rise in profile
  const swing = (az: number, elev: number, dist: number) =>
    new Vector3(
      flatC.x + Math.sin(az) * Math.cos(elev) * dist,
      flatC.y + Math.sin(elev) * dist,
      flatC.z + Math.cos(az) * Math.cos(elev) * dist,
    );
  keys.push({ t: tl.extrude.end, pos: swing(0.35, 0.62, fit * 0.95), target: flatC.clone() });
  keys.push({ t: tl.appear.end - 0.2, pos: swing(0.6, 0.55, fit * 0.8), target: flatC.clone() });
  // fly-over along start → goal (E: "swing to face start→goal, then settle behind the start"): the camera
  // looks down the whole route towards the goal beacon while descending onto the start.
  const dir = new Vector3().subVectors(g.goal, g.start).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  const span = g.start.distanceTo(g.goal);
  const h = Math.max(8, Math.min(26, span * 0.22));
  const mid = new Vector3().addVectors(g.start, g.goal).multiplyScalar(0.5);
  keys.push({
    t: tl.fly.start,
    pos: g.start.clone().addScaledVector(dir, -h * 1.1).add(new Vector3(0, h * 1.25, 0)),
    target: mid,
  });
  keys.push({
    t: tl.fly.end,
    pos: g.start.clone().addScaledVector(dir, -h * 0.45).add(new Vector3(0, h * 0.42, 0)),
    target: g.start.clone().addScaledVector(dir, h * 0.9),
  });
  // settle behind the start
  keys.push({ t: tl.settle.end, pos: g.chasePos.clone(), target: g.chaseTarget.clone() });
  keys.push({ t: tl.total, pos: g.chasePos.clone(), target: g.chaseTarget.clone() });
  return keys;
}
