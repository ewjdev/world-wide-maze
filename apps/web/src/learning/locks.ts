/**
 * Phase 22 M3 (N): binding a level's steps to a maze. A lesson declares intent (ordered steps, a lock
 * configuration); it never names a bridge. This module reads the stage's island graph and decides, purely and
 * deterministically, where each step's Pip gate or mission post stands and which bridges or lifts it keeps shut
 * (plans/phase-22-learning-mechanics.md §4):
 *
 * 1. **Graph and path.** Islands reachable from the start are nodes; bridges (from/to) and lifts
 *    (islandFrom/islandTo) are edges (a multigraph: parallel bridges are separate edges). `islandPath` is the BFS
 *    start → goal island path.
 * 2. **The cut chain.** From the start region, repeatedly take the minimum edge cut to the goal (unit-capacity
 *    max-flow; only the level's `connectors` can be cut, every other connector has infinite capacity), then step
 *    across it. That gives the nested "chokepoints" C₀, C₁, … of this maze: segment k is what lies between C_{k−1}
 *    and C_k.
 * 3. **Steps → cuts and spots.** Locking (`path`) steps take chain cuts in order, spread evenly when there are
 *    more cuts than steps, and only where the segment in front of the cut has room for a gate. Each step's gate or
 *    post stands in front of its cut (Phase 20 placement rules, `gateSpots`); other steps stand between their
 *    neighbours.
 * 4. **Fallback.** A `path` step with no cut (too few chokepoints, no room, start and goal on one island, only
 *    non-lockable connectors) becomes a goal lock, even when the level's `goal` is false, so a locking step is
 *    never silently dropped. The fallback is recorded.
 *
 * Invariants (property-tested in test/learning-locks.test.ts; `checkBinding` reports violations):
 *   (a) with the cuts of steps ≥ j closed (earlier ones open), step j's host island is reachable;
 *   (b) with only step j's cut closed, the goal is unreachable;
 *   (c) with every cut open, every island is reachable;
 *   (d) liveness: doing whatever step is reachable, repeatedly, finishes every placed step.
 */
import type { PlanStep, ResolvedLocks, StepLock } from '@wwm/learning';
import type { LockSpec, StageData } from '@wwm/schema';
import { GATE_SPACING_PX, type GateSpot, gateSpots } from './placement.ts';

export type ConnectorKind = 'bridge' | 'elevator';

export interface Edge {
  kind: ConnectorKind;
  /** Bridge or elevator id. */
  id: number;
  a: number;
  b: number;
}

export interface IslandGraph {
  start: number;
  goal: number;
  /** Islands reachable from the start (sorted). */
  islands: number[];
  /** Connectors between reachable islands, bridges first, each in id order. */
  edges: Edge[];
  /** Island → indices into `edges`. */
  adj: Map<number, number[]>;
}

/** Gates and posts per stage: one per step up to this many (MAX_GATE_NUMBER in @wwm/learning is 8 too). */
export const MAX_STEP_SPOTS = 8;

export function islandGraph(stage: StageData): IslandGraph {
  const all: Edge[] = [
    ...[...stage.bridges]
      .sort((p, q) => p.id - q.id)
      .map((b) => ({ kind: 'bridge' as const, id: b.id, a: b.from, b: b.to })),
    ...[...stage.elevators]
      .sort((p, q) => p.id - q.id)
      .map((e) => ({ kind: 'elevator' as const, id: e.id, a: e.islandFrom, b: e.islandTo })),
  ].filter((e) => e.a !== e.b);
  const links = new Map<number, number[]>();
  all.forEach((e, i) => {
    links.set(e.a, [...(links.get(e.a) ?? []), i]);
    links.set(e.b, [...(links.get(e.b) ?? []), i]);
  });
  const start = stage.start.islandId;
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const at = queue.shift() as number;
    for (const i of links.get(at) ?? []) {
      const e = all[i] as Edge;
      const next = e.a === at ? e.b : e.a;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const edges = all.filter((e) => seen.has(e.a) && seen.has(e.b));
  const adj = new Map<number, number[]>();
  for (const island of seen) adj.set(island, []);
  edges.forEach((e, i) => {
    adj.get(e.a)?.push(i);
    adj.get(e.b)?.push(i);
  });
  return { start, goal: stage.goal.islandId, islands: [...seen].sort((p, q) => p - q), edges, adj };
}

const other = (e: Edge, island: number) => (e.a === island ? e.b : e.a);

/** Islands reachable from `from` (default: the start) without crossing an edge `closed` rejects. */
export function reachable(
  g: IslandGraph,
  closed: (edge: Edge, index: number) => boolean = () => false,
  from: Iterable<number> = [g.start],
): Set<number> {
  const seen = new Set<number>(from);
  const queue = [...seen];
  while (queue.length > 0) {
    const at = queue.shift() as number;
    for (const i of g.adj.get(at) ?? []) {
      const e = g.edges[i] as Edge;
      if (closed(e, i)) continue;
      const next = other(e, at);
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** The BFS start → goal island path (fewest connectors; ties by edge order). [] when the goal can't be reached. */
export function islandPath(g: IslandGraph): number[] {
  const prev = new Map<number, number>([[g.start, g.start]]);
  const queue = [g.start];
  while (queue.length > 0) {
    const at = queue.shift() as number;
    if (at === g.goal) break;
    for (const i of g.adj.get(at) ?? []) {
      const next = other(g.edges[i] as Edge, at);
      if (prev.has(next)) continue;
      prev.set(next, at);
      queue.push(next);
    }
  }
  if (!prev.has(g.goal)) return [];
  const path = [g.goal];
  while (path[0] !== g.start) path.unshift(prev.get(path[0] as number) as number);
  return path;
}

const INF = 1_000_000;

/** Connectors joining the same two islands (parallel bridges) form one link: one lock closes them all. */
interface Link {
  a: number;
  b: number;
  edges: number[];
}

function linksOf(g: IslandGraph): { links: Link[]; byIsland: Map<number, number[]> } {
  const index = new Map<string, number>();
  const links: Link[] = [];
  g.edges.forEach((e, i) => {
    const key = e.a < e.b ? `${e.a}:${e.b}` : `${e.b}:${e.a}`;
    let k = index.get(key);
    if (k === undefined) {
      k = links.length;
      index.set(key, k);
      links.push({ a: e.a, b: e.b, edges: [] });
    }
    links[k]?.edges.push(i);
  });
  const byIsland = new Map<number, number[]>();
  links.forEach((l, k) => {
    byIsland.set(l.a, [...(byIsland.get(l.a) ?? []), k]);
    byIsland.set(l.b, [...(byIsland.get(l.b) ?? []), k]);
  });
  return { links, byIsland };
}

/**
 * The minimum cut between the islands `source` (merged into one super-source) and `sink`, counted in links (all
 * the connectors between two islands). A link can be cut only if every connector in it is `lockable`; the others
 * are uncuttable. Returns the cut (edge indices) and its source side (the source-closest minimum cut: everything
 * still reachable in the residual graph), or null when no finite cut exists (the sink is in `source`, or a path of
 * uncuttable links joins them).
 */
export function minCut(
  g: IslandGraph,
  source: ReadonlySet<number>,
  sink: number,
  lockable: (edge: Edge) => boolean,
): { edges: number[]; side: Set<number> } | null {
  if (source.has(sink)) return null;
  const { links, byIsland } = linksOf(g);
  // two opposite arcs per undirected link, arc 2k: a→b, arc 2k+1: b→a; pushing on one frees its twin
  const res = links.flatMap((l) => {
    const cap = l.edges.every((i) => lockable(g.edges[i] as Edge)) ? 1 : INF;
    return [cap, cap];
  });
  const head = (arc: number) => {
    const l = links[arc >> 1] as Link;
    return arc & 1 ? l.a : l.b;
  };
  const arcsFrom = (island: number) =>
    (byIsland.get(island) ?? []).map((k) => ((links[k] as Link).a === island ? 2 * k : 2 * k + 1));
  const search = (): Map<number, number> => {
    const via = new Map<number, number>(); // island → arc used to reach it (−1 for sources)
    for (const s of source) via.set(s, -1);
    const queue = [...source];
    while (queue.length > 0) {
      const at = queue.shift() as number;
      for (const arc of arcsFrom(at)) {
        if ((res[arc] as number) <= 0) continue;
        const next = head(arc);
        if (via.has(next)) continue;
        via.set(next, arc);
        if (next === sink) return via;
        queue.push(next);
      }
    }
    return via;
  };
  let flow = 0;
  for (;;) {
    const via = search();
    if (!via.has(sink)) {
      const side = new Set(via.keys());
      const edges = g.edges.flatMap((e, i) => (side.has(e.a) !== side.has(e.b) ? [i] : []));
      return { edges, side };
    }
    let bottleneck = INF;
    for (let at = sink; via.get(at) !== -1; ) {
      const arc = via.get(at) as number;
      bottleneck = Math.min(bottleneck, res[arc] as number);
      at = head(arc ^ 1);
    }
    if (bottleneck >= INF) return null; // an uncuttable way through
    for (let at = sink; via.get(at) !== -1; ) {
      const arc = via.get(at) as number;
      res[arc] = (res[arc] as number) - bottleneck;
      res[arc ^ 1] = (res[arc ^ 1] as number) + bottleneck;
      at = head(arc ^ 1);
    }
    flow += bottleneck;
    if (flow >= INF) return null;
  }
}

export interface ChainCut {
  /** Edge indices of the cut. */
  edges: number[];
  /** Its source side (nested: each contains the previous one and the far ends of the previous cut). */
  side: Set<number>;
}

/** The nested chokepoint cuts from the start towards the goal (§2 of the file comment). */
export function cutChain(g: IslandGraph, lockable: (edge: Edge) => boolean): ChainCut[] {
  const chain: ChainCut[] = [];
  let source = new Set<number>([g.start]);
  while (!source.has(g.goal) && chain.length < g.edges.length) {
    const cut = minCut(g, source, g.goal, lockable);
    if (!cut || cut.edges.length === 0) break;
    chain.push(cut);
    source = new Set(cut.side);
    for (const i of cut.edges) {
      const e = g.edges[i] as Edge;
      source.add(e.a);
      source.add(e.b);
    }
  }
  return chain;
}

// ── binding ───────────────────────────────────────────────────────────────────────────────────────────────

export type Fallback = 'no-cut' | 'no-room';

export interface BoundStep {
  /** Index into the level plan. */
  index: number;
  step: PlanStep;
  /** The lock the step really has on this stage (a `path` step without a cut becomes `goal`). */
  lock: StepLock;
  /** Why a `path` step became a goal lock. */
  fallback: Fallback | null;
  /** Where its gate (round) or post (mission) stands; null when the stage has no room left. */
  spot: GateSpot | null;
  /** 1-based gate number among round steps, or mission number among mission steps (0 when unplaced). */
  number: number;
  /** Connectors this step keeps shut (edge indices into the graph). */
  edges: number[];
  /** Runtime lock ids this step opens (its connectors). */
  lockIds: number[];
  /** The finish waits for this step. */
  goal: boolean;
}

export interface LockBinding {
  graph: IslandGraph;
  steps: BoundStep[];
  locks: LockSpec[];
  /** The goal lock's id (null when the finish never waits). */
  goalLockId: number | null;
  /** BFS start → goal island path. */
  path: number[];
  /** Chokepoints this stage offers for the level's connectors. */
  chain: number;
  coverage: { path: number; physical: number; fallback: number; unplaced: number };
}

const dist = (p: readonly number[], q: readonly number[]) =>
  Math.hypot((p[0] as number) - (q[0] as number), (p[1] as number) - (q[1] as number));

/**
 * Bind a level's plan to a stage. Pure and deterministic: the same stage and plan always give the same gates,
 * posts and locks. `spots` defaults to the Phase 20 gate spots of the stage.
 */
export function bindLevel(
  stage: StageData,
  plan: readonly PlanStep[],
  config: Pick<ResolvedLocks, 'mode' | 'connectors' | 'goal'>,
  spots: readonly GateSpot[] = gateSpots(stage),
): LockBinding {
  const g = islandGraph(stage);
  const path = islandPath(g);
  const connectors = new Set<ConnectorKind>(config.mode === 'path' ? config.connectors : []);
  const lockable = (e: Edge) => connectors.has(e.kind);
  const chain = path.length > 0 && connectors.size > 0 ? cutChain(g, lockable) : [];
  const K = chain.length;
  const segment = (island: number) => {
    const k = chain.findIndex((cut) => cut.side.has(island));
    return k < 0 ? K : k;
  };
  const usable = spots
    .filter((s) => g.adj.has(s.islandId))
    .map((s) => ({ spot: s, seg: segment(s.islandId) }))
    .sort((p, q) => p.seg - q.seg || p.spot.progress - q.spot.progress);

  const steps = plan.slice(0, MAX_STEP_SPOTS);
  const pathSteps = steps.filter((s) => s.lock === 'path').map((s) => s.index);
  const feasible = Array.from({ length: K }, (_, k) => k).filter((k) => usable.some((u) => u.seg === k));
  const m = Math.min(pathSteps.length, feasible.length);
  /** plan index → chain cut index, for the steps that get a physical lock. */
  const cutOf = new Map<number, number>();
  for (let t = 0; t < m; t++)
    cutOf.set(pathSteps[t] as number, feasible[Math.floor(((t + 0.5) * feasible.length) / m)] as number);

  // place gates and posts in plan order, each inside the window its neighbours' cuts leave it
  const placed: { spot: GateSpot; seg: number }[] = [];
  const spotOf = new Map<number, GateSpot>();
  const fallbackOf = new Map<number, Fallback>();
  const free = (s: GateSpot) => placed.every((p) => dist(p.spot.pos, s.pos) >= GATE_SPACING_PX);
  const key = (u: { spot: GateSpot; seg: number }) => [u.seg, u.spot.progress] as const;
  const after = (u: { spot: GateSpot; seg: number }, last: { spot: GateSpot; seg: number } | undefined) => {
    if (!last) return true;
    const [s1, p1] = key(u);
    const [s0, p0] = key(last);
    return s1 > s0 || (s1 === s0 && p1 > p0);
  };
  for (const [n, s] of steps.entries()) {
    const own = cutOf.get(s.index);
    const before = [...cutOf].filter(([i]) => i < s.index).map(([, k]) => k);
    const later = [...cutOf].filter(([i]) => i > s.index).map(([, k]) => k);
    const lo = before.length ? Math.max(...before) + 1 : 0;
    const hi = own ?? (later.length ? Math.min(...later) : K);
    // steps after this one sharing the same window: leave them room further along
    let sharing = 1;
    for (const next of steps.slice(n + 1)) {
      if (cutOf.has(next.index)) break;
      sharing++;
    }
    const pick = (list: { spot: GateSpot; seg: number }[]) => {
      if (list.length === 0) return undefined;
      const at = own !== undefined ? Math.floor(list.length / 2) : Math.floor(list.length / (sharing + 1));
      return list[Math.min(list.length - 1, at)];
    };
    const inWindow = usable.filter((u) => u.seg >= lo && u.seg <= hi && free(u.spot));
    const last = placed.at(-1);
    let chosen =
      (own !== undefined ? pick(inWindow.filter((u) => u.seg === own && after(u, last))) : undefined) ??
      pick(inWindow.filter((u) => after(u, last))) ??
      pick(inWindow);
    if (!chosen && own !== undefined) {
      // no room in front of its cut after all: the step keeps the finish shut instead
      cutOf.delete(s.index);
      fallbackOf.set(s.index, 'no-room');
    }
    chosen ??=
      pick(usable.filter((u) => u.seg >= lo && free(u.spot))) ?? pick(usable.filter((u) => free(u.spot)));
    if (!chosen) continue;
    placed.push(chosen);
    spotOf.set(s.index, chosen.spot);
  }

  // locks: each physical step's cut, then the finish
  const locks: LockSpec[] = [];
  let rounds = 0;
  let missions = 0;
  const bound: BoundStep[] = plan.map((s) => {
    const spot = spotOf.get(s.index) ?? null;
    const k = cutOf.get(s.index);
    const isPath = s.lock === 'path';
    const fallback: Fallback | null =
      isPath && k === undefined && spot ? (fallbackOf.get(s.index) ?? 'no-cut') : null;
    const lock: StepLock = !spot ? 'none' : fallback ? 'goal' : s.lock;
    const edges = k === undefined ? [] : (chain[k] as ChainCut).edges;
    const lockIds = edges.map((i) => {
      const e = g.edges[i] as Edge;
      const side = (chain[k as number] as ChainCut).side;
      const id = locks.length;
      locks.push({ id, kind: e.kind, targetId: e.id, islandId: side.has(e.a) ? e.a : e.b });
      return id;
    });
    const number = !spot ? 0 : s.kind === 'round' ? ++rounds : ++missions;
    const goal = lock === 'goal' || (lock === 'path' && config.goal) || fallback !== null;
    return { index: s.index, step: s, lock, fallback, spot, number, edges, lockIds, goal };
  });
  let goalLockId: number | null = null;
  if (bound.some((b) => b.goal)) {
    goalLockId = locks.length;
    locks.push({ id: goalLockId, kind: 'goal', targetId: 0, islandId: stage.goal.islandId });
  }
  const pathCount = plan.filter((s) => s.lock === 'path').length;
  return {
    graph: g,
    steps: bound,
    locks,
    goalLockId,
    path,
    chain: K,
    coverage: {
      path: pathCount,
      physical: bound.filter((b) => b.lockIds.length > 0).length,
      fallback: bound.filter((b) => b.fallback !== null).length,
      unplaced: bound.filter((b) => !b.spot).length,
    },
  };
}

/** Islands the ball may be on while the locks in `closed` are shut (the region guard's allowed set). */
export function allowedIslands(binding: LockBinding, closed: ReadonlySet<number>): Set<number> {
  const shut = new Set<number>();
  for (const b of binding.steps)
    b.edges.forEach((edge, i) => {
      if (closed.has(b.lockIds[i] as number)) shut.add(edge);
    });
  return reachable(binding.graph, (_, i) => shut.has(i));
}

/** Violations of the binding invariants (a)–(d) of the file comment; empty when the binding is sound. */
export function checkBinding(binding: LockBinding): string[] {
  const { graph: g, steps } = binding;
  const issues: string[] = [];
  const physical = steps.filter((b) => b.edges.length > 0);
  const edgeSets = physical.map((b) => new Set(b.edges));
  physical.forEach((b, j) => {
    const later = new Set(edgeSets.slice(j).flatMap((s) => [...s]));
    const host = b.spot?.islandId;
    if (host === undefined) issues.push(`step ${b.index}: a lock without a gate`);
    else if (!reachable(g, (_, i) => later.has(i)).has(host))
      issues.push(`(a) step ${b.index}: its gate is behind its own or a later lock`);
    const own = edgeSets[j] as Set<number>;
    if (reachable(g, (_, i) => own.has(i)).has(g.goal))
      issues.push(`(b) step ${b.index}: the goal is reachable around its lock`);
  });
  if (reachable(g).size !== g.islands.length) issues.push('(c) not every island is reachable');
  for (let a = 0; a < physical.length; a++)
    for (let c = a + 1; c < physical.length; c++)
      if ([...(edgeSets[a] as Set<number>)].some((i) => (edgeSets[c] as Set<number>).has(i)))
        issues.push(`steps ${physical[a]?.index} and ${physical[c]?.index} share a connector`);
  // (d) liveness: keep doing any placed step whose gate the ball can reach
  const pending = new Set(steps.filter((b) => b.spot).map((b) => b.index));
  for (let progress = true; progress && pending.size > 0; ) {
    progress = false;
    const shut = new Set(steps.filter((b) => pending.has(b.index)).flatMap((b) => b.edges));
    const open = reachable(g, (_, i) => shut.has(i));
    for (const b of steps)
      if (pending.has(b.index) && b.spot && open.has(b.spot.islandId)) {
        pending.delete(b.index);
        progress = true;
      }
  }
  if (pending.size > 0) issues.push(`(d) steps ${[...pending].join(', ')} can never be reached`);
  return issues;
}
