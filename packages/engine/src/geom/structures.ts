/**
 * StageData → merged mesh buffers (pure, deterministic, no GPU). One buffer per material type, so the
 * whole static stage costs a handful of draw calls (2013: ~2000 → ~50 by merging by type).
 *
 * World mapping (contracts §1): x = px / PX_PER_METER, z = py / PX_PER_METER, y = level · LEVEL_HEIGHT_M.
 */
import {
  ELEVATOR_MIN_PLATFORM_PX,
  type Island,
  LEVEL_HEIGHT_M,
  mulberry32,
  PX_PER_METER,
  pointInPolygon,
  RAIL_HEIGHT_M,
  SLAB_THICKNESS_M,
  type StageData,
  signedArea,
  type Vec2,
} from '@wwm/schema';
import { ShapeUtils, Vector2 } from 'three/webgpu';
import { BRIDGE_APRON_OVERLAP_M, HSV, RAIL_THICKNESS_M } from '../palette.ts';
import { MeshBuilder, type MeshData, type V2, type V3 } from './mesh.ts';
import { clipTriangleToBand, fan, type TilePlan, tileUv } from './tiling.ts';

export const GROUP_ISLAND = 0;
export const GROUP_BRIDGE = 1;

/** Longest side/deck/rail segment before subdividing (m). Gives the faceted look room to shimmer. */
const SEGMENT_M = 1.6;
/** Rail bar cross-section and post spacing (m). */
const RAIL_BAR = 0.08; // physics railThickness is 0.1; the visual bar sits on its outer part
const RAIL_POST = 0.055;
const POST_SPACING_M = 1.9;
/** Flat bridge aprons reach this far past the island edge (px), as in @wwm/physics. */
const APRON_PX = BRIDGE_APRON_OVERLAP_M * PX_PER_METER;

const toX = (px: number) => px / PX_PER_METER;
const toY = (level: number) => level * LEVEL_HEIGHT_M;

export interface StageMeshes {
  /** Island tops + bottoms, one buffer per texture tile. */
  tops: MeshData[];
  /** Island sides (blue, white edge lines). */
  sides: MeshData;
  /** Bridge and ramp decks (green) + elevator shafts. */
  bridges: MeshData;
  /** Guardrails on islands and bridges (yellow) + elevator pillars (red). */
  rails: MeshData;
}

/** Intro stagger per island: 0 at the start island, rising with distance (0..1). */
export function islandDelays(stage: StageData): Map<number, number> {
  const [sx, sy] = stage.start.pos;
  const diag = Math.hypot(stage.size.width, stage.size.height) || 1;
  const out = new Map<number, number>();
  for (const isl of stage.islands) {
    const c = ringCentroid(isl.contour);
    out.set(isl.id, Math.min(1, Math.hypot(c[0] - sx, c[1] - sy) / diag));
  }
  return out;
}

export function ringCentroid(ring: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / (ring.length || 1), y / (ring.length || 1)];
}

/** Triangulate an island outline with holes (earcut via ShapeUtils). Returns triangles in px. */
export function triangulateIsland(
  contour: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
): [Vec2, Vec2, Vec2][] {
  const c = dedupeRing(contour).map((p) => new Vector2(p[0], p[1]));
  const hs = holes.map((h) => dedupeRing(h).map((p) => new Vector2(p[0], p[1])));
  const all = [...c, ...hs.flat()];
  const faces = ShapeUtils.triangulateShape(c, hs);
  return faces.map(([i, j, k]) => {
    const a = all[i as number] as Vector2;
    const b = all[j as number] as Vector2;
    const d = all[k as number] as Vector2;
    return [
      [a.x, a.y],
      [b.x, b.y],
      [d.x, d.y],
    ];
  });
}

function dedupeRing(ring: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push([p[0], p[1]]);
  }
  const f = out[0];
  const l = out[out.length - 1];
  if (out.length > 1 && f && l && f[0] === l[0] && f[1] === l[1]) out.pop();
  return out;
}

export function buildStageMeshes(stage: StageData, plan: TilePlan): StageMeshes {
  const delays = islandDelays(stage);
  const levelOf = new Map(stage.islands.map((i) => [i.id, i.level]));
  const rng = mulberry32(stage.seed ^ 0x5eed);

  // ── Island tops (+ bottoms), clipped per texture tile ──
  const topBuilders = plan.tiles.map(() => new MeshBuilder());
  const sides = new MeshBuilder();
  sides.face.hsv = HSV.blue;
  for (const isl of stage.islands) {
    const y = toY(isl.level);
    const yb = y - SLAB_THICKNESS_M;
    const delay = delays.get(isl.id) ?? 0;
    const tris = triangulateIsland(isl.contour, isl.holes);
    for (const [ti, tile] of plan.tiles.entries()) {
      const mb = topBuilders[ti] as MeshBuilder;
      mb.face.delay = delay;
      mb.face.group = GROUP_ISLAND;
      mb.face.base = y;
      for (const t of tris) {
        const poly = clipTriangleToBand(t, tile.stageY0, tile.stageY1);
        for (const f of fan(poly)) {
          const uv = f.map((p) => tileUv(p, tile, plan)) as [Vec2, Vec2, Vec2];
          const top = f.map((p) => [toX(p[0]), y, toX(p[1])] as V3) as [V3, V3, V3];
          const bot = f.map((p) => [toX(p[0]), yb, toX(p[1])] as V3) as [V3, V3, V3];
          mb.tri(top[0], top[1], top[2], uv[0], uv[1], uv[2], [0, 1, 0]);
          mb.tri(bot[0], bot[1], bot[2], uv[0], uv[1], uv[2], [0, -1, 0]);
        }
      }
    }
    // Sides: every ring edge, subdivided, outward facing.
    sides.face.delay = delay;
    sides.face.group = GROUP_ISLAND;
    sides.face.base = y;
    for (const [ri, ring] of [isl.contour, ...isl.holes].entries()) {
      const r = dedupeRing(ring);
      const area = signedArea(r);
      // Solid lies to the left of each edge (raw coords) iff area > 0 for the contour; for holes the
      // hole interior is on the side opposite to the solid.
      const solidLeft = ri === 0 ? area > 0 : area < 0;
      let along = 0;
      for (let i = 0; i < r.length; i++) {
        const a = r[i] as Vec2;
        const b = r[(i + 1) % r.length] as Vec2;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) continue;
        // outward = right-hand normal if the solid is on the left
        const out: V3 = solidLeft ? [dy / len, 0, -dx / len] : [-dy / len, 0, dx / len];
        const segs = Math.max(1, Math.ceil(toX(len) / SEGMENT_M));
        for (let s = 0; s < segs; s++) {
          const p0: Vec2 = [a[0] + (dx * s) / segs, a[1] + (dy * s) / segs];
          const p1: Vec2 = [a[0] + (dx * (s + 1)) / segs, a[1] + (dy * (s + 1)) / segs];
          const u0 = along + toX(len * (s / segs));
          const u1 = along + toX(len * ((s + 1) / segs));
          sides.face.seed = rng();
          sides.quad(
            [toX(p0[0]), y, toX(p0[1])],
            [toX(p1[0]), y, toX(p1[1])],
            [toX(p1[0]), yb, toX(p1[1])],
            [toX(p0[0]), yb, toX(p0[1])],
            [u0, 0],
            [u1, 0],
            [u1, 1],
            [u0, 1],
            out,
          );
        }
        along += toX(len);
      }
    }
  }

  // ── Bridges / ramps (mirrors @wwm/physics `bridgeSpecs`) ──
  // Main deck a→b (sloped for ramps), flat aprons from each endpoint into its island (gap + 0.3 m),
  // and side rails just outside the deck width along the main deck.
  const islandById = new Map(stage.islands.map((i) => [i.id, i]));
  const bridges = new MeshBuilder();
  const rails = new MeshBuilder();
  bridges.face.group = GROUP_BRIDGE;
  bridges.face.hsv = HSV.green;
  for (const br of stage.bridges) {
    const delay = ((delays.get(br.from) ?? 0) + (delays.get(br.to) ?? 0)) / 2;
    bridges.face.delay = delay;
    const len = Math.hypot(br.b[0] - br.a[0], br.b[1] - br.a[1]);
    if (len < 1e-6) continue;
    const d: Vec2 = [(br.b[0] - br.a[0]) / len, (br.b[1] - br.a[1]) / len];
    const ya = toY(br.levelA);
    const yb = toY(br.levelB);
    const apronA = gapIntoIsland(br.a, [-d[0], -d[1]], islandById.get(br.from)) + APRON_PX;
    const apronB = gapIntoIsland(br.b, d, islandById.get(br.to)) + APRON_PX;
    const a0: Vec2 = [br.a[0] - d[0] * apronA, br.a[1] - d[1] * apronA];
    const b1: Vec2 = [br.b[0] + d[0] * apronB, br.b[1] + d[1] * apronB];
    deck(bridges, rng, a0, br.a, br.width, () => ya, SLAB_THICKNESS_M, true, false);
    deck(bridges, rng, br.a, br.b, br.width, (t) => ya + (yb - ya) * t, SLAB_THICKNESS_M, false, false);
    deck(bridges, rng, br.b, b1, br.width, () => yb, SLAB_THICKNESS_M, false, true);
    // Side rails on both edges (E: "a thin side rail each side"), outside the deck width.
    rails.face.group = GROUP_BRIDGE;
    rails.face.delay = delay;
    rails.face.hsv = HSV.yellow;
    const n: Vec2 = [-d[1], d[0]];
    const off = br.width / 2 + (RAIL_THICKNESS_M / 2) * PX_PER_METER;
    for (const side of [-1, 1]) {
      const pts: V3[] = [];
      const segs = Math.max(1, Math.ceil(toX(len) / SEGMENT_M));
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const px = br.a[0] + (br.b[0] - br.a[0]) * t + n[0] * off * side;
        const py = br.a[1] + (br.b[1] - br.a[1]) * t + n[1] * off * side;
        pts.push([toX(px), ya + (yb - ya) * t, toX(py)]);
      }
      rails.face.base = (ya + yb) / 2;
      railAlong(rails, pts, RAIL_HEIGHT_M);
    }
  }

  // ── Elevator shafts (static): red corner pillars from below the lower to above the upper level ──
  for (const el of stage.elevators) {
    rails.face.group = GROUP_BRIDGE;
    rails.face.delay = ((delays.get(el.islandFrom) ?? 0) + (delays.get(el.islandTo) ?? 0)) / 2;
    rails.face.hsv = HSV.red;
    const fp = elevatorFootprint(el.a, el.b, el.width, RAIL_THICKNESS_M * PX_PER_METER + 1.5);
    const y0 = toY(el.levelLow) - SLAB_THICKNESS_M - 0.4;
    const y1 = toY(el.levelHigh) + RAIL_HEIGHT_M + 0.35;
    rails.face.base = y0;
    for (const c of fp) box(rails, [toX(c[0]), y0, toX(c[1])], [toX(c[0]), y1, toX(c[1])], 0.08);
  }

  // ── Island guardrails (mirrors @wwm/physics `guardrailSpecs`: just OUTSIDE the edge line) ──
  rails.face.group = GROUP_ISLAND;
  rails.face.hsv = HSV.yellow;
  for (const isl of stage.islands) {
    const y = toY(levelOf.get(isl.id) ?? isl.level);
    rails.face.delay = delays.get(isl.id) ?? 0;
    rails.face.base = y;
    for (const line of isl.guardrails) {
      if (line.length < 2) continue;
      railAlong(
        rails,
        offsetOutward(line, isl, (RAIL_THICKNESS_M / 2) * PX_PER_METER).map(
          (p) => [toX(p[0]), y, toX(p[1])] as V3,
        ),
        RAIL_HEIGHT_M,
      );
    }
  }

  return {
    tops: topBuilders.map((b) => b.build()),
    sides: sides.build(),
    bridges: bridges.build(),
    rails: rails.build(),
  };
}

/**
 * Elevator platform footprint (px), mirroring @wwm/physics `elevatorFootprint` (contracts v0.2.2): length
 * max(|b − a|, ELEVATOR_MIN_PLATFORM_PX) along a→b, *ending at b*, full `width` across. Both platforms
 * share it. `grow` widens it on every side (pillars sit just outside). Perimeter order.
 */
export function elevatorFootprint(a: Vec2, b: Vec2, width: number, grow = 0): Vec2[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const d: Vec2 = len > 1e-6 ? [dx / len, dy / len] : [1, 0];
  const n: Vec2 = [-d[1], d[0]];
  const L = Math.max(len, ELEVATOR_MIN_PLATFORM_PX);
  const W = width / 2 + grow;
  const s0 = -L - grow;
  const s1 = grow;
  const P = (s: number, w: number): Vec2 => [b[0] + d[0] * s + n[0] * w, b[1] + d[1] * s + n[1] * w];
  return [P(s0, W), P(s1, W), P(s1, -W), P(s0, -W)];
}

/** @wwm/physics `gapIntoIsland`: px from `p` along `dir` until inside the island (0 if never, cap 24). */
export function gapIntoIsland(p: Vec2, dir: Vec2, island: Island | undefined, capPx = 24): number {
  if (!island) return 0;
  for (let s = 0; s <= capPx; s += 1) {
    if (pointInPolygon([p[0] + dir[0] * s, p[1] + dir[1] * s], island.contour, island.holes)) return s;
  }
  return 0;
}

/**
 * Offset a guardrail polyline to the outside of its island by `px` (per segment, like the physics rail
 * boxes whose inner face lies on the edge line). Consecutive segment offsets are joined at their average.
 */
export function offsetOutward(line: readonly Vec2[], island: Island, px: number): Vec2[] {
  const segN: Vec2[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Vec2;
    const b = line[i + 1] as Vec2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const leftInside = pointInPolygon([mx - uz * 0.5, my + ux * 0.5], island.contour, island.holes);
    segN.push(leftInside ? [uz, -ux] : [-uz, ux]);
  }
  return line.map((p, i) => {
    const n0 = segN[Math.max(0, i - 1)] as Vec2;
    const n1 = segN[Math.min(segN.length - 1, i)] as Vec2;
    let nx = n0[0] + n1[0];
    let ny = n0[1] + n1[1];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    // keep the perpendicular distance at `px` on both segments at a corner
    const cos = Math.max(0.35, nx * n1[0] + ny * n1[1]);
    return [p[0] + (nx * px) / cos, p[1] + (ny * px) / cos];
  });
}

/** A deck slab along a→b (px) with per-point top height (m), subdivided along its length. */
function deck(
  mb: MeshBuilder,
  rng: () => number,
  a: Vec2,
  b: Vec2,
  widthPx: number,
  heightAt: (t: number) => number,
  thickness: number,
  capStart = true,
  capEnd = true,
): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: Vec2 = [-d[1], d[0]];
  const w = widthPx / 2;
  const segs = Math.max(1, Math.ceil(toX(len) / SEGMENT_M));
  const P = (t: number, s: number): Vec2 => [
    a[0] + (b[0] - a[0]) * t + n[0] * w * s,
    a[1] + (b[1] - a[1]) * t + n[1] * w * s,
  ];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const h0 = heightAt(t0);
    const h1 = heightAt(t1);
    const L0 = P(t0, 1);
    const L1 = P(t1, 1);
    const R0 = P(t0, -1);
    const R1 = P(t1, -1);
    const v0 = toX(len * t0);
    const v1 = toX(len * t1);
    mb.face.seed = rng();
    mb.face.base = (h0 + h1) / 2;
    const up = (p: Vec2, h: number): V3 => [toX(p[0]), h, toX(p[1])];
    const dn = (p: Vec2, h: number): V3 => [toX(p[0]), h - thickness, toX(p[1])];
    // top: uv.x across (0 = left edge, 1 = right edge), uv.y along (m)
    mb.quad(up(L0, h0), up(L1, h1), up(R1, h1), up(R0, h0), [0, v0], [0, v1], [1, v1], [1, v0], [0, 1, 0]);
    mb.quad(dn(L0, h0), dn(L1, h1), dn(R1, h1), dn(R0, h0), [0, v0], [0, v1], [1, v1], [1, v0], [0, -1, 0]);
    const nl: V3 = [n[0], 0, n[1]];
    const nr: V3 = [-n[0], 0, -n[1]];
    // sides: uv.x = 2 marks "side" for the shader
    mb.quad(up(L0, h0), up(L1, h1), dn(L1, h1), dn(L0, h0), [2, v0], [2, v1], [2, v1], [2, v0], nl);
    mb.quad(up(R0, h0), up(R1, h1), dn(R1, h1), dn(R0, h0), [2, v0], [2, v1], [2, v1], [2, v0], nr);
    if (capStart && i === 0)
      mb.quad(
        up(L0, h0),
        up(R0, h0),
        dn(R0, h0),
        dn(L0, h0),
        [2, 0],
        [2, 0],
        [2, 0],
        [2, 0],
        [-d[0], 0, -d[1]],
      );
    if (capEnd && i === segs - 1)
      mb.quad(
        up(L1, h1),
        up(R1, h1),
        dn(R1, h1),
        dn(L1, h1),
        [2, 0],
        [2, 0],
        [2, 0],
        [2, 0],
        [d[0], 0, d[1]],
      );
  }
}

/** A rail: a thin bar `height` above the surface polyline, with posts down to the surface. */
export function railAlong(mb: MeshBuilder, pts: readonly V3[], height: number): void {
  let sinceLast = POST_SPACING_M; // post at the first point
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i] as V3;
    const q = pts[i + 1] as V3;
    const segLen = Math.hypot(q[0] - p[0], q[2] - p[2]);
    if (segLen < 1e-6) continue;
    const base = mb.face.base;
    const hb = height - RAIL_BAR / 2; // bar top = rail height
    box(mb, [p[0], p[1] + hb, p[2]], [q[0], q[1] + hb, q[2]], RAIL_BAR, true);
    // posts
    let t = POST_SPACING_M - sinceLast;
    while (t <= segLen) {
      const f = t / segLen;
      const x = p[0] + (q[0] - p[0]) * f;
      const y = p[1] + (q[1] - p[1]) * f;
      const z = p[2] + (q[2] - p[2]) * f;
      mb.face.base = y;
      box(mb, [x, y, z], [x, y + height, z], RAIL_POST);
      t += POST_SPACING_M;
    }
    mb.face.base = base;
    sinceLast = segLen - (t - POST_SPACING_M);
  }
  // closing post
  const last = pts[pts.length - 1] as V3;
  box(mb, last, [last[0], last[1] + height, last[2]], RAIL_POST);
}

/**
 * A square-section box from point p to q (m). Horizontal-ish bars get a horizontal side vector;
 * vertical posts use the world X/Z axes.
 */
export function box(mb: MeshBuilder, p: V3, q: V3, size: number, extendEnds = false): void {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const dz = q[2] - p[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return;
  const h = size / 2;
  const horizLen = Math.hypot(dx, dz);
  let ring: V2[];
  if (horizLen < 1e-6) {
    // vertical post
    ring = [
      [p[0] - h, p[2] - h],
      [p[0] + h, p[2] - h],
      [p[0] + h, p[2] + h],
      [p[0] - h, p[2] + h],
    ];
    mb.face.seed = (mb.face.seed * 7.13 + 0.37) % 1;
    mb.prism(ring, [p[1], p[1], p[1], p[1]], [q[1], q[1], q[1], q[1]]);
    return;
  }
  const ux = dx / horizLen;
  const uz = dz / horizLen;
  const e = extendEnds ? h : 0;
  const sx = -uz * h;
  const sz = ux * h;
  const p0: V2 = [p[0] - ux * e, p[2] - uz * e];
  const q0: V2 = [q[0] + ux * e, q[2] + uz * e];
  ring = [
    [p0[0] + sx, p0[1] + sz],
    [q0[0] + sx, q0[1] + sz],
    [q0[0] - sx, q0[1] - sz],
    [p0[0] - sx, p0[1] - sz],
  ];
  mb.face.seed = (mb.face.seed * 7.13 + 0.37) % 1;
  mb.prism(ring, [p[1] - h, q[1] - h, q[1] - h, p[1] - h], [p[1] + h, q[1] + h, q[1] + h, p[1] + h]);
}
