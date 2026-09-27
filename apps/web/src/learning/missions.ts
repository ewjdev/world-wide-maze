/**
 * Phase 22 M3 (N): missions use the maze's own gems and islands as maths (plan §3 "Missions (v1)"). Pure helpers:
 *
 * - `collect { count }`: gems picked up after the post is reached count. If fewer gems are left on the islands the
 *   ball can reach than the mission asks for, the count is lowered to what is there (and recorded).
 * - `reach { island }`: `most-gems` / `fewest-gems` are resolved when the mission starts, against the gems still on
 *   each reachable island (the post's own island excluded). A tie falls back to a letter target. Islands get
 *   letters A–J in the order the ball meets them (BFS from the start, then by id).
 */
import { MISSION_LETTERS, type ReachTarget } from '@wwm/learning';
import type { StageData } from '@wwm/schema';
import { type IslandGraph, islandGraph } from './locks.ts';

/** Remaining items per island, for the islands in `islands`. */
export function gemsByIsland(
  stage: StageData,
  collected: ReadonlySet<number>,
  islands: ReadonlySet<number>,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const island of [...islands].sort((p, q) => p - q)) counts.set(island, 0);
  for (const item of stage.items)
    if (!collected.has(item.id) && counts.has(item.islandId))
      counts.set(item.islandId, (counts.get(item.islandId) ?? 0) + 1);
  return counts;
}

export function collectCount(asked: number, available: number): { count: number; lowered: boolean } {
  const count = Math.max(0, Math.min(asked, available));
  return { count, lowered: count < asked };
}

/** Letters A–J for the reachable islands, in BFS order from the start (neighbours by island id). */
export function islandLetters(stageOrGraph: StageData | IslandGraph): Map<number, string> {
  const g = 'adj' in stageOrGraph ? stageOrGraph : islandGraph(stageOrGraph);
  const order: number[] = [g.start];
  const seen = new Set(order);
  for (let i = 0; i < order.length; i++) {
    const at = order[i] as number;
    const next = (g.adj.get(at) ?? [])
      .map((e) => {
        const edge = g.edges[e];
        return edge ? (edge.a === at ? edge.b : edge.a) : at;
      })
      .filter((n) => !seen.has(n))
      .sort((p, q) => p - q);
    for (const n of next)
      if (!seen.has(n)) {
        seen.add(n);
        order.push(n);
      }
  }
  return new Map(
    order.slice(0, MISSION_LETTERS.length).map((island, i) => [island, MISSION_LETTERS[i] as string]),
  );
}

export interface ReachGoal {
  islandId: number;
  letter: string | null;
  /** How Pip names it: by most / fewest gems, or by its letter (a letter target or a tie). */
  by: 'most-gems' | 'fewest-gems' | 'letter';
  /** A most/fewest target that fell back to a letter because islands tied. */
  tie: boolean;
}

/**
 * Resolve a reach target now. `counts` are the remaining gems per candidate island (the post's island already
 * excluded). Null when there's no candidate (the mission is then done at once and recorded).
 */
export function resolveReach(
  target: ReachTarget,
  counts: ReadonlyMap<number, number>,
  letters: ReadonlyMap<number, string>,
): ReachGoal | null {
  const candidates = [...counts.keys()].sort((p, q) => p - q);
  if (typeof target === 'object') {
    const hit = [...letters].find(([, letter]) => letter === target.letter);
    if (hit && counts.has(hit[0])) return { islandId: hit[0], letter: hit[1], by: 'letter', tie: false };
    // that letter isn't reachable from here: the lettered candidate furthest along instead
    const lettered = candidates.filter((c) => letters.has(c));
    const last = lettered.at(-1);
    return last === undefined
      ? null
      : { islandId: last, letter: letters.get(last) ?? null, by: 'letter', tie: false };
  }
  if (candidates.length === 0) return null;
  const values = candidates.map((c) => counts.get(c) ?? 0);
  const best = target === 'most-gems' ? Math.max(...values) : Math.min(...values);
  const tied = candidates.filter((c) => (counts.get(c) ?? 0) === best);
  if (tied.length === 1) {
    const id = tied[0] as number;
    return { islandId: id, letter: letters.get(id) ?? null, by: target, tie: false };
  }
  const named = tied.filter((c) => letters.has(c));
  const id = (named[0] ?? tied[0]) as number;
  return { islandId: id, letter: letters.get(id) ?? null, by: 'letter', tie: true };
}
