import type { Vec2 } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import type { Candidate, IslandShape } from '../src/bridges.ts';
import { RaceRouteError, searchRaceRoute } from '../src/race-route.ts';

function grid() {
  const centers: Vec2[] = [];
  const shapes: IslandShape[] = [];
  const candidates: Candidate[] = [];
  for (let i = 0; i < 12; i++) {
    const x = 30 + (i % 4) * 150;
    const y = 30 + Math.floor(i / 4) * 150;
    centers.push([x + 50, y + 50]);
    shapes.push({
      contour: [
        [x, y],
        [x + 100, y],
        [x + 100, y + 100],
        [x, y + 100],
      ],
      holes: [],
      bbox: { x0: x, y0: y, x1: x + 100, y1: y + 100 },
    });
  }
  for (let i = 0; i < 12; i++) {
    for (const j of [i + 1, i + 4]) {
      if (j >= 12 || (j === i + 1 && i % 4 === 3)) continue;
      const horizontal = j === i + 1;
      const a: Vec2 = [centers[i][0] + (horizontal ? 47 : 0), centers[i][1] + (horizontal ? 0 : 47)];
      const b: Vec2 = [centers[j][0] - (horizontal ? 47 : 0), centers[j][1] - (horizontal ? 0 : 47)];
      candidates.push({ from: i, to: j, a, b, axis: horizontal ? 'x' : 'y', gap: 50, width: 54 });
    }
  }
  return { shapes, centers, candidates, width: 600, height: 450, start: 0, finish: 11 };
}

describe('heading-aware bounded Race route search', () => {
  test('chooses a smoother four-turn route over a valid seven-turn route of equal travel distance', () => {
    const options = grid();
    const smooth = searchRaceRoute(options);
    expect(smooth.order).toEqual([0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11]);
    const jaggedOrder = [0, 1, 5, 4, 8, 9, 10, 6, 2, 3, 7, 11];
    const jagged = searchRaceRoute({
      ...options,
      candidates: options.candidates.filter((c) =>
        jaggedOrder.some(
          (id, i) =>
            (id === c.from && jaggedOrder[i + 1] === c.to) || (id === c.to && jaggedOrder[i + 1] === c.from),
        ),
      ),
    });
    expect(jagged.order).toEqual(jaggedOrder);
    expect(smooth.score).toBeLessThan(jagged.score);
    expect(searchRaceRoute({ ...options, candidates: [...options.candidates].reverse() })).toEqual(smooth);
  });
  test('bounds exploration and returns structured failure diagnostics without fallback', () => {
    try {
      searchRaceRoute({ ...grid(), maxStates: 1 });
      throw new Error('Expected bounded failure');
    } catch (error) {
      expect(error).toBeInstanceOf(RaceRouteError);
      expect((error as RaceRouteError).diagnostics).toEqual({
        examined: 1,
        rejectedInteriorApproaches: 0,
        budgetExhausted: true,
      });
    }
    expect(() => searchRaceRoute({ ...grid(), candidates: [] })).toThrow('No continuous Race route');
  });
  test('rejects a connector whose center approach crosses a hole', () => {
    const options = grid();
    options.shapes[0].holes = [
      [
        [90, 40],
        [90, 120],
        [115, 120],
        [115, 40],
      ],
    ];
    const result = searchRaceRoute(options);
    expect(result.rejectedInteriorApproaches).toBeGreaterThan(0);
    expect(result.order[1]).toBe(4);
  });
});
