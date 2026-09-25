/**
 * Ball-walkable area (Phase 03b, builder issue BI-1).
 *
 * An island can be wide enough somewhere (it holds a 2 D disc) and still be split for the ball by a neck
 * narrower than the ball (1 D = 13.5 px). The physics puts rails just outside the island edge, so the ball
 * centre can go anywhere at least a ball radius from the edge: the **walkable set** is the island eroded by the
 * ball radius (plus a small margin for the 3 px grid and the smoothed outline). Its connected components are
 * the parts of an island the ball can actually roll between.
 *
 * Two uses (N: new; 2013 islands were hand-checked by nobody, and its necks were cut by the blur/threshold):
 *  - `splitAtNecks` cuts a land mask at necks between two parts that are each big enough to be an island of
 *    their own, so they become separate islands (and the maze can bridge them).
 *  - `analyzeWalkable` labels the walkable components of the final islands and picks the **main** one per
 *    island (largest). Bridge and elevator mouths, the start, the goal, items and restart points are then
 *    restricted to it, so every placed thing is reachable by rolling.
 */
import { distanceTransform } from './distance.ts';
import { componentInfo, labelComponents } from './islands.ts';

/** Walkable if the cell centre is at least this far (px) from the island edge (raster estimate). */
export function walkMask(
  labels: Int32Array,
  dist: Float32Array,
  cell: number,
  clearancePx: number,
): Uint8Array {
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++)
    if ((labels[i] as number) > 0 && ((dist[i] as number) - 0.5) * cell >= clearancePx) out[i] = 1;
  return out;
}

/**
 * 8-connected components of `walk`, never crossing between different island labels.
 * Returns per-cell component ids (0 = none) and the component → island label map.
 */
export function walkComponents(
  walk: Uint8Array,
  labels: Int32Array,
  cols: number,
  rows: number,
): { comp: Int32Array; count: number; islandOf: number[]; area: number[] } {
  const comp = new Int32Array(walk.length);
  const islandOf: number[] = [0];
  const area: number[] = [0];
  let count = 0;
  const stack: number[] = [];
  for (let s = 0; s < walk.length; s++) {
    if (!walk[s] || comp[s]) continue;
    const isl = labels[s] as number;
    count++;
    islandOf.push(isl);
    let n = 0;
    comp[s] = count;
    stack.push(s);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      n++;
      const c = i % cols;
      const r = (i - c) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if ((dr === 0 && dc === 0) || cc < 0 || cc >= cols) continue;
          const j = rr * cols + cc;
          if (!walk[j] || comp[j] || labels[j] !== isl) continue;
          comp[j] = count;
          stack.push(j);
        }
      }
    }
    area.push(n);
  }
  return { comp, count, islandOf, area };
}

export interface NeckSplitOptions {
  clearancePx: number;
  /** A part only becomes its own island if it can hold a disc of this diameter (px)… */
  minThicknessPx: number;
  /** …and has at least this much land (px²) nearest to it. */
  minAreaPx2: number;
}

/**
 * Cut `mask` (in place) where a land component joins two or more island-sized walkable parts through necks
 * narrower than the ball. Every land cell goes to its geodesically nearest walkable part (multi-source BFS
 * inside the component); a 2-cell channel is cut wherever two parts meet. Parts that are too small to stand
 * alone are not separated: they stay attached (and unused, see `analyzeWalkable`). Returns the number of cuts.
 */
export function splitAtNecks(
  mask: Uint8Array,
  cols: number,
  rows: number,
  cell: number,
  opts: NeckSplitOptions,
): number {
  const { labels, count } = labelComponents(mask, cols, rows);
  if (count === 0) return 0;
  const dist = distanceTransform(mask, cols, rows);
  const walk = walkMask(labels, dist, cell, opts.clearancePx);
  const wc = walkComponents(walk, labels, cols, rows);
  // island-worthy parts: thick enough (max distance) and big enough (area of the reachable disc cover is
  // approximated by the walkable area dilated by the radius; the area check is re-done by extractIslands)
  const maxD = new Float32Array(wc.count + 1);
  for (let i = 0; i < walk.length; i++) {
    const k = wc.comp[i] as number;
    if (k && (dist[i] as number) > (maxD[k] as number)) maxD[k] = dist[i] as number;
  }
  const worthy = new Uint8Array(wc.count + 1);
  const perIsland = new Int32Array(count + 1);
  for (let k = 1; k <= wc.count; k++) {
    const thick = ((maxD[k] as number) - 0.5) * cell * 2;
    if (thick >= opts.minThicknessPx) {
      worthy[k] = 1;
      perIsland[wc.islandOf[k] as number]++;
    }
  }
  let cuts = 0;
  const info = componentInfo(labels, count, cols);
  for (const s of info) {
    if ((perIsland[s.label] as number) < 2) continue;
    // multi-source BFS from the worthy parts over this component's land (4-connected: geodesic, no diagonal
    // shortcuts across a pinch)
    const owner = new Int32Array(walk.length);
    let queue: number[] = [];
    for (let r = s.r0; r < s.r1; r++)
      for (let c = s.c0; c < s.c1; c++) {
        const i = r * cols + c;
        const k = wc.comp[i] as number;
        if (labels[i] === s.label && k && worthy[k]) {
          owner[i] = k;
          queue.push(i);
        }
      }
    while (queue.length > 0) {
      const next: number[] = [];
      for (const i of queue) {
        const c = i % cols;
        const r = (i - c) / cols;
        const nb = [
          c > 0 ? i - 1 : -1,
          c < cols - 1 ? i + 1 : -1,
          r > 0 ? i - cols : -1,
          r < rows - 1 ? i + cols : -1,
        ];
        for (const j of nb) {
          if (j < 0 || owner[j] || labels[j] !== s.label) continue;
          owner[j] = owner[i] as number;
          next.push(j);
        }
      }
      queue = next;
    }
    // area per owner: parts below the minimum area stay attached to nothing in particular; only cut between
    // parts that are both big enough
    const areaOf = new Map<number, number>();
    for (let r = s.r0; r < s.r1; r++)
      for (let c = s.c0; c < s.c1; c++) {
        const o = owner[r * cols + c] as number;
        if (o) areaOf.set(o, (areaOf.get(o) ?? 0) + 1);
      }
    const big = (o: number) => (areaOf.get(o) ?? 0) * cell * cell >= opts.minAreaPx2;
    if ([...areaOf.keys()].filter(big).length < 2) continue;
    // channel: land cells with an 8-neighbour owned by a different big part (both sides → 2 cells wide)
    const cut: number[] = [];
    for (let r = s.r0; r < s.r1; r++)
      for (let c = s.c0; c < s.c1; c++) {
        const i = r * cols + c;
        const o = owner[i] as number;
        if (!o || !big(o)) continue;
        let clash = false;
        for (let dr = -1; dr <= 1 && !clash; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
            const q = owner[rr * cols + cc] as number;
            if (q && q !== o && big(q)) {
              clash = true;
              break;
            }
          }
        if (clash) cut.push(i);
      }
    if (cut.length === 0) continue;
    for (const i of cut) mask[i] = 0;
    cuts++;
  }
  return cuts;
}

export interface WalkableInfo {
  /** The fine raster: island index + 1 per cell (0 = water). */
  labels: Int32Array;
  /** Per cell: 1 if in the main walkable component of its island. */
  main: Uint8Array;
  /** Per island index: number of walkable components (for provenance/debug). */
  parts: number[];
  cols: number;
  rows: number;
  cell: number;
}

/**
 * Rasterize the final island polygons (contour + holes, even-odd) at `cellPx`, sampling cell centres.
 * Scanline fill: O(rows × edges).
 */
export function rasterizeIslands(
  shapes: readonly {
    contour: readonly (readonly [number, number])[];
    holes: readonly (readonly (readonly [number, number])[])[];
  }[],
  width: number,
  height: number,
  cellPx: number,
): { labels: Int32Array; cols: number; rows: number; cell: number } {
  const cols = Math.max(1, Math.ceil(width / cellPx));
  const rows = Math.max(1, Math.ceil(height / cellPx));
  const labels = new Int32Array(cols * rows);
  const xs: number[] = [];
  shapes.forEach((sh, k) => {
    const rings = [sh.contour, ...sh.holes].filter((r) => r.length >= 3);
    if (rings.length === 0) return;
    let y0 = Number.POSITIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const p of sh.contour) {
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    const r0 = Math.max(0, Math.floor(y0 / cellPx - 0.5));
    const r1 = Math.min(rows - 1, Math.ceil(y1 / cellPx));
    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * cellPx;
      xs.length = 0;
      for (const ring of rings) {
        const n = ring.length;
        for (let i = 0; i < n; i++) {
          const p = ring[i] as readonly [number, number];
          const q = ring[(i + 1) % n] as readonly [number, number];
          if (p[1] > y !== q[1] > y) xs.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
        }
      }
      xs.sort((u, v) => u - v);
      for (let j = 0; j + 1 < xs.length; j += 2) {
        const c0 = Math.max(0, Math.ceil((xs[j] as number) / cellPx - 0.5));
        const c1 = Math.min(cols - 1, Math.floor((xs[j + 1] as number) / cellPx - 0.5));
        for (let c = c0; c <= c1; c++) labels[r * cols + c] = k + 1;
      }
    }
  });
  return { labels, cols, rows, cell: cellPx };
}

/**
 * Walkable components of the final islands (rasterized from their polygons at `cellPx`, so smoothing and
 * bevels count); keep the largest per island as its main part.
 */
export function analyzeWalkable(
  shapes: Parameters<typeof rasterizeIslands>[0],
  width: number,
  height: number,
  cellPx: number,
  clearancePx: number,
): WalkableInfo {
  const { labels, cols, rows, cell } = rasterizeIslands(shapes, width, height, cellPx);
  const count = shapes.length;
  const land = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) land[i] = labels[i] ? 1 : 0;
  const dist = distanceTransform(land, cols, rows);
  const walk = walkMask(labels, dist, cell, clearancePx);
  const wc = walkComponents(walk, labels, cols, rows);
  const best = new Int32Array(count + 1);
  const parts = new Array<number>(count).fill(0);
  for (let k = 1; k <= wc.count; k++) {
    const isl = wc.islandOf[k] as number;
    parts[isl - 1] = (parts[isl - 1] ?? 0) + 1;
    const cur = best[isl] as number;
    if (!cur || (wc.area[k] as number) > (wc.area[cur] as number)) best[isl] = k;
  }
  const main = new Uint8Array(walk.length);
  for (let i = 0; i < walk.length; i++) {
    const k = wc.comp[i] as number;
    if (k && best[labels[i] as number] === k) main[i] = 1;
  }
  return { labels, main, parts, cols, rows, cell };
}

/** Cell index of a stage point, or −1 outside the grid. */
export function cellAt(
  w: Pick<WalkableInfo, 'cols' | 'rows' | 'cell'>,
  p: readonly [number, number],
): number {
  const c = Math.floor(p[0] / w.cell);
  const r = Math.floor(p[1] / w.cell);
  if (c < 0 || r < 0 || c >= w.cols || r >= w.rows) return -1;
  return r * w.cols + c;
}

/**
 * Is the ball centre at `p` in the main walkable part of island `label` (1-based)? With `slackPx` > 0: is there
 * a main cell of that island within that distance (cell centres)?
 */
export function onMain(w: WalkableInfo, label: number, p: readonly [number, number], slackPx = 0): boolean {
  const i = cellAt(w, p);
  if (i < 0) return false;
  if (slackPx <= 0) return w.labels[i] === label && w.main[i] === 1;
  const c0 = i % w.cols;
  const r0 = (i - c0) / w.cols;
  const k = Math.ceil(slackPx / w.cell);
  const k2 = (slackPx / w.cell) ** 2 + 1e-9;
  for (let dr = -k; dr <= k; dr++) {
    const r = r0 + dr;
    if (r < 0 || r >= w.rows) continue;
    for (let dc = -k; dc <= k; dc++) {
      const c = c0 + dc;
      if (c < 0 || c >= w.cols || dr * dr + dc * dc > k2) continue;
      const j = r * w.cols + c;
      if (w.main[j] === 1 && w.labels[j] === label) return true;
    }
  }
  return false;
}

/** 8-connected flood fill from `starts` over cells where `ok(i)`; returns the visited mask. */
export function flood(
  cols: number,
  rows: number,
  starts: readonly number[],
  ok: (i: number) => boolean,
): Uint8Array {
  const seen = new Uint8Array(cols * rows);
  const stack: number[] = [];
  for (const s of starts)
    if (s >= 0 && !seen[s] && ok(s)) {
      seen[s] = 1;
      stack.push(s);
    }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const c = i % cols;
    const r = (i - c) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= rows) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        if (cc < 0 || cc >= cols) continue;
        const j = rr * cols + cc;
        if (seen[j] || !ok(j)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return seen;
}
