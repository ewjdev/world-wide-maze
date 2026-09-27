/**
 * Phase 20 M4b (N): where the Pip gates stand on a stage. A built stage only carries `StageData` at runtime (the
 * builder's walkable raster is gone), so this re-applies the builder's portal rules
 * (packages/stage-builder/src/portals.ts) to a grid of candidate spots on the islands the ball can reach:
 *
 * - the whole gate ring on the island (clear of the edge and of holes by a gate radius);
 * - ≥ 4 D from the start and the goal, ≥ 2 D from bridge and lift mouths and from large items;
 * - no small item inside the ring (the builder removes those; here the stage stays untouched, so the spot moves),
 *   and no restart point inside it (a respawn never lands in a gate);
 * - ≥ 6 D between gates.
 *
 * The choice is deterministic (a fixed grid, no randomness, stable tie-breaks): the same stage always gets the same
 * gates. Candidates are ordered by how far along the way from the start to the goal they are, and the gates are
 * spread evenly along that order, so gate 1 is near the start and the last one is near the goal.
 */
import {
  BALL_RADIUS_PX,
  distanceToPolygonEdge,
  type Island,
  PORTAL_RADIUS_M,
  type Portal,
  PX_PER_METER,
  pointInPolygon,
  type StageData,
  type Vec2,
} from '@wwm/schema';

/** One ball diameter in stage px (the builder's `D`). */
const D = PX_PER_METER;
export const GATE_RADIUS_PX = PORTAL_RADIUS_M * PX_PER_METER;
export const KEEP_START_PX = 4 * D;
export const KEEP_MOUTH_PX = 2 * D;
export const KEEP_LARGE_PX = 2 * D;
export const GATE_SPACING_PX = 6 * D;
const KEEP_SMALL_PX = GATE_RADIUS_PX + BALL_RADIUS_PX;
const KEEP_RESTART_PX = GATE_RADIUS_PX + 2 * BALL_RADIUS_PX;
const CLEARANCE_PX = GATE_RADIUS_PX;
const GRID_PX = D;
/** More gates than this crowd a stage (and MAX_PORTALS is 6). */
export const MAX_GATES = 5;

export interface GateSpot {
  islandId: number;
  pos: Vec2;
  /** 0 at the start … 1 at the goal (straight-line share of the way). */
  progress: number;
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const dist = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Islands connected to the start island by bridges and lifts. */
export function reachableIslands(stage: StageData): Set<number> {
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  };
  for (const b of stage.bridges) link(b.from, b.to);
  for (const e of stage.elevators) link(e.islandFrom, e.islandTo);
  const seen = new Set<number>([stage.start.islandId]);
  const queue = [stage.start.islandId];
  while (queue.length > 0) {
    const id = queue.shift() as number;
    for (const next of links.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** Every spot on the stage where a gate may stand, in start → goal order. */
export function gateSpots(stage: StageData): GateSpot[] {
  const reach = reachableIslands(stage);
  const start = stage.start.pos;
  const goal = stage.goal.pos;
  const mouths = [
    ...stage.bridges.map((b) => ({ a: b.a, b: b.b, keep: KEEP_MOUTH_PX + b.width / 2 })),
    ...stage.elevators.map((e) => ({ a: e.a, b: e.b, keep: KEEP_MOUTH_PX + e.width / 2 })),
  ];
  const large = stage.items.filter((it) => it.kind === 'large').map((it) => it.pos);
  const small = stage.items.filter((it) => it.kind !== 'large').map((it) => it.pos);
  const restarts = stage.islands.flatMap((island) => island.restartPoints);
  const spots: GateSpot[] = [];
  const islands = [...stage.islands].sort((p, q) => p.id - q.id);
  for (const island of islands) {
    if (!reach.has(island.id) || island.contour.length < 3) continue;
    for (const pos of gridPoints(island)) {
      if (!pointInPolygon(pos, island.contour, island.holes)) continue;
      if (distanceToPolygonEdge(pos, island.contour, island.holes) < CLEARANCE_PX) continue;
      if (dist(pos, start) < KEEP_START_PX || dist(pos, goal) < KEEP_START_PX) continue;
      if (mouths.some((m) => segmentDistance(pos, m.a, m.b) < m.keep)) continue;
      if (large.some((p) => dist(pos, p) < KEEP_LARGE_PX)) continue;
      if (small.some((p) => dist(pos, p) < KEEP_SMALL_PX)) continue;
      if (restarts.some((p) => dist(pos, p) < KEEP_RESTART_PX)) continue;
      const toStart = dist(pos, start);
      const toGoal = dist(pos, goal);
      spots.push({ islandId: island.id, pos, progress: toStart / (toStart + toGoal) });
    }
  }
  return spots.sort(
    (p, q) =>
      p.progress - q.progress || p.pos[1] - q.pos[1] || p.pos[0] - q.pos[0] || p.islandId - q.islandId,
  );
}

/** Grid points over the island's bounding box, on a stage-anchored grid (so the result doesn't drift). */
function gridPoints(island: Island): Vec2[] {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const [x, y] of island.contour) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const out: Vec2[] = [];
  for (let gy = Math.ceil(y0 / GRID_PX); gy * GRID_PX <= y1; gy++)
    for (let gx = Math.ceil(x0 / GRID_PX); gx * GRID_PX <= x1; gx++) out.push([gx * GRID_PX, gy * GRID_PX]);
  return out;
}

/**
 * Up to `count` gate spots (≤ MAX_GATES), spread evenly along the way from the start to the goal and ≥ 6 D apart,
 * in start → goal order. Returns [] when the stage has no room for a gate.
 */
export function placeGates(stage: StageData, count: number): GateSpot[] {
  const want = Math.max(0, Math.min(MAX_GATES, Math.floor(count)));
  const spots = gateSpots(stage);
  if (want === 0 || spots.length === 0) return [];
  const placed: GateSpot[] = [];
  const free = (s: GateSpot) => placed.every((p) => dist(p.pos, s.pos) >= GATE_SPACING_PX);
  for (let k = 0; k < want; k++) {
    // the k-th of `want` evenly spaced targets along the ordered spots; search outwards from it
    const target = Math.round(((k + 0.5) / want) * (spots.length - 1));
    for (let off = 0; off < spots.length; off++) {
      const candidates = off === 0 ? [target] : [target + off, target - off];
      const hit = candidates
        .filter((i) => i >= 0 && i < spots.length)
        .map((i) => spots[i] as GateSpot)
        .find(free);
      if (hit) {
        placed.push(hit);
        break;
      }
    }
  }
  return placed.sort((p, q) => p.progress - q.progress || p.pos[1] - q.pos[1] || p.pos[0] - q.pos[0]);
}

/** The gates as stage portals (the physics sensor, the engine's gate and the pause all come with them). */
export function gatePortals(
  spots: readonly GateSpot[],
  href: (n: number) => string,
  label: (n: number) => string,
): Portal[] {
  return spots.map((spot, i) => ({
    id: i,
    islandId: spot.islandId,
    pos: [spot.pos[0], spot.pos[1]] as Vec2,
    href: href(i + 1),
    label: label(i + 1),
    // not from a page element; 0 keeps the stage schema-valid (nothing reads it for a gate)
    sourceElementId: 0,
  }));
}
