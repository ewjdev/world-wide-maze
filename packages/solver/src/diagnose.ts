/**
 * Failure diagnosis shared by the solver and the batch eval (task 5): where and why a stage can't be played.
 */
import type { Vec2 } from '@wwm/schema';
import { cellOf, type NavGrid, nearestWalkable, surfaceAt, walkable } from './nav.ts';
import { reachable } from './plan.ts';

export type FailureKind =
  | 'narrow-neck' // an island's walkable area is split by a neck narrower than the ball (builder geometry)
  | 'no-route' // a link can't be crossed / no path the ball fits through
  | 'goal-pocket' // the goal can't be reached (no room around it, cut off, or stuck next to it)
  | 'rail-corner' // stuck against a rail corner / narrow spot
  | 'ramp-climb' // stuck or rolling back on a ramp
  | 'bridge-fall' // fell off a bridge deck (too narrow at speed)
  | 'edge-fall' // fell off an island edge
  | 'elevator-blocked' // no room for the ball beyond an elevator platform end (can't get on / off)
  | 'elevator-timing' // failed at an elevator (no ride, fell from the platform)
  | 'unreachable-item' // item tour: an item can't be reached
  | 'stuck' // stuck elsewhere
  | 'timeout'; // ran out of sim time

export const FAILURE_KINDS: readonly FailureKind[] = [
  'narrow-neck',
  'no-route',
  'goal-pocket',
  'rail-corner',
  'ramp-climb',
  'bridge-fall',
  'edge-fall',
  'elevator-blocked',
  'elevator-timing',
  'unreachable-item',
  'stuck',
  'timeout',
];

export interface SolveFailure {
  kind: FailureKind;
  /** Stage px where it happened. */
  at: Vec2;
  islandId: number;
  bridgeId?: number;
  elevatorId?: number;
  detail?: string;
}

interface Link {
  to: number;
  near: Vec2;
  far: Vec2;
  /** Elevators: the portal cells (−1 = no room beyond that platform end). */
  nearCell?: number;
  farCell?: number;
  bridgeId?: number;
  elevatorId?: number;
}

/**
 * Why the planner found no route from `from`. Walks the island-level path (BFS over bridges/elevators) and
 * reports the first place the ball's reachable area stops: a neck inside an island narrower than the ball
 * ('narrow-neck'), an impassable link ('no-route'), or a goal without room for the ball ('goal-pocket').
 */
export function diagnoseNoRoute(g: NavGrid, from: Vec2, level?: number): SolveFailure {
  const stage = g.stage;
  let fromCell = cellOf(g, from);
  if (!walkable(g, fromCell)) fromCell = nearestWalkable(g, from, 60, () => true, level);
  const reach = reachable(g, fromCell);
  const labelOf = (islandId: number) => (g.islandIndex.get(islandId) ?? -2) + 1;
  const mouthCell = (p: Vec2, islandId: number) => nearestWalkable(g, p, 30, (l) => l === labelOf(islandId));
  const adj = new Map<number, Link[]>();
  const add = (x: number, l: Link) => adj.set(x, [...(adj.get(x) ?? []), l]);
  for (const b of stage.bridges) {
    add(b.from, { to: b.to, near: b.a, far: b.b, bridgeId: b.id });
    add(b.to, { to: b.from, near: b.b, far: b.a, bridgeId: b.id });
  }
  for (const p of g.portals) {
    const e = p.elevator;
    add(e.islandFrom, {
      to: e.islandTo,
      near: p.lowPt,
      far: p.highPt,
      elevatorId: e.id,
      nearCell: p.lowCell,
      farCell: p.highCell,
    });
    add(e.islandTo, {
      to: e.islandFrom,
      near: p.highPt,
      far: p.lowPt,
      elevatorId: e.id,
      nearCell: p.highCell,
      farCell: p.lowCell,
    });
  }
  const s0 = surfaceAt(g, from, level);
  const startIsland =
    s0.kind === 'island'
      ? s0.islandId
      : s0.kind === 'bridge'
        ? (stage.bridges.find((b) => b.id === s0.bridgeId)?.from ?? stage.start.islandId)
        : stage.start.islandId;
  const prev = new Map<number, { from: number; link: Link }>();
  const queue = [startIsland];
  const seen = new Set(queue);
  while (queue.length) {
    const cur = queue.shift() as number;
    for (const l of adj.get(cur) ?? []) {
      if (seen.has(l.to)) continue;
      seen.add(l.to);
      prev.set(l.to, { from: cur, link: l });
      queue.push(l.to);
    }
  }
  const path: { from: number; link: Link }[] = [];
  for (let at = stage.goal.islandId; at !== startIsland; ) {
    const p = prev.get(at);
    if (!p)
      return {
        kind: 'no-route',
        at: stage.goal.pos,
        islandId: stage.goal.islandId,
        detail: 'goal island not linked',
      };
    path.unshift(p);
    at = p.from;
  }
  const ids = (l: Link) => ({
    ...(l.bridgeId !== undefined ? { bridgeId: l.bridgeId } : {}),
    ...(l.elevatorId !== undefined ? { elevatorId: l.elevatorId } : {}),
  });
  const portalOf = (l: Link) => g.portals.find((p) => p.elevator.id === l.elevatorId);
  const name = (l: Link) => (l.bridgeId !== undefined ? `bridge ${l.bridgeId}` : `elevator ${l.elevatorId}`);
  for (const { from: x, link } of path) {
    const portal = portalOf(link);
    if (portal?.trapped) {
      const rise = portal.elevator.levelHigh - portal.elevator.levelLow;
      return {
        kind: 'elevator-blocked',
        at: portal.center,
        islandId: portal.elevator.islandFrom,
        ...ids(link),
        detail: `elevator ${link.elevatorId} rises only ${rise.toFixed(2)} D: the ball is pinned between its two platforms`,
      };
    }
    if (link.elevatorId !== undefined && ((link.nearCell ?? -1) < 0 || (link.farCell ?? -1) < 0)) {
      const nearBad = (link.nearCell ?? -1) < 0;
      return {
        kind: 'elevator-blocked',
        at: nearBad ? link.near : link.far,
        islandId: nearBad ? x : link.to,
        ...ids(link),
        detail: `no room for the ball beyond the ${nearBad ? 'boarding' : 'arrival'} end of elevator ${link.elevatorId} (platform ends at the island edge)`,
      };
    }
    const nc = link.nearCell ?? mouthCell(link.near, x);
    if (nc < 0)
      return {
        kind: 'narrow-neck',
        at: link.near,
        islandId: x,
        ...ids(link),
        detail: `no ground wide enough for the ball at the ${name(link)} mouth on island ${x}`,
      };
    if (!reach[nc])
      return {
        kind: 'narrow-neck',
        at: link.near,
        islandId: x,
        ...ids(link),
        detail: `island ${x} is split by a neck narrower than the ball; the ${name(link)} mouth is cut off`,
      };
    const fc = link.farCell ?? mouthCell(link.far, link.to);
    if (fc < 0 || !reach[fc])
      return {
        kind: 'no-route',
        at: link.far,
        islandId: link.to,
        ...ids(link),
        detail: `${name(link)} can't be crossed (landing too narrow for the ball)`,
      };
  }
  const goal = stage.goal;
  const gc = nearestWalkable(g, goal.pos, goal.radius + 12, (l) => l === labelOf(goal.islandId));
  if (gc < 0)
    return {
      kind: 'goal-pocket',
      at: goal.pos,
      islandId: goal.islandId,
      detail: 'no room for the ball at the goal',
    };
  if (!reach[gc])
    return {
      kind: 'goal-pocket',
      at: goal.pos,
      islandId: goal.islandId,
      detail: `goal island ${goal.islandId} is split by a neck narrower than the ball; the goal is cut off`,
    };
  return { kind: 'no-route', at: from, islandId: startIsland, detail: 'no path (unclassified)' };
}

export interface IslandIssue {
  islandId: number;
  /** 'split': the island's points of interest lie in different walkable parts; 'no-ground': a point has no
   *  ball-sized walkable ground nearby at all. */
  kind: 'split' | 'no-ground';
  /** Points of interest involved: 'bridge:3#0', 'elevator:1#2', 'start#0', 'goal#1' (#k = walkable part). */
  points: string[];
  at: Vec2;
}

/**
 * Builder audit: for every island, are all its link mouths (and the start/goal) in one walkable part for the
 * ball's centre? Independent of the route, so it also finds problems on islands the solver never visits.
 */
export function auditIslands(g: NavGrid): IslandIssue[] {
  const stage = g.stage;
  const poi = new Map<number, { name: string; p: Vec2; cell?: number }[]>();
  const add = (islandId: number, name: string, p: Vec2, cell?: number) =>
    poi.set(islandId, [...(poi.get(islandId) ?? []), { name, p, ...(cell !== undefined ? { cell } : {}) }]);
  for (const b of stage.bridges) {
    add(b.from, `bridge:${b.id}`, b.a);
    add(b.to, `bridge:${b.id}`, b.b);
  }
  for (const p of g.portals) {
    add(p.elevator.islandFrom, `elevator:${p.elevator.id}`, p.lowPt, p.lowCell);
    add(p.elevator.islandTo, `elevator:${p.elevator.id}`, p.highPt, p.highCell);
  }
  add(stage.start.islandId, 'start', stage.start.pos);
  add(stage.goal.islandId, 'goal', stage.goal.pos);
  const comp = new Int32Array(g.w * g.h).fill(-1);
  const issues: IslandIssue[] = [];
  let nextComp = 0;
  for (const [islandId, pts] of poi) {
    const label = (g.islandIndex.get(islandId) ?? -2) + 1;
    const ids: { name: string; p: Vec2; c: number }[] = [];
    for (const { name, p, cell: given } of pts) {
      const r = name === 'goal' ? stage.goal.radius + 12 : 30;
      const cell = given ?? nearestWalkable(g, p, r, (l) => l === label);
      if (cell < 0) {
        issues.push({ islandId, kind: 'no-ground', points: [name], at: p });
        continue;
      }
      if ((comp[cell] as number) < 0) {
        const id = nextComp++;
        const stack = [cell];
        comp[cell] = id;
        while (stack.length) {
          const c = stack.pop() as number;
          const x = c % g.w;
          const y = Math.floor(c / g.w);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
              const j = ny * g.w + nx;
              if ((comp[j] as number) >= 0 || g.label[j] !== label || !walkable(g, j)) continue;
              if (dx && dy && (!walkable(g, y * g.w + nx) || !walkable(g, ny * g.w + x))) continue;
              comp[j] = id;
              stack.push(j);
            }
        }
      }
      ids.push({ name, p, c: comp[cell] as number });
    }
    if (new Set(ids.map((i) => i.c)).size > 1) {
      const first = ids[0]?.c;
      const cut = ids.find((i) => i.c !== first) as { p: Vec2 };
      issues.push({ islandId, kind: 'split', points: ids.map((i) => `${i.name}#${i.c}`), at: cut.p });
    }
  }
  return issues;
}
