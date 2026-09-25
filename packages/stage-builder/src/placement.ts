/**
 * Step 10: safe spots, start, goal, items and restart points (E: 2013 case study + WWMMM statistics).
 * - Safe spot = the island's distance-transform maximum (the point farthest from its edges).
 * - Start = the safe spot nearest the top-left; goal = the safe spot nearest the bottom-right (E).
 * - Large items (≤ MAX_LARGE_ITEMS) at the roomiest remaining safe spots, dead-end islands first (N tie-break).
 * - Small items on inset rings 0.9 D / 2.3 D from the edge, 1.5 D apart, seeded jitter (E), on a seeded share
 *   of the islands (E: 22 of 38 islands carried items).
 * - Restart points on inset rings 0.6 D / 1.3 D (E 0.56 / 1.3 D; the inner ring is lifted slightly so every point
 *   clears the contract's BALL_RADIUS_PX).
 * Every point is verified against the final polygon (contour + holes) with the contract's own distance helpers.
 */
import {
  BALL_RADIUS_PX,
  distanceToPolygonEdge,
  ITEM_EDGE_CLEARANCE_PX,
  pointInPolygon,
  type Rng,
  type Vec2,
} from '@wwm/schema';
import type { IslandShape } from './bridges.ts';

export interface RasterIsland {
  label: number; // 1-based label in `labels`
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  areaCells: number;
}

export interface Raster {
  labels: Int32Array;
  dist: Float32Array;
  cols: number;
  rows: number;
  cell: number;
}

export interface SafeSpot {
  pos: Vec2;
  /** Exact distance to the polygon edge, px. */
  clearance: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function cellCenter(raster: Raster, i: number): Vec2 {
  const c = i % raster.cols;
  const r = (i - c) / raster.cols;
  return [round2((c + 0.5) * raster.cell), round2((r + 0.5) * raster.cell)];
}

/**
 * Distance-transform maximum per island, verified against the polygon. `allowed` (03b) restricts the search
 * to some cells (the island's main walkable part), falling back to the whole island if none qualifies.
 */
export function findSafeSpot(
  raster: Raster,
  isl: RasterIsland,
  shape: IslandShape,
  allowed?: (cell: number) => boolean,
): SafeSpot {
  const { labels, dist, cols } = raster;
  let cells: number[] = [];
  for (let r = isl.r0; r < isl.r1; r++)
    for (let c = isl.c0; c < isl.c1; c++) if (labels[r * cols + c] === isl.label) cells.push(r * cols + c);
  if (allowed) {
    const ok = cells.filter(allowed);
    if (ok.length > 0) cells = ok;
  }
  // Near-maximal cells form a ridge (a strip's centerline, a square's middle): prefer the one closest to the
  // ridge's centroid so spots sit in the middle of the island, not at the first cell in raster order.
  let top = 0;
  for (const i of cells) top = Math.max(top, dist[i] as number);
  let sx = 0;
  let sy = 0;
  let k0 = 0;
  for (const i of cells) {
    if ((dist[i] as number) < top - 0.35) continue;
    sx += i % cols;
    sy += Math.floor(i / cols);
    k0++;
  }
  const cx = sx / Math.max(1, k0);
  const cy = sy / Math.max(1, k0);
  const d2c = (i: number) => ((i % cols) - cx) ** 2 + (Math.floor(i / cols) - cy) ** 2;
  const band = (i: number) => Math.floor((top - (dist[i] as number)) / 0.35 + 1e-9);
  // ridge band first, then closeness to the ridge centroid; ties → raster order (deterministic)
  cells.sort((p, q) => band(p) - band(q) || d2c(p) - d2c(q) || p - q);
  let best: SafeSpot | null = null;
  for (let k = 0; k < Math.min(cells.length, 64); k++) {
    const pos = cellCenter(raster, cells[k] as number);
    if (!pointInPolygon(pos, shape.contour, shape.holes)) continue;
    const clearance = distanceToPolygonEdge(pos, shape.contour, shape.holes);
    if (!best || clearance > best.clearance + 0.5) best = { pos, clearance };
    if (k >= 8 && best) break;
  }
  if (best) return best;
  const pos = cellCenter(raster, cells[0] as number);
  return { pos, clearance: 0 };
}

export interface RingOptions {
  ringsPx: readonly number[];
  spacingPx: number;
  jitterPx: number;
  /** Minimum exact clearance from the polygon edge. */
  minClearance: number;
  /** Points closer than this to any of `avoid` are rejected. */
  keepOutPx: number;
  avoid: readonly Vec2[];
  /** Extra acceptance test (03b: reachable from the island's main walkable part). */
  accept?: (p: Vec2) => boolean;
}

/** Points on inset rings of one island, greedy in raster order with a minimum spacing. */
export function ringPoints(
  raster: Raster,
  isl: RasterIsland,
  shape: IslandShape,
  opts: RingOptions,
  rng: Rng,
): Vec2[] {
  const { labels, dist, cols, cell } = raster;
  const out: Vec2[] = [];
  const minSp2 = opts.spacingPx * opts.spacingPx * 0.9;
  const keep2 = opts.keepOutPx * opts.keepOutPx;
  const far = (p: Vec2, list: readonly Vec2[], d2: number) =>
    list.every((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 >= d2);
  for (const ring of opts.ringsPx) {
    for (let r = isl.r0; r < isl.r1; r++) {
      for (let c = isl.c0; c < isl.c1; c++) {
        const i = r * cols + c;
        if (labels[i] !== isl.label) continue;
        const edge = ((dist[i] as number) - 0.5) * cell;
        if (Math.abs(edge - ring) > cell / 2) continue;
        const base: Vec2 = [(c + 0.5) * cell, (r + 0.5) * cell];
        const jx = rng.range(-opts.jitterPx, opts.jitterPx);
        const jy = rng.range(-opts.jitterPx, opts.jitterPx);
        for (const p of [[base[0] + jx, base[1] + jy] as Vec2, base]) {
          const q: Vec2 = [round2(p[0]), round2(p[1])];
          if (!far(q, out, minSp2) || !far(q, opts.avoid, keep2)) continue;
          if (!pointInPolygon(q, shape.contour, shape.holes)) continue;
          if (distanceToPolygonEdge(q, shape.contour, shape.holes) < opts.minClearance) continue;
          if (opts.accept && !opts.accept(q)) continue;
          out.push(q);
          break;
        }
      }
    }
  }
  return out;
}

export const ITEM_MIN_CLEARANCE = ITEM_EDGE_CLEARANCE_PX + 0.5;
export const RESTART_MIN_CLEARANCE = BALL_RADIUS_PX + 0.25;
