/**
 * Navigation grid over a StageData (stage px, top-down):
 * - every cell carries a surface label: an island, a bridge deck (the part outside its islands) or nothing;
 * - `clear` is the distance (px) from the cell centre to the nearest wall: void, another island, a deck of an
 *   unrelated bridge, or an elevator footprint (walking across a footprint would trigger the lift);
 * - moves are 8-connected between compatible labels only (island ↔ its own bridges);
 * - elevators are portal edges between an approach cell on one side and an exit cell on the other.
 * A* over this grid is the planner; the pilot follows the simplified polyline.
 */
import {
  BALL_RADIUS_M,
  bridgeRect,
  type Elevator,
  LEVEL_HEIGHT_M,
  PX_PER_METER,
  ELEVATOR_MIN_PLATFORM_PX as SCHEMA_ELEVATOR_MIN_PLATFORM_PX,
  SLAB_THICKNESS_M,
  type StageData,
  type Vec2,
} from '@wwm/schema';

/** Platform length rule of @wwm/physics `elevatorFootprint` (contracts §9 v0.2.2): max(|b−a|, 18.75 px). */
export const ELEVATOR_MIN_PLATFORM_PX = SCHEMA_ELEVATOR_MIN_PLATFORM_PX;
/** The two platforms share one footprint: a rise below ball diameter + slab pins the ball between them
 *  (measured with @wwm/physics: rise 1.04 D traps it; see docs/build-log/phase-09-builder-issues.md). */
export const ELEVATOR_MIN_RISE_M = 2 * BALL_RADIUS_M + SLAB_THICKNESS_M;
export const BALL_RADIUS_PX = BALL_RADIUS_M * PX_PER_METER;

export interface NavOptions {
  /** Grid cell size (px). */
  cell?: number;
  /** Minimum centre-to-wall distance (px) for a cell to be walkable by the ball centre. */
  minClear?: number;
  /** Distance (px) inside an island at which elevator approach / exit points are placed. */
  elevatorLeadPx?: number;
  /** Accept elevator boarding/arrival ground anywhere beyond the platform end within reach, not just at it. */
  loosePortals?: boolean;
  /** Add jump links over short necks (default true), up to this gap (px). */
  jumps?: boolean;
  jumpMaxPx?: number;
}

export interface ElevatorPortal {
  elevator: Elevator;
  /** Unit vector a→b (px). */
  u: Vec2;
  /** Footprint length (px) and its two ends: `start` = b − u·len, `b`. */
  lenPx: number;
  start: Vec2;
  center: Vec2;
  /** Walk-in points: low side (before `start`) and high side (beyond `b`). */
  lowPt: Vec2;
  highPt: Vec2;
  /** Points on the platform axis just off each end: the ball enters and leaves a platform through its ends
   *  (its sides have rails). */
  lowAxis: Vec2;
  highAxis: Vec2;
  lowCell: number;
  highCell: number;
  /** Rise too small for the ball to fit between the two platforms: never usable. */
  trapped: boolean;
}

export interface JumpLink {
  a: Vec2;
  b: Vec2;
  aCell: number;
  bCell: number;
  /** Island label (index + 1). */
  label: number;
}

export interface NavGrid {
  stage: StageData;
  cell: number;
  w: number;
  h: number;
  /** >0: island index + 1; <0: −(bridge index + 1); 0: void. */
  label: Int32Array;
  /** Distance (px) from the cell centre to the nearest wall. */
  clear: Float32Array;
  /** Surface level (D) at the cell. */
  level: Float32Array;
  /** 1 when the cell is (or is near) an elevator footprint: never walked, only ridden. */
  lift: Uint8Array;
  minClear: number;
  portals: ElevatorPortal[];
  /** portal edges per cell: [portal index, direction (0 low→high, 1 high→low)] */
  portalAt: Map<number, [number, 0 | 1][]>;
  /** Jump links over necks narrower than the ball, and per cell: [jump index, direction (0 a→b, 1 b→a)]. */
  jumps: JumpLink[];
  jumpAt: Map<number, [number, 0 | 1][]>;
  /** island id → island index, bridge id → bridge index */
  islandIndex: Map<number, number>;
  bridgeIndex: Map<number, number>;
}

/** Scanline-fill rings (even-odd) into cells: calls `set(cellIndex)` for every cell whose centre is inside. */
function fillRings(
  rings: readonly (readonly Vec2[])[],
  cell: number,
  w: number,
  h: number,
  set: (i: number) => void,
) {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rings)
    for (const p of r) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  const y0 = Math.max(0, Math.floor(minY / cell - 0.5));
  const y1 = Math.min(h - 1, Math.ceil(maxY / cell));
  const xs: number[] = [];
  for (let gy = y0; gy <= y1; gy++) {
    const y = (gy + 0.5) * cell;
    xs.length = 0;
    for (const r of rings) {
      const n = r.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = r[i] as Vec2;
        const b = r[j] as Vec2;
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const gx0 = Math.max(0, Math.ceil((xs[k] as number) / cell - 0.5));
      const gx1 = Math.min(w - 1, Math.floor((xs[k + 1] as number) / cell - 0.5));
      for (let gx = gx0; gx <= gx1; gx++) set(gy * w + gx);
    }
  }
}

/** Two-pass chamfer (1, √2) distance transform from `wall` cells, in cells. */
function distanceTransform(wall: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = wall[i] ? 0 : INF;
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i] as number;
      if (v === 0) continue;
      // Outside the grid counts as wall (stage border).
      const up = y > 0 ? (d[i - w] as number) : 0;
      const left = x > 0 ? (d[i - 1] as number) : 0;
      const ul = y > 0 && x > 0 ? (d[i - w - 1] as number) : 0;
      const ur = y > 0 && x < w - 1 ? (d[i - w + 1] as number) : 0;
      v = Math.min(v, up + D1, left + D1, ul + D2, ur + D2);
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i] as number;
      if (v === 0) continue;
      const dn = y < h - 1 ? (d[i + w] as number) : 0;
      const right = x < w - 1 ? (d[i + 1] as number) : 0;
      const dr = y < h - 1 && x < w - 1 ? (d[i + w + 1] as number) : 0;
      const dl = y < h - 1 && x > 0 ? (d[i + w - 1] as number) : 0;
      v = Math.min(v, dn + D1, right + D1, dr + D2, dl + D2);
      d[i] = v;
    }
  return d;
}

export function buildNavGrid(stage: StageData, opts: NavOptions = {}): NavGrid {
  const cell = opts.cell ?? 3;
  const minClear = opts.minClear ?? BALL_RADIUS_PX;
  const lead = opts.elevatorLeadPx ?? 9;
  const w = Math.ceil(stage.size.width / cell);
  const h = Math.ceil(stage.size.height / cell);
  const n = w * h;
  const label = new Int32Array(n);
  const level = new Float32Array(n);
  const islandIndex = new Map(stage.islands.map((isl, i) => [isl.id, i] as const));
  const bridgeIndex = new Map(stage.bridges.map((b, i) => [b.id, i] as const));

  stage.islands.forEach((isl, k) => {
    fillRings([isl.contour, ...isl.holes], cell, w, h, (i) => {
      label[i] = k + 1;
      level[i] = isl.level;
    });
  });
  // Decks: only the part outside islands gets the bridge label; the level is interpolated along a→b.
  stage.bridges.forEach((b, k) => {
    const rect = bridgeRect(b.a, b.b, b.width);
    if (rect.length === 0) return;
    const dx = b.b[0] - b.a[0];
    const dy = b.b[1] - b.a[1];
    const l2 = dx * dx + dy * dy || 1;
    fillRings([rect], cell, w, h, (i) => {
      if (label[i] !== 0) return;
      label[i] = -(k + 1);
      const px = ((i % w) + 0.5) * cell;
      const py = (Math.floor(i / w) + 0.5) * cell;
      const t = Math.max(0, Math.min(1, ((px - b.a[0]) * dx + (py - b.a[1]) * dy) / l2));
      level[i] = b.levelA + (b.levelB - b.levelA) * t;
    });
  });

  // Walls: void, and label boundaries that the ball can't cross (different islands, unrelated decks).
  const compatible = (la: number, lb: number): boolean => {
    if (la === lb) return true;
    if (la === 0 || lb === 0) return false;
    if (la > 0 && lb > 0) return false;
    if (la < 0 && lb < 0) return false;
    const br = stage.bridges[-(la < 0 ? la : lb) - 1];
    const isl = stage.islands[(la > 0 ? la : lb) - 1];
    return !!br && !!isl && (br.from === isl.id || br.to === isl.id);
  };
  const wall = new Uint8Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = label[i] as number;
      if (l === 0) {
        wall[i] = 1;
        continue;
      }
      if (x + 1 < w && !compatible(l, label[i + 1] as number) && label[i + 1] !== 0) wall[i] = 1;
      if (y + 1 < h && !compatible(l, label[i + w] as number) && label[i + w] !== 0) wall[i] = 1;
      if (x > 0 && !compatible(l, label[i - 1] as number) && label[i - 1] !== 0) wall[i] = 1;
      if (y > 0 && !compatible(l, label[i - w] as number) && label[i - w] !== 0) wall[i] = 1;
    }

  // Elevator footprints (plus a margin) are walls for walking; portals cross them.
  const lift = new Uint8Array(n);
  const portals: ElevatorPortal[] = [];
  for (const e of stage.elevators) {
    const dx = e.b[0] - e.a[0];
    const dy = e.b[1] - e.a[1];
    const len0 = Math.hypot(dx, dy) || 1;
    const u: Vec2 = [dx / len0, dy / len0];
    const lenPx = Math.max(len0, ELEVATOR_MIN_PLATFORM_PX);
    const start: Vec2 = [e.b[0] - u[0] * lenPx, e.b[1] - u[1] * lenPx];
    const center: Vec2 = [(start[0] + e.b[0]) / 2, (start[1] + e.b[1]) / 2];
    // The sim triggers a ride when the ball *centre* is over the footprint: block the footprint + a margin.
    const infl = 2;
    const s0: Vec2 = [start[0] - u[0] * infl, start[1] - u[1] * infl];
    const b0: Vec2 = [e.b[0] + u[0] * infl, e.b[1] + u[1] * infl];
    fillRings([bridgeRect(s0, b0, e.width + 2 * infl)], cell, w, h, (i) => {
      lift[i] = 1;
      wall[i] = 1;
    });
    portals.push({
      elevator: e,
      u,
      lenPx,
      start,
      center,
      lowPt: [start[0] - u[0] * lead, start[1] - u[1] * lead],
      highPt: [e.b[0] + u[0] * lead, e.b[1] + u[1] * lead],
      lowAxis: [start[0] - u[0] * (BALL_RADIUS_PX + 3), start[1] - u[1] * (BALL_RADIUS_PX + 3)],
      highAxis: [e.b[0] + u[0] * (BALL_RADIUS_PX + 3), e.b[1] + u[1] * (BALL_RADIUS_PX + 3)],
      lowCell: -1,
      highCell: -1,
      trapped: (e.levelHigh - e.levelLow) * LEVEL_HEIGHT_M < ELEVATOR_MIN_RISE_M,
    });
  }

  const dt = distanceTransform(wall, w, h);
  const clear = new Float32Array(n);
  // A wall cell's centre is ~half a cell beyond the real edge: report the distance to the edge.
  for (let i = 0; i < n; i++) clear[i] = wall[i] ? 0 : Math.max(0, (dt[i] as number) * cell - cell / 2);

  // Bridge side rails run the full a→b length (@wwm/physics bridgeSpecs), just outside the deck edge. Where
  // an endpoint lies inside its island (the builder allows up to 20 px), that rail stands on the island.
  // Exact distances (not rasterized): tight squeezes past a rail end are physically passable.
  // Elevator platforms carry the same side rails over their whole footprint, at both levels (the low one
  // stands on the lower island when the gap is shorter than the platform).
  const RAIL_T = 0.1 * PX_PER_METER; // physics railThickness (0.1 m)
  const decks: { a: Vec2; b: Vec2; width: number }[] = [
    ...stage.bridges.map((b) => ({ a: b.a, b: b.b, width: b.width })),
    ...portals.map((p) => ({ a: p.start, b: p.elevator.b, width: p.elevator.width })),
  ];
  for (const b of decks) {
    const dx = b.b[0] - b.a[0];
    const dy = b.b[1] - b.a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const off = b.width / 2 + RAIL_T / 2;
    for (const side of [-1, 1]) {
      const p0: Vec2 = [b.a[0] + nx * off * side, b.a[1] + ny * off * side];
      const p1: Vec2 = [b.b[0] + nx * off * side, b.b[1] + ny * off * side];
      const reach = minClear + 2 * cell;
      const gx0 = Math.max(0, Math.floor((Math.min(p0[0], p1[0]) - reach) / cell));
      const gx1 = Math.min(w - 1, Math.floor((Math.max(p0[0], p1[0]) + reach) / cell));
      const gy0 = Math.max(0, Math.floor((Math.min(p0[1], p1[1]) - reach) / cell));
      const gy1 = Math.min(h - 1, Math.floor((Math.max(p0[1], p1[1]) + reach) / cell));
      for (let gy = gy0; gy <= gy1; gy++)
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = gy * w + gx;
          const cx = (gx + 0.5) * cell;
          const cy = (gy + 0.5) * cell;
          const t = Math.max(0, Math.min(1, ((cx - p0[0]) * dx + (cy - p0[1]) * dy) / (len * len)));
          const d = Math.hypot(p0[0] + dx * t - cx, p0[1] + dy * t - cy) - RAIL_T / 2;
          if (d < (clear[i] as number)) clear[i] = Math.max(0, d);
        }
    }
  }

  const grid: NavGrid = {
    stage,
    cell,
    w,
    h,
    label,
    clear,
    level,
    lift,
    minClear,
    portals,
    portalAt: new Map(),
    jumps: [],
    jumpAt: new Map(),
    islandIndex,
    bridgeIndex,
  };
  portals.forEach((p, k) => {
    const lowIsl = islandIndex.get(p.elevator.islandFrom);
    const highIsl = islandIndex.get(p.elevator.islandTo);
    // The ball leaves a platform through its end (rails on the sides): the portal cell must lie beyond the end.
    const beyond = (i: number, end: Vec2, dir: number) => {
      const c = cellCenter(grid, i);
      return ((c[0] - end[0]) * p.u[0] + (c[1] - end[1]) * p.u[1]) * dir >= BALL_RADIUS_PX;
    };
    // ...and right at it: ball-sized ground within a few px of the axis point just off the end.
    // (`loosePortals`: anywhere beyond the end within reach, for the squeeze retry.)
    const r = opts.loosePortals ? 3 * lead + BALL_RADIUS_PX : BALL_RADIUS_PX + cell;
    p.lowCell = nearestWalkable(
      grid,
      opts.loosePortals ? p.lowPt : p.lowAxis,
      r,
      (l, i) => l === (lowIsl ?? -2) + 1 && beyond(i, p.start, -1),
    );
    p.highCell = nearestWalkable(
      grid,
      opts.loosePortals ? p.highPt : p.highAxis,
      r,
      (l, i) => l === (highIsl ?? -2) + 1 && beyond(i, p.elevator.b, 1),
    );
    if (p.lowCell < 0 || p.highCell < 0 || p.trapped) return;
    const add = (c: number, dir: 0 | 1) => grid.portalAt.set(c, [...(grid.portalAt.get(c) ?? []), [k, dir]]);
    add(p.lowCell, 0);
    add(p.highCell, 1);
  });
  if (opts.jumps !== false) addJumpLinks(grid, opts.jumpMaxPx ?? JUMP_MAX_PX);
  return grid;
}

/** Longest gap (px) the planner will jump across a neck (N: chosen; JUMP ≈ 0.7 s of flight at ~2.5 m/s). */
export const JUMP_MAX_PX = 22;

/**
 * Jump links: where an island's walkable ground is split by a neck narrower than the ball, connect the closest
 * cells of the two parts if the gap is short and there is land (the same island) under the whole jump.
 * E: 2013 had JUMP (+16.7 m/s); the solver uses it only where the ball can't roll.
 */
function addJumpLinks(g: NavGrid, maxPx: number): void {
  const n = g.w * g.h;
  const comp = new Int32Array(n).fill(-1);
  const compLabel: number[] = [];
  const border: number[][] = [];
  for (let i = 0; i < n; i++) {
    const l = g.label[i] as number;
    if (l <= 0 || comp[i] !== -1 || !walkable(g, i)) continue;
    const id = compLabel.length;
    compLabel.push(l);
    const edge: number[] = [];
    const st = [i];
    comp[i] = id;
    while (st.length) {
      const c = st.pop() as number;
      const x = c % g.w;
      const y = Math.floor(c / g.w);
      let isEdge = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
          const j = ny * g.w + nx;
          if (g.label[j] !== l || !walkable(g, j)) {
            isEdge = true;
            continue;
          }
          if (comp[j] !== -1) continue;
          comp[j] = id;
          st.push(j);
        }
      if (isEdge) edge.push(c);
    }
    border.push(edge);
  }
  const byLabel = new Map<number, number[]>();
  for (const [id, l] of compLabel.entries()) byLabel.set(l, [...(byLabel.get(l) ?? []), id]);
  const landUnder = (a: Vec2, b: Vec2, l: number) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / (g.cell / 2)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const c = cellOf(g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      if (g.label[c] !== l || g.lift[c]) return false;
    }
    return true;
  };
  for (const [l, ids] of byLabel) {
    if (ids.length < 2) continue;
    for (let x = 0; x < ids.length; x++)
      for (let y = x + 1; y < ids.length; y++) {
        let best = maxPx;
        let pair: [number, number] | null = null;
        for (const ca of border[ids[x] as number] as number[]) {
          const pa = cellCenter(g, ca);
          for (const cb of border[ids[y] as number] as number[]) {
            const pb = cellCenter(g, cb);
            const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
            if (d <= best && landUnder(pa, pb, l)) {
              best = d;
              pair = [ca, cb];
            }
          }
        }
        if (!pair) continue;
        const k = g.jumps.length;
        g.jumps.push({
          a: cellCenter(g, pair[0]),
          b: cellCenter(g, pair[1]),
          aCell: pair[0],
          bCell: pair[1],
          label: l,
        });
        g.jumpAt.set(pair[0], [...(g.jumpAt.get(pair[0]) ?? []), [k, 0]]);
        g.jumpAt.set(pair[1], [...(g.jumpAt.get(pair[1]) ?? []), [k, 1]]);
      }
  }
}

export function cellOf(g: NavGrid, p: Vec2): number {
  const gx = Math.min(g.w - 1, Math.max(0, Math.floor(p[0] / g.cell)));
  const gy = Math.min(g.h - 1, Math.max(0, Math.floor(p[1] / g.cell)));
  return gy * g.w + gx;
}

export function cellCenter(g: NavGrid, i: number): Vec2 {
  return [((i % g.w) + 0.5) * g.cell, (Math.floor(i / g.w) + 0.5) * g.cell];
}

export function walkable(g: NavGrid, i: number, minClear = g.minClear): boolean {
  return g.label[i] !== 0 && (g.clear[i] as number) >= minClear && g.lift[i] === 0;
}

/** Can the ball roll directly between two neighbouring labels? */
export function compatibleLabels(g: NavGrid, la: number, lb: number): boolean {
  if (la === lb) return true;
  if (la === 0 || lb === 0) return false;
  if ((la > 0 && lb > 0) || (la < 0 && lb < 0)) return false;
  const br = g.stage.bridges[-(la < 0 ? la : lb) - 1];
  const isl = g.stage.islands[(la > 0 ? la : lb) - 1];
  return !!br && !!isl && (br.from === isl.id || br.to === isl.id);
}

/**
 * Nearest walkable cell to `p` within `radiusPx` whose label passes `accept` (default any). When `levelHint`
 * is given, cells whose surface is more than `levelTol` D away are skipped. −1 if none.
 */
export function nearestWalkable(
  g: NavGrid,
  p: Vec2,
  radiusPx: number,
  accept: (label: number, cell: number) => boolean = () => true,
  levelHint?: number,
  levelTol = 1.6,
): number {
  const r = Math.ceil(radiusPx / g.cell);
  const cx = Math.floor(p[0] / g.cell);
  const cy = Math.floor(p[1] / g.cell);
  let best = -1;
  let bd = Number.POSITIVE_INFINITY;
  for (let y = Math.max(0, cy - r); y <= Math.min(g.h - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(g.w - 1, cx + r); x++) {
      const i = y * g.w + x;
      if (!walkable(g, i) || !accept(g.label[i] as number, i)) continue;
      if (levelHint !== undefined && Math.abs((g.level[i] as number) - levelHint) > levelTol) continue;
      const c = cellCenter(g, i);
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  return best;
}

/** What the ball is standing on at `p` (px), preferring a surface near `level`. */
export function surfaceAt(
  g: NavGrid,
  p: Vec2,
  level?: number,
): { kind: 'island'; islandId: number } | { kind: 'bridge'; bridgeId: number } | { kind: 'none' } {
  const i = cellOf(g, p);
  let l = g.label[i] as number;
  if (l === 0 || (level !== undefined && Math.abs((g.level[i] as number) - level) > 2)) {
    const j = nearestWalkable(g, p, 3 * g.cell, () => true, level, 2);
    l = j >= 0 ? (g.label[j] as number) : 0;
  }
  if (l > 0) return { kind: 'island', islandId: (g.stage.islands[l - 1] as { id: number }).id };
  if (l < 0) return { kind: 'bridge', bridgeId: (g.stage.bridges[-l - 1] as { id: number }).id };
  return { kind: 'none' };
}
