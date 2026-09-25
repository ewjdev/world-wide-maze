/**
 * StageData → collider specs, in world metres. Pure (no Rapier), so it's unit-testable and the sandbox can
 * draw it. Every page → world conversion goes through `pageToWorld` / `pxToMeters` from `@wwm/schema/space`.
 *
 * Islands: closed prism trimesh (top from earcut, bottom, side walls), slab `slabThickness` thick (E).
 * Bridges: an oriented box deck (sloped for ramps) + flat aprons that reach into each island + side rails.
 * Guardrails: thin boxes 0 → railHeight above the island top along each polyline segment (R).
 * Elevators: two bridge-like platforms over the footprint (see elevatorFootprint).
 */
import {
  type Bridge,
  type Elevator,
  type Island,
  pointInPolygon,
  type StageData,
  signedArea,
  type Vec2,
} from '@wwm/schema';
import { pageToWorld, pxToMeters, type Vec3 } from '@wwm/schema/space';
import earcut from 'earcut';
import type { PhysicsParams } from './params.ts';

export type Quat = [number, number, number, number]; // x, y, z, w

export type ColliderRole =
  | { type: 'island'; islandId: number }
  | { type: 'bridge'; bridgeId: number }
  | { type: 'rail'; islandId: number }
  | { type: 'bridge-rail'; bridgeId: number };

export interface TrimeshSpec {
  shape: 'trimesh';
  vertices: Float32Array;
  indices: Uint32Array;
  role: ColliderRole;
}
export interface BoxSpec {
  shape: 'box';
  center: Vec3;
  half: Vec3;
  rot: Quat;
  role: ColliderRole;
}
export type StaticSpec = TrimeshSpec | BoxSpec;

export interface ElevatorFootprint {
  /** Platform centre in the horizontal plane (world x, z). */
  cx: number;
  cz: number;
  /** Horizontal unit axis from the lower side (a) towards the upper island (b). */
  ux: number;
  uz: number;
  halfLen: number;
  halfWidth: number;
  rot: Quat;
}

// ── small vector helpers (deterministic: only + − × / sqrt) ──
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function add(...vs: Vec3[]): Vec3 {
  const r: Vec3 = [0, 0, 0];
  for (const v of vs) {
    r[0] += v[0];
    r[1] += v[1];
    r[2] += v[2];
  }
  return r;
}
function normalize(a: Vec3): Vec3 {
  const l = Math.sqrt(dot(a, a));
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
}

/** Quaternion of the rotation whose columns are the orthonormal basis (x, y, z). */
export function basisToQuat(x: Vec3, y: Vec3, z: Vec3): Quat {
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** Rotation about +Y that maps local +X onto the horizontal unit direction (ux, 0, uz). */
function yawQuat(ux: number, uz: number): Quat {
  const x: Vec3 = [ux, 0, uz];
  const y: Vec3 = [0, 1, 0];
  return basisToQuat(x, y, cross(x, y));
}

/** Remove the closing duplicate and consecutive duplicates. */
function cleanRing(ring: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  while (out.length > 1) {
    const f = out[0] as Vec2;
    const l = out[out.length - 1] as Vec2;
    if (f[0] === l[0] && f[1] === l[1]) out.pop();
    else break;
  }
  return out;
}

/** Closed prism trimesh of an island: top (normal +Y), bottom, side walls — all faces outward. */
export function islandTrimesh(
  island: Island,
  slab: number,
): { vertices: Float32Array; indices: Uint32Array } {
  const outer = cleanRing(island.contour);
  if (signedArea(outer) < 0) outer.reverse(); // contract: outer positive (x right, y down)
  const holes = island.holes.map((h) => {
    const r = cleanRing(h);
    if (signedArea(r) > 0) r.reverse(); // holes opposite
    return r;
  });
  const rings = [outer, ...holes].filter((r) => r.length >= 3);
  const flat: number[] = [];
  const holeIdx: number[] = [];
  for (let k = 0; k < rings.length; k++) {
    if (k > 0) holeIdx.push(flat.length / 2);
    for (const p of rings[k] as Vec2[]) flat.push(pxToMeters(p[0]), pxToMeters(p[1]));
  }
  const n = flat.length / 2;
  const top = pageToWorld([0, 0], island.level)[1];
  const bot = top - slab;
  const vertices = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const x = flat[2 * i] as number;
    const z = flat[2 * i + 1] as number;
    vertices.set([x, top, z], i * 3);
    vertices.set([x, bot, z], (n + i) * 3);
  }
  const idx: number[] = [];
  const v = (i: number): Vec3 => [
    vertices[i * 3] as number,
    vertices[i * 3 + 1] as number,
    vertices[i * 3 + 2] as number,
  ];
  const pushTri = (a: number, b: number, c: number, want: Vec3) => {
    const nrm = cross(sub(v(b), v(a)), sub(v(c), v(a)));
    if (dot(nrm, want) >= 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  };
  const tris = earcut(flat, holeIdx.length ? holeIdx : null, 2);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] as number;
    const b = tris[t + 1] as number;
    const c = tris[t + 2] as number;
    pushTri(a, b, c, [0, 1, 0]);
    pushTri(n + a, n + b, n + c, [0, -1, 0]);
  }
  let base = 0;
  for (const ring of rings) {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const i0 = base + i;
      const i1 = base + ((i + 1) % m);
      const dx = (flat[2 * i1] as number) - (flat[2 * i0] as number);
      const dz = (flat[2 * i1 + 1] as number) - (flat[2 * i0 + 1] as number);
      const out: Vec3 = [dz, 0, -dx]; // outward for positive rings, into the hole for negative rings
      pushTri(i0, i1, n + i1, out);
      pushTri(i0, n + i1, n + i0, out);
    }
    base += m;
  }
  return { vertices, indices: Uint32Array.from(idx) };
}

/** Distance (px) to step from `p` along `dir` until inside `island` (0 if already inside), capped. */
function gapIntoIsland(p: Vec2, dir: Vec2, island: Island | undefined, capPx: number): number {
  if (!island) return 0;
  for (let s = 0; s <= capPx; s += 1) {
    if (pointInPolygon([p[0] + dir[0] * s, p[1] + dir[1] * s], island.contour, island.holes)) return s;
  }
  return 0;
}

function horizontalAxis(a: Vec2, b: Vec2): { ux: number; uz: number; lenPx: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenPx = Math.sqrt(dx * dx + dy * dy);
  return lenPx > 0 ? { ux: dx / lenPx, uz: dy / lenPx, lenPx } : { ux: 1, uz: 0, lenPx: 0 };
}

/** A horizontal deck box with its top at `topY`, spanning [s0, s1] metres along (ux, uz) from origin (x, z). */
function flatDeck(
  x: number,
  z: number,
  ux: number,
  uz: number,
  s0: number,
  s1: number,
  halfWidth: number,
  topY: number,
  slab: number,
  role: ColliderRole,
): BoxSpec {
  const mid = (s0 + s1) / 2;
  return {
    shape: 'box',
    center: [x + ux * mid, topY - slab / 2, z + uz * mid],
    half: [(s1 - s0) / 2, slab / 2, halfWidth],
    rot: yawQuat(ux, uz),
    role,
  };
}

export function bridgeSpecs(
  bridge: Bridge,
  islands: ReadonlyMap<number, Island>,
  p: PhysicsParams,
): BoxSpec[] {
  const { ux, uz } = horizontalAxis(bridge.a, bridge.b);
  const A = pageToWorld(bridge.a, bridge.levelA);
  const B = pageToWorld(bridge.b, bridge.levelB);
  const halfW = pxToMeters(bridge.width) / 2;
  const slab = p.slabThickness;
  const role: ColliderRole = { type: 'bridge', bridgeId: bridge.id };
  const railRole: ColliderRole = { type: 'bridge-rail', bridgeId: bridge.id };
  const out: BoxSpec[] = [];

  // Main (possibly sloped) deck A → B.
  const d = sub(B, A);
  const L = Math.sqrt(dot(d, d));
  if (L > 0) {
    const xAxis = scale(d, 1 / L);
    const yAxis = normalize(sub([0, 1, 0], scale(xAxis, xAxis[1])));
    const zAxis = cross(xAxis, yAxis);
    const rot = basisToQuat(xAxis, yAxis, zAxis);
    const mid = scale(add(A, B), 0.5);
    out.push({
      shape: 'box',
      center: add(mid, scale(yAxis, -slab / 2)),
      half: [L / 2, slab / 2, halfW],
      rot,
      role,
    });
    const rh = p.railHeight;
    const rt = p.railThickness;
    for (const side of [-1, 1]) {
      out.push({
        shape: 'box',
        // outside the deck edge, so the whole deck width is walkable (2013: a ribbon at the edge)
        center: add(mid, scale(yAxis, rh / 2), scale(zAxis, side * (halfW + rt / 2))),
        half: [L / 2, rh / 2, rt / 2],
        rot,
        role: railRole,
      });
    }
  }

  // Flat aprons reaching into each island (covers endpoints up to ENDPOINT_TOLERANCE_PX off the edge).
  const gapA = pxToMeters(gapIntoIsland(bridge.a, [-ux, -uz], islands.get(bridge.from), 24));
  const gapB = pxToMeters(gapIntoIsland(bridge.b, [ux, uz], islands.get(bridge.to), 24));
  out.push(flatDeck(A[0], A[2], ux, uz, -(gapA + p.bridgeOverlap), 0, halfW, A[1], slab, role));
  out.push(flatDeck(B[0], B[2], ux, uz, 0, gapB + p.bridgeOverlap, halfW, B[1], slab, role));
  return out;
}

export function guardrailSpecs(island: Island, p: PhysicsParams): BoxSpec[] {
  const out: BoxSpec[] = [];
  const top = pageToWorld([0, 0], island.level)[1];
  const rh = p.railHeight;
  const rt = p.railThickness;
  for (const line of island.guardrails) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i] as Vec2;
      const b = line[i + 1] as Vec2;
      const { ux, uz, lenPx } = horizontalAxis(a, b);
      if (lenPx === 0) continue;
      const len = pxToMeters(lenPx);
      // The rail sits just OUTSIDE the edge line (inner face on the edge), like the 2013 zero-thickness
      // ribbon, so narrow 1–2 D strips keep their full walkable width.
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const leftInside = pointInPolygon([mx - uz * 0.5, my + ux * 0.5], island.contour, island.holes);
      const ox = leftInside ? uz : -uz; // outward normal (page/world x)
      const oz = leftInside ? -ux : ux; // (page y / world z)
      const A = pageToWorld(a, island.level);
      out.push({
        shape: 'box',
        center: [A[0] + (ux * len) / 2 + (ox * rt) / 2, top + rh / 2, A[2] + (uz * len) / 2 + (oz * rt) / 2],
        half: [len / 2, rh / 2, rt / 2],
        rot: yawQuat(ux, uz),
        role: { type: 'rail', islandId: island.id },
      });
    }
  }
  return out;
}

/**
 * Elevator platform footprint (E, bundle-notes §7): a platform `max(|b−a|, 15 px₂₀₁₃)` long × `width`,
 * ending at the upper island's edge `b` and reaching back towards the lower island (overlapping it when the
 * gap is shorter than the platform). Both platforms share this footprint and differ only in height.
 */
export function elevatorFootprint(e: Elevator, p: PhysicsParams): ElevatorFootprint {
  const { ux, uz, lenPx } = horizontalAxis(e.a, e.b);
  const len = pxToMeters(Math.max(lenPx, p.elevatorMinPlatformPx));
  const B = pageToWorld(e.b, 0);
  return {
    cx: B[0] - (ux * len) / 2,
    cz: B[2] - (uz * len) / 2,
    ux,
    uz,
    halfLen: len / 2,
    halfWidth: pxToMeters(e.width) / 2,
    rot: yawQuat(ux, uz),
  };
}

/** Is the world point (x, z) over the footprint (optionally shrunk by `inset` m)? */
export function inFootprint(f: ElevatorFootprint, x: number, z: number, inset = 0): boolean {
  const dx = x - f.cx;
  const dz = z - f.cz;
  const along = dx * f.ux + dz * f.uz;
  const across = -dx * f.uz + dz * f.ux;
  return Math.abs(along) <= f.halfLen - inset && Math.abs(across) <= f.halfWidth - inset;
}

/** All static colliders of a stage. */
export function staticSpecs(stage: StageData, p: PhysicsParams): StaticSpec[] {
  const islands = new Map(stage.islands.map((i) => [i.id, i] as const));
  const out: StaticSpec[] = [];
  for (const island of stage.islands) {
    const { vertices, indices } = islandTrimesh(island, p.slabThickness);
    out.push({ shape: 'trimesh', vertices, indices, role: { type: 'island', islandId: island.id } });
    out.push(...guardrailSpecs(island, p));
  }
  for (const b of stage.bridges) out.push(...bridgeSpecs(b, islands, p));
  return out;
}

export function countTriangles(specs: readonly StaticSpec[]): number {
  let n = 0;
  for (const s of specs) n += s.shape === 'trimesh' ? s.indices.length / 3 : 12;
  return n;
}
