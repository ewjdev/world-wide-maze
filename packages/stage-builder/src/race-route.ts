import { BALL_RADIUS_PX, PX_PER_METER, type Vec2 } from '@wwm/schema';
import type { Candidate, IslandShape } from './bridges.ts';
import { analyzeWalkable, onMain } from './walkable.ts';

export const RACE_ROUTE_WEIGHTS = { distance: 1, turn: 8, reversal: 80, narrow: 100 } as const;
export interface RaceRouteSearch {
  order: number[];
  score: number;
  examined: number;
  rejectedInteriorApproaches: number;
  budgetExhausted: boolean;
}

export class RaceRouteError extends Error {
  readonly code = 'RACE_ROUTE_NOT_FOUND';
  readonly diagnostics: Omit<RaceRouteSearch, 'order' | 'score'>;
  constructor(diagnostics: Omit<RaceRouteSearch, 'order' | 'score'>) {
    super(
      `No continuous Race route through all islands within ${diagnostics.examined} searched states; adjust HTML or author route hints`,
    );
    this.name = 'RaceRouteError';
    this.diagnostics = diagnostics;
  }
}

/** Bounded heading-aware route search. It requires all curated islands and fails rather than substitutes DFS. */
export function searchRaceRoute(options: {
  shapes: readonly IslandShape[];
  centers: readonly Vec2[];
  candidates: readonly Candidate[];
  width: number;
  height: number;
  start: number;
  finish: number;
  maxStates?: number;
}): RaceRouteSearch {
  const { shapes, centers, candidates, width, height, start, finish } = options;
  const maxStates = options.maxStates ?? 4096;
  if (
    !Number.isInteger(maxStates) ||
    maxStates < 1 ||
    maxStates > 100_000 ||
    shapes.length < 2 ||
    shapes.length > 16 ||
    start === finish ||
    !shapes[start] ||
    !shapes[finish]
  )
    throw new Error('Invalid bounded Race route search settings');
  const walk = analyzeWalkable(shapes, width, height, 1.5, BALL_RADIUS_PX + 1);
  let rejectedInteriorApproaches = 0;
  const approaches = candidates.map((c) => {
    let valid = true;
    for (const [island, end] of [
      [c.from, c.a],
      [c.to, c.b],
    ] as const) {
      const center = centers[island];
      const len = Math.hypot(end[0] - center[0], end[1] - center[1]);
      for (let d = 0; d < Math.max(0, len - 16); d += 3) {
        if (
          !onMain(walk, island + 1, [
            center[0] + ((end[0] - center[0]) * d) / len,
            center[1] + ((end[1] - center[1]) * d) / len,
          ])
        )
          valid = false;
      }
    }
    if (!valid) rejectedInteriorApproaches++;
    return valid;
  });
  let examined = 0;
  let budgetExhausted = false;
  let best: { order: number[]; score: number } | null = null;
  function visit(order: number[], incoming: Vec2 | null, score: number) {
    if (examined >= maxStates) {
      budgetExhausted = true;
      return;
    }
    examined++;
    const current = order[order.length - 1];
    if (current === finish) {
      if (order.length === shapes.length && (!best || score < best.score))
        best = { order: [...order], score };
      return;
    }
    if (best && score >= best.score) return;
    const edges = candidates
      .flatMap((c, index) => {
        if (!approaches[index] || (c.from !== current && c.to !== current)) return [];
        const next = c.from === current ? c.to : c.from;
        if (order.includes(next) || (next === finish && order.length !== shapes.length - 1)) return [];
        const a = c.from === current ? c.a : c.b;
        const b = c.from === current ? c.b : c.a;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const direction: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
        const cosine = incoming ? incoming[0] * direction[0] + incoming[1] * direction[1] : 1;
        const turn = Math.acos(Math.max(-1, Math.min(1, cosine)));
        // Both half-island approaches are real checked paths. Later collision validation still owns seams/rails.
        const distance =
          Math.hypot(a[0] - centers[current][0], a[1] - centers[current][1]) +
          length +
          Math.hypot(b[0] - centers[next][0], b[1] - centers[next][1]);
        const cost =
          (distance / PX_PER_METER) * RACE_ROUTE_WEIGHTS.distance +
          turn * turn * RACE_ROUTE_WEIGHTS.turn +
          (cosine < -0.9 ? RACE_ROUTE_WEIGHTS.reversal : 0) +
          RACE_ROUTE_WEIGHTS.narrow / c.width;
        return [{ next, direction, cost }];
      })
      .sort((a, b) => a.cost - b.cost || a.next - b.next);
    for (const edge of edges) visit([...order, edge.next], edge.direction, score + edge.cost);
  }
  visit([start], null, 0);
  if (!best) throw new RaceRouteError({ examined, rejectedInteriorApproaches, budgetExhausted });
  const chosen = best as { order: number[]; score: number };
  return { ...chosen, examined, rejectedInteriorApproaches, budgetExhausted };
}
