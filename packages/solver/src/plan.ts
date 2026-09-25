/**
 * Route planning on the NavGrid: A* from a point to the goal (elevators are portal edges with a wait cost),
 * then the cell path is split into legs at elevator rides, simplified by line of sight (never through cells
 * with less clearance than the original path had there), and annotated with a speed limit per vertex:
 * a cap from clearance / surface (island, deck, ramp), a corner speed from the turning angle, and a backward
 * braking pass. The pilot (pilot.ts) follows one leg at a time.
 */
import { pxToMeters, type Vec2 } from '@wwm/schema';
import {
  cellCenter,
  cellOf,
  compatibleLabels,
  type ElevatorPortal,
  type JumpLink,
  type NavGrid,
  nearestWalkable,
  walkable,
} from './nav.ts';

export interface PlanTuning {
  /** Cruise speed on open ground (m/s). */
  cruise: number;
  /** Speed on the narrowest walkable ground (m/s). */
  narrow: number;
  /** Clearance (px) from which ground counts as fully open. */
  openClearPx: number;
  /** Speed cap on bridge decks (m/s) and descending ramps. */
  bridge: number;
  rampDown: number;
  /** Corner speed at a 90° turn (m/s); scales with the turn. */
  corner90: number;
  /** Braking deceleration used for the speed profile (m/s²). */
  brake: number;
  /** Speed when entering an elevator footprint (m/s). */
  elevatorEntry: number;
  /** Speed at the goal (m/s). */
  goalSpeed: number;
  /** A* cost weight for low clearance (0 = shortest path). */
  clearWeight: number;
}

export const DEFAULT_TUNING: Readonly<PlanTuning> = Object.freeze({
  cruise: 7,
  narrow: 3,
  openClearPx: 26,
  bridge: 5.5,
  rampDown: 4,
  corner90: 2.6,
  brake: 7,
  elevatorEntry: 1.6,
  goalSpeed: 2.5,
  clearWeight: 2.5,
});

/** Jump approach: run-up length (px) and take-off speed (m/s). N: chosen. */
export const JUMP_RUNUP_PX = 20;
export const JUMP_TAKEOFF_SPEED = 2.6;

export interface LegVertex {
  p: Vec2; // stage px
  /** Speed limit at this vertex (m/s), after the braking pass. */
  v: number;
  /** Arc length from the leg start (m). */
  s: number;
  /** Label of the surface from this vertex to the next (see NavGrid.label). */
  label: number;
  /** Min clearance along the segment from this vertex to the next (px). */
  clear: number;
  /** Speed cap on the segment from this vertex to the next (m/s). */
  cap: number;
  /** Turning angle at this vertex (rad; 0 at the ends). */
  turn: number;
}

export interface Leg {
  verts: LegVertex[];
  /** Leg ends by entering this elevator (the ride takes the ball to the next leg). */
  elevator?: { portal: ElevatorPortal; dir: 0 | 1 };
  /** Leg ends at a jump take-off: JUMP, fly to `to`, the next leg starts there. */
  jump?: { link: JumpLink; from: Vec2; to: Vec2 };
  length: number; // m
}

export interface Route {
  legs: Leg[];
  /** Estimated time (s) from the A* cost; informational. */
  lengthM: number;
  cells: number[];
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((keys[p] as number) <= key) break;
      ids[i] = ids[p] as number;
      keys[i] = keys[p] as number;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0] as number;
    const lastId = ids.pop() as number;
    const lastKey = keys.pop() as number;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && (keys[r] as number) < (keys[l] as number) ? r : l;
        if ((keys[c] as number) >= lastKey) break;
        ids[i] = ids[c] as number;
        keys[i] = keys[c] as number;
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

const NEIGHBOURS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

export interface PortalStep {
  kind: 'elevator' | 'jump';
  index: number;
  dir: 0 | 1;
}

/** A* cost of a jump beyond its length (cells): jumps are used only where rolling can't get through. */
const JUMP_PENALTY_CELLS = 60;

export interface AStarResult {
  cells: number[];
  /** For each step i→i+1: the portal crossed (or undefined for a plain move). */
  portalSteps: Map<number, PortalStep>;
  cost: number;
}

/** A* over walkable cells; `goal` cells are any cell within `goalRadiusCells` of the target cell. */
export function astar(
  g: NavGrid,
  from: number,
  to: number,
  tuning: PlanTuning = DEFAULT_TUNING,
): AStarResult | null {
  const n = g.w * g.h;
  const gScore = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const came = new Int32Array(n).fill(-1);
  const viaPortal = new Map<number, PortalStep>();
  const closed = new Uint8Array(n);
  const tx = to % g.w;
  const ty = Math.floor(to / g.w);
  const h = (i: number) => Math.hypot((i % g.w) - tx, Math.floor(i / g.w) - ty);
  const openClear = tuning.openClearPx;
  const stepCost = (i: number) => {
    const c = g.clear[i] as number;
    const narrow = c >= openClear ? 0 : (openClear - c) / openClear;
    const ramp = (g.label[i] as number) < 0 ? 0.15 : 0;
    return 1 + tuning.clearWeight * narrow * narrow + ramp;
  };
  const heap = new MinHeap();
  gScore[from] = 0;
  heap.push(from, h(from));
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === to) break;
    const cx = cur % g.w;
    const cy = Math.floor(cur / g.w);
    const lc = g.label[cur] as number;
    const gc = gScore[cur] as number;
    for (const [dx, dy, len] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ni = ny * g.w + nx;
      if (closed[ni] || !walkable(g, ni)) continue;
      const ln = g.label[ni] as number;
      if (!compatibleLabels(g, lc, ln)) continue;
      if (dx !== 0 && dy !== 0) {
        // no corner cutting
        const a = cy * g.w + nx;
        const b = ny * g.w + cx;
        if (!walkable(g, a) || !walkable(g, b)) continue;
      }
      const t = gc + len * stepCost(ni);
      if (t < (gScore[ni] as number)) {
        gScore[ni] = t;
        came[ni] = cur;
        viaPortal.delete(ni);
        heap.push(ni, t + h(ni));
      }
    }
    for (const [k, dir] of g.portalAt.get(cur) ?? []) {
      const p = g.portals[k] as ElevatorPortal;
      const ni = dir === 0 ? p.highCell : p.lowCell;
      if (closed[ni]) continue;
      // Ride cost: platform length + travel time + an average cooldown wait, in cell units at cruise speed.
      const pxPerSec = tuning.cruise * 13.5;
      const t = gc + (p.lenPx + (p.elevator.travelSec + 1.5) * pxPerSec) / g.cell;
      if (t < (gScore[ni] as number)) {
        gScore[ni] = t;
        came[ni] = cur;
        viaPortal.set(ni, { kind: 'elevator', index: k, dir });
        heap.push(ni, t + h(ni));
      }
    }
    for (const [k, dir] of g.jumpAt.get(cur) ?? []) {
      const j = g.jumps[k] as JumpLink;
      const ni = dir === 0 ? j.bCell : j.aCell;
      if (closed[ni]) continue;
      const t = gc + Math.hypot(j.b[0] - j.a[0], j.b[1] - j.a[1]) / g.cell + JUMP_PENALTY_CELLS;
      if (t < (gScore[ni] as number)) {
        gScore[ni] = t;
        came[ni] = cur;
        viaPortal.set(ni, { kind: 'jump', index: k, dir });
        heap.push(ni, t + h(ni));
      }
    }
  }
  if (!Number.isFinite(gScore[to] as number)) return null;
  const cells: number[] = [];
  const portalSteps = new Map<number, PortalStep>();
  const rev: { cell: number; portal?: PortalStep }[] = [];
  for (let c = to; c !== -1; c = came[c] as number) {
    const vp = viaPortal.get(c);
    rev.push(vp ? { cell: c, portal: vp } : { cell: c });
    if (c === from) break;
  }
  rev.reverse();
  rev.forEach((r, i) => {
    cells.push(r.cell);
    if (r.portal) portalSteps.set(i - 1, r.portal);
  });
  return { cells, portalSteps, cost: gScore[to] as number };
}

/** Line-of-sight between two points: every sample walkable at `minClear`, labels stepping compatibly. */
function lineOk(g: NavGrid, a: Vec2, b: Vec2, minClear: number): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
  let prev = g.label[cellOf(g, a)] as number;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const c = cellOf(g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    if (!walkable(g, c, minClear)) return false;
    const l = g.label[c] as number;
    if (!compatibleLabels(g, prev, l)) return false;
    prev = l;
  }
  return true;
}

/** Min clearance and dominant non-island label along a→b. */
function segmentInfo(g: NavGrid, a: Vec2, b: Vec2): { clear: number; label: number } {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(len / g.cell));
  let clear = Number.POSITIVE_INFINITY;
  let label = 0;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const c = cellOf(g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    const cl = g.clear[c] as number;
    if (cl < clear) clear = cl;
    const l = g.label[c] as number;
    if (l < 0 || label === 0) label = l;
  }
  return { clear, label };
}

/** Simplify a run of cells to a polyline (px). */
function simplify(g: NavGrid, cells: readonly number[]): Vec2[] {
  const pts = cells.map((c) => cellCenter(g, c));
  if (pts.length <= 2) return pts;
  // prefix-min of clearance is not enough (windows); use a sliding minimum per candidate span.
  const out: Vec2[] = [pts[0] as Vec2];
  let anchor = 0;
  let spanMin = Number.POSITIVE_INFINITY;
  for (let k = 1; k < pts.length; k++) {
    spanMin = Math.min(spanMin, g.clear[cells[k] as number] as number);
    const need = Math.min(spanMin, g.minClear + 6);
    // Keep segments short enough that the pursuit point never runs far off the grid path.
    const tooLong =
      Math.hypot(
        (pts[k] as Vec2)[0] - (pts[anchor] as Vec2)[0],
        (pts[k] as Vec2)[1] - (pts[anchor] as Vec2)[1],
      ) > 400;
    if (tooLong || !lineOk(g, pts[anchor] as Vec2, pts[k] as Vec2, Math.max(g.minClear, need - 0.01))) {
      out.push(pts[k - 1] as Vec2);
      anchor = k - 1;
      spanMin = Math.min(g.clear[cells[k - 1] as number] as number, g.clear[cells[k] as number] as number);
    }
  }
  out.push(pts[pts.length - 1] as Vec2);
  return out;
}

function turnAngle(a: Vec2, b: Vec2, c: Vec2): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < 1e-6 || lv < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
  return Math.acos(cos);
}

/** Annotate a polyline with speed limits and arc length. `endSpeed` applies to the last vertex. */
export function makeLeg(g: NavGrid, pts: Vec2[], endSpeed: number, tuning: PlanTuning): Leg {
  const verts: LegVertex[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Vec2;
    if (i > 0) s += pxToMeters(Math.hypot(p[0] - (pts[i - 1] as Vec2)[0], p[1] - (pts[i - 1] as Vec2)[1]));
    const next = pts[i + 1];
    const info = next
      ? segmentInfo(g, p, next)
      : { clear: g.clear[cellOf(g, p)] as number, label: g.label[cellOf(g, p)] as number };
    verts.push({ p, v: tuning.cruise, s, label: info.label, clear: info.clear, cap: tuning.cruise, turn: 0 });
  }
  // Segment caps (applied to both ends of the segment).
  const segCap = (i: number): number => {
    const v = verts[i] as LegVertex;
    const span = Math.max(0, Math.min(1, (v.clear - g.minClear) / (tuning.openClearPx - g.minClear)));
    let cap = tuning.narrow + (tuning.cruise - tuning.narrow) * span;
    if (v.label < 0) {
      const br = g.stage.bridges[-v.label - 1];
      cap = Math.min(cap, tuning.bridge);
      if (br && br.type === 'ramp' && verts[i + 1]) {
        // descending? compare levels at both ends of the segment
        const l0 = g.level[cellOf(g, v.p)] as number;
        const l1 = g.level[cellOf(g, (verts[i + 1] as LegVertex).p)] as number;
        if (l1 < l0 - 0.05) cap = Math.min(cap, tuning.rampDown);
      }
    }
    return cap;
  };
  for (let i = 0; i < verts.length - 1; i++) (verts[i] as LegVertex).cap = segCap(i);
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i] as LegVertex;
    let lim = i < verts.length - 1 ? segCap(i) : endSpeed;
    if (i > 0) lim = Math.min(lim, segCap(i - 1));
    if (i > 0 && i < verts.length - 1) {
      const th = turnAngle((verts[i - 1] as LegVertex).p, v.p, (verts[i + 1] as LegVertex).p);
      v.turn = th;
      // corner speed: full cruise below ~10°, corner90 at 90°, lower beyond.
      const k = Math.max(0, Math.cos(th / 2)) ** 2 / 0.5; // 2 at 0°, 1 at 90°, 0 at 180°
      const vc = th < 0.17 ? Number.POSITIVE_INFINITY : Math.max(1.2, tuning.corner90 * k ** 1.5);
      lim = Math.min(lim, vc);
    }
    v.v = lim;
  }
  for (let i = verts.length - 2; i >= 0; i--) {
    const a = verts[i] as LegVertex;
    const b = verts[i + 1] as LegVertex;
    a.v = Math.min(a.v, Math.sqrt(b.v * b.v + 2 * tuning.brake * (b.s - a.s)));
  }
  return { verts, length: s };
}

export interface PlanRequest {
  from: Vec2;
  /** Ball height (D) to disambiguate stacked surfaces (elevator platforms over islands). */
  level?: number;
  to?: Vec2;
}

/** Plan from `from` to the goal (or `to`). Returns null if no route exists. */
export function planRoute(g: NavGrid, req: PlanRequest, tuning: PlanTuning = DEFAULT_TUNING): Route | null {
  const target = req.to ?? g.stage.goal.pos;
  let fromCell = cellOf(g, req.from);
  if (
    !walkable(g, fromCell) ||
    (req.level !== undefined && Math.abs((g.level[fromCell] as number) - req.level) > 1.6)
  )
    fromCell = nearestWalkable(g, req.from, 60, () => true, req.level);
  if (fromCell < 0) fromCell = nearestWalkable(g, req.from, 120);
  let toCell = cellOf(g, target);
  if (!walkable(g, toCell)) toCell = nearestWalkable(g, target, 40);
  if (fromCell < 0 || toCell < 0) return null;
  const r = astar(g, fromCell, toCell, tuning);
  if (!r) return null;
  const legs: Leg[] = [];
  let runStart = 0;
  const flush = (
    endIdx: number,
    elevator?: { portal: ElevatorPortal; dir: 0 | 1 },
    jump?: { link: JumpLink; from: Vec2; to: Vec2 },
  ) => {
    const run = r.cells.slice(runStart, endIdx + 1);
    let pts = simplify(g, run);
    if (legs.length === 0) pts[0] = [req.from[0], req.from[1]];
    if (elevator) {
      const p = elevator.portal;
      // Walk onto the axis, then into the footprint: from the low side aim past `start`, from the high side past `b`.
      const entry: Vec2 = cellCenter(g, elevator.dir === 0 ? p.lowCell : p.highCell);
      const axis = elevator.dir === 0 ? p.lowAxis : p.highAxis;
      pts = [...pts.slice(0, -1), entry, axis, p.center];
    }
    if (jump) {
      // A straight run-up along the jump direction when there is room for it.
      const d = Math.hypot(jump.to[0] - jump.from[0], jump.to[1] - jump.from[1]) || 1;
      const u: Vec2 = [(jump.to[0] - jump.from[0]) / d, (jump.to[1] - jump.from[1]) / d];
      const runup: Vec2 = [jump.from[0] - u[0] * JUMP_RUNUP_PX, jump.from[1] - u[1] * JUMP_RUNUP_PX];
      const prev = pts.length >= 2 ? (pts[pts.length - 2] as Vec2) : undefined;
      const withRunup = prev && lineOk(g, prev, runup, g.minClear) && lineOk(g, runup, jump.from, g.minClear);
      pts = [...pts.slice(0, -1), ...(withRunup ? [runup] : []), jump.from];
    }
    const end = elevator ? tuning.elevatorEntry : jump ? JUMP_TAKEOFF_SPEED : tuning.goalSpeed;
    if (!elevator && !jump) pts = [...pts.slice(0, -1), target];
    legs.push({
      ...makeLeg(g, dedupe(pts), end, tuning),
      ...(elevator ? { elevator } : {}),
      ...(jump ? { jump } : {}),
    });
  };
  for (let i = 0; i < r.cells.length - 1; i++) {
    const ps = r.portalSteps.get(i);
    if (!ps) continue;
    if (ps.kind === 'elevator') flush(i, { portal: g.portals[ps.index] as ElevatorPortal, dir: ps.dir });
    else {
      const link = g.jumps[ps.index] as JumpLink;
      flush(i, undefined, { link, from: ps.dir === 0 ? link.a : link.b, to: ps.dir === 0 ? link.b : link.a });
    }
    runStart = i + 1;
  }
  flush(r.cells.length - 1);
  // After a ride, a leg starts at the exit point of the platform: prepend the platform exit direction.
  for (let k = 1; k < legs.length; k++) {
    const prev = legs[k - 1] as Leg;
    const e = prev.elevator;
    if (!e) continue;
    const leg = legs[k] as Leg;
    const p = e.portal;
    const first = cellCenter(g, e.dir === 0 ? p.highCell : p.lowCell);
    const axis = e.dir === 0 ? p.highAxis : p.lowAxis;
    const pts = [axis, first, ...leg.verts.map((v) => v.p).slice(1)];
    const endV = leg.elevator ? tuning.elevatorEntry : leg.jump ? JUMP_TAKEOFF_SPEED : tuning.goalSpeed;
    legs[k] = makeLeg(g, dedupe(pts), endV, tuning);
    if (leg.elevator) (legs[k] as Leg).elevator = leg.elevator;
    if (leg.jump) (legs[k] as Leg).jump = leg.jump;
  }
  return { legs, lengthM: legs.reduce((a, l) => a + l.length, 0), cells: r.cells };
}

function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5) out.push(p);
  }
  return out;
}

/** Every cell the ball can reach from `from` (same move rules as A*, portals included). */
export function reachable(g: NavGrid, from: number): Uint8Array {
  const seen = new Uint8Array(g.w * g.h);
  if (from < 0) return seen;
  const stack = [from];
  seen[from] = 1;
  while (stack.length) {
    const cur = stack.pop() as number;
    const cx = cur % g.w;
    const cy = Math.floor(cur / g.w);
    const lc = g.label[cur] as number;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ni = ny * g.w + nx;
      if (seen[ni] || !walkable(g, ni) || !compatibleLabels(g, lc, g.label[ni] as number)) continue;
      if (dx !== 0 && dy !== 0 && (!walkable(g, cy * g.w + nx) || !walkable(g, ny * g.w + cx))) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
    for (const [k, dir] of g.portalAt.get(cur) ?? []) {
      const p = g.portals[k] as ElevatorPortal;
      const ni = dir === 0 ? p.highCell : p.lowCell;
      if (ni >= 0 && !seen[ni]) {
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    for (const [k, dir] of g.jumpAt.get(cur) ?? []) {
      const j = g.jumps[k] as JumpLink;
      const ni = dir === 0 ? j.bCell : j.aCell;
      if (!seen[ni]) {
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return seen;
}
