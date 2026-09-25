/** Unit tests for the vector steps: contours, bridges, maze, levels, placement, rails, ids. */
import {
  BALL_RADIUS_PX,
  createRng,
  distanceToPolygonEdge,
  isCCW,
  MAX_RAMP_SLOPE,
  rampSlope,
  ringSelfIntersects,
  sha256Hex,
  signedArea,
  type Vec2,
} from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { type Candidate, findCandidates, type IslandShape } from '../src/bridges.ts';
import {
  bevelRing,
  outlineIsland,
  removeDiagonalPinches,
  simplifyRing,
  traceRings,
} from '../src/contours.ts';
import { distanceTransform } from '../src/distance.ts';
import { componentInfo, labelComponents } from '../src/islands.ts';
import { assignLevels, maxRampRise } from '../src/levels.ts';
import { candidateComponents, carveMaze } from '../src/maze.ts';
import { D, DEFAULT_PARAMS } from '../src/params.ts';
import { findSafeSpot, ringPoints } from '../src/placement.ts';
import { cutRing, ringLength } from '../src/rails.ts';
import { sha256HexSync } from '../src/sha256.ts';
import { maskFrom } from './helpers.ts';

/** Paint axis-aligned cell rects into a mask. */
function rectsMask(cols: number, rows: number, rects: [number, number, number, number][]): Uint8Array {
  const m = new Uint8Array(cols * rows);
  for (const [c0, r0, w, h] of rects)
    for (let r = r0; r < r0 + h; r++) m.fill(1, r * cols + c0, r * cols + c0 + w);
  return m;
}

function shapesFor(
  labels: Int32Array,
  count: number,
  cols: number,
  rows: number,
  cell: number,
): IslandShape[] {
  return componentInfo(labels, count, cols).map((f) => {
    const o = outlineIsland(labels, cols, rows, f.label, f, cell, cols * cell, rows * cell, 1, 0);
    return {
      contour: o?.contour ?? [],
      holes: o?.holes ?? [],
      bbox: { x0: f.c0 * cell, y0: f.r0 * cell, x1: f.c1 * cell, y1: f.r1 * cell },
    };
  });
}

describe('contours', () => {
  test('a rectangle traces to 4 vertices with positive (contract CCW) area', () => {
    const { mask, cols, rows } = maskFrom(['.....', '.###.', '.###.', '.....']);
    const { labels } = labelComponents(mask, cols, rows);
    const rings = traceRings(labels, cols, rows, 1, { c0: 0, r0: 0, c1: cols, r1: rows });
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(isCCW(rings[0] as Vec2[])).toBe(true);
    expect(signedArea(rings[0] as Vec2[])).toBe(6);
  });
  test('holes come out with negative area and inside the contour', () => {
    const { mask, cols, rows } = maskFrom(['#####', '#...#', '#...#', '#####']);
    const { labels } = labelComponents(mask, cols, rows);
    const o = outlineIsland(labels, cols, rows, 1, { c0: 0, r0: 0, c1: cols, r1: rows }, 10, 50, 40, 1, 2);
    expect(o?.holes).toHaveLength(1);
    expect(signedArea((o?.holes[0] ?? []) as Vec2[])).toBeLessThan(0);
    expect(isCCW(o?.contour ?? [])).toBe(true);
  });
  test('diagonal pinches are removed so rings stay simple', () => {
    const { mask, cols, rows } = maskFrom(['##..', '##..', '..##', '..##']);
    expect(removeDiagonalPinches(mask, cols, rows)).toBeGreaterThan(0);
    // 03b: two islands touching at a corner are separated (not fused through a one-cell neck)
    const { labels, count } = labelComponents(mask, cols, rows);
    expect(count).toBe(2);
    for (const label of [1, 2]) {
      const rings = traceRings(labels, cols, rows, label, { c0: 0, r0: 0, c1: cols, r1: rows });
      expect(rings).toHaveLength(1);
      expect(ringSelfIntersects(rings[0] as Vec2[])).toBe(false);
    }
  });
  test('simplify keeps corners, bevel cuts them', () => {
    const sq: Vec2[] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(simplifyRing(sq, 0.5)).toHaveLength(4);
    const b = bevelRing(simplifyRing(sq, 0.5), 2);
    expect(b).toHaveLength(8);
    expect(isCCW(b)).toBe(true);
    expect(ringSelfIntersects(b)).toBe(false);
  });
});

describe('bridges (cardinal candidates)', () => {
  test('two rectangles give 2 islands and 1 horizontal bridge', () => {
    const cols = 60;
    const rows = 30;
    const cell = 3;
    const mask = rectsMask(cols, rows, [
      [2, 5, 20, 20],
      [30, 5, 20, 20],
    ]);
    const { labels, count } = labelComponents(mask, cols, rows);
    expect(count).toBe(2);
    const shapes = shapesFor(labels, count, cols, rows, cell);
    const c = findCandidates(labels, shapes, { cols, rows, cell, width: 180, height: 90 }, DEFAULT_PARAMS);
    expect(c).toHaveLength(1);
    const b = c[0] as Candidate;
    expect(b.axis).toBe('x');
    expect(b.a[1]).toBe(b.b[1]); // cardinal
    expect(b.gap).toBe(8 * cell);
    expect(b.width).toBeGreaterThanOrEqual(DEFAULT_PARAMS.bridgeWidthMinPx);
    expect(b.width).toBeLessThanOrEqual(DEFAULT_PARAMS.bridgeWidthMaxPx);
  });
  test('a third island in the way blocks the bridge; the vertical neighbor still connects', () => {
    const cols = 60;
    const rows = 60;
    const cell = 3;
    const mask = rectsMask(cols, rows, [
      [2, 5, 18, 18],
      [40, 5, 18, 18],
      [24, 0, 12, 40], // wall between them
      [2, 35, 18, 18],
    ]);
    const { labels, count } = labelComponents(mask, cols, rows);
    const shapes = shapesFor(labels, count, cols, rows, cell);
    const c = findCandidates(labels, shapes, { cols, rows, cell, width: 180, height: 180 }, DEFAULT_PARAMS);
    const pairs = c.map((x) => `${x.from}-${x.to}-${x.axis}`);
    // islands in raster order of their first cell: 0 = wall, 1 = left top, 2 = right top, 3 = left bottom
    expect(pairs).not.toContain('1-2-x');
    expect(pairs).toContain('1-3-y');
    expect(pairs).toContain('1-0-x');
  });
});

describe('maze', () => {
  const grid = (n: number) => {
    // n×n lattice of islands, 4-neighbor candidates
    const cands: Candidate[] = [];
    const id = (x: number, y: number) => y * n + x;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (x + 1 < n)
          cands.push({
            from: id(x, y),
            to: id(x + 1, y),
            a: [x * 100 + 80, y * 100 + 40],
            b: [x * 100 + 100, y * 100 + 40],
            width: 36,
            axis: 'x',
            gap: 20,
          });
        if (y + 1 < n)
          cands.push({
            from: id(x, y),
            to: id(x, y + 1),
            a: [x * 100 + 40, y * 100 + 80],
            b: [x * 100 + 40, y * 100 + 100],
            width: 36,
            axis: 'y',
            gap: 20,
          });
      }
    return cands;
  };
  test('randomized DFS carves a spanning tree (islands = bridges + 1) deterministically', () => {
    const c = grid(5);
    const m1 = carveMaze(25, c, 0, createRng(7), 0);
    const m2 = carveMaze(25, c, 0, createRng(7), 0);
    const m3 = carveMaze(25, c, 0, createRng(8), 0);
    expect(m1.tree).toHaveLength(24);
    expect(m1.reached.every(Boolean)).toBe(true);
    expect(m1.tree).toEqual(m2.tree);
    expect(m1.tree).not.toEqual(m3.tree);
    expect(candidateComponents(25, c).every((x) => x === 0)).toBe(true);
  });
  test('loop share adds back unused edges', () => {
    const c = grid(5);
    const m = carveMaze(25, c, 0, createRng(1), 0.5);
    expect(m.loops.length).toBe(Math.round((c.length - 24) * 0.5));
  });
});

describe('levels', () => {
  test('every carved bridge is a legal ramp; elevators use 2013 rises on short gaps', () => {
    const n = 12;
    const cands: Candidate[] = [];
    for (let i = 0; i + 1 < n; i++) {
      const span = i % 3 === 0 ? 9 : 40 + i * 30; // short gaps allow elevators
      cands.push({
        from: i,
        to: i + 1,
        a: [0, i * 100],
        b: [0, i * 100 + span],
        width: 36,
        axis: 'y',
        gap: span,
      });
    }
    const parentEdge = [-1, ...cands.map((_, i) => i)];
    for (let seed = 1; seed <= 20; seed++) {
      const r = assignLevels(
        {
          n,
          root: 0,
          candidates: cands,
          tree: cands.map((_, i) => i),
          loops: [],
          parentEdge,
          anchor: cands.map((c) => c.a).concat([[0, 1200]]),
          roleBump: new Array(n).fill(0),
          stageHeight: 1200,
        },
        createRng(seed),
        DEFAULT_PARAMS,
      );
      cands.forEach((c, e) => {
        const la = r.levels[c.from] as number;
        const lb = r.levels[c.to] as number;
        expect(la).toBeGreaterThanOrEqual(DEFAULT_PARAMS.levelMin);
        expect(lb).toBeLessThanOrEqual(DEFAULT_PARAMS.levelMax);
        if (r.kinds.get(e) === 'elevator') {
          expect(Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1])).toBeLessThanOrEqual(
            DEFAULT_PARAMS.elevatorMaxSpanPx,
          );
          expect(DEFAULT_PARAMS.elevatorRisesD.some((d) => Math.abs(Math.abs(lb - la) - d) < 0.011)).toBe(
            true,
          );
        } else expect(rampSlope(c.a, c.b, la, lb)).toBeLessThanOrEqual(MAX_RAMP_SLOPE);
      });
    }
  });
  test('maxRampRise', () => {
    expect(maxRampRise(10 * D, 0.17)).toBeCloseTo(1.7, 5);
  });
});

describe('placement', () => {
  const cols = 40;
  const rows = 20;
  const cell = 3;
  const mask = rectsMask(cols, rows, [[2, 2, 36, 16]]); // 108 × 48 px island
  const { labels, count } = labelComponents(mask, cols, rows);
  const dist = distanceTransform(mask, cols, rows);
  const shape = shapesFor(labels, count, cols, rows, cell)[0] as IslandShape;
  const info = componentInfo(labels, count, cols)[0];
  const isl = {
    label: 1,
    c0: info?.c0 ?? 0,
    r0: info?.r0 ?? 0,
    c1: info?.c1 ?? 0,
    r1: info?.r1 ?? 0,
    areaCells: info?.area ?? 0,
  };
  const raster = { labels, dist, cols, rows, cell };
  test('safe spot is the centered distance-transform maximum', () => {
    const s = findSafeSpot(raster, isl, shape);
    expect(s.pos[0]).toBeCloseTo(60, -1);
    expect(s.pos[1]).toBeCloseTo(30, -1);
    expect(s.clearance).toBeGreaterThan(20);
  });
  test('ring points keep their inset and spacing', () => {
    const pts = ringPoints(
      raster,
      isl,
      shape,
      {
        ringsPx: [0.9 * D],
        spacingPx: 1.5 * D,
        jitterPx: 0,
        minClearance: BALL_RADIUS_PX,
        keepOutPx: 0,
        avoid: [],
      },
      createRng(1),
    );
    expect(pts.length).toBeGreaterThanOrEqual(8); // ≈ 216 px of ring at 20 px spacing
    for (const p of pts) {
      const d = distanceToPolygonEdge(p, shape.contour, shape.holes);
      expect(d).toBeGreaterThanOrEqual(BALL_RADIUS_PX);
      expect(Math.abs(d - 0.9 * D)).toBeLessThanOrEqual(cell);
    }
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i] as Vec2;
        const b = pts[j] as Vec2;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(1.5 * D * Math.sqrt(0.9) - 1e-9);
      }
  });
});

describe('rails', () => {
  const sq: Vec2[] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  test('uncut ring → one closed polyline', () => {
    const r = cutRing(sq, []);
    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(5);
  });
  test('a mouth box opens a gap; vertices stay on the outline', () => {
    const r = cutRing(sq, [{ x0: 80, y0: 40, x1: 130, y1: 60 }]);
    expect(r).toHaveLength(1);
    const line = r[0] as Vec2[];
    expect(line[0]).toEqual([100, 60]);
    expect(line[line.length - 1]).toEqual([100, 40]);
    const len = line
      .slice(1)
      .reduce((s, p, i) => s + Math.hypot(p[0] - (line[i] as Vec2)[0], p[1] - (line[i] as Vec2)[1]), 0);
    expect(len / ringLength(sq)).toBeCloseTo(0.95, 5);
  });
  test('two mouths → two rails', () => {
    const r = cutRing(sq, [
      { x0: 80, y0: 40, x1: 130, y1: 60 },
      { x0: -30, y0: 40, x1: 20, y1: 60 },
    ]);
    expect(r).toHaveLength(2);
  });
});

describe('ids', () => {
  test('sync sha256 equals @wwm/schema sha256Hex', async () => {
    for (const s of ['', 'abc', 'x'.repeat(200), 'captureId|0|1|0.3.0|normal', 'ünïcødé ✓']) {
      expect(sha256HexSync(s)).toBe(await sha256Hex(s));
    }
  });
});
