/**
 * Step 5: islands = connected components of the land mask (4-connected, two-pass union-find).
 * - Oversized components (a full-bleed hero image, a big card) are split into tiles along natural gaps: each
 *   cut is placed at the row/column with the least land inside a window around the ideal tile boundary. (N)
 * - Components that can't hold a 2 D disc (MIN_ISLAND_SIZE_PX) or are below the minimum area are dropped.
 */
import { distanceTransform } from './distance.ts';
import type { BuildParams } from './params.ts';

export interface LabelResult {
  /** 0 = water, 1..count = component. */
  labels: Int32Array;
  count: number;
}

/** Two-pass union-find connected-component labeling (4-connectivity). Labels are in raster order. */
export function labelComponents(mask: ArrayLike<number>, cols: number, rows: number): LabelResult {
  const n = cols * rows;
  const labels = new Int32Array(n);
  const parent: number[] = [0];
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[x] !== r) {
      const nx = parent[x] as number;
      parent[x] = r;
      x = nx;
    }
    return r;
  };
  let next = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!mask[i]) continue;
      const left = c > 0 ? (labels[i - 1] as number) : 0;
      const up = r > 0 ? (labels[i - cols] as number) : 0;
      if (left === 0 && up === 0) {
        parent.push(next);
        labels[i] = next++;
      } else if (left !== 0 && up !== 0) {
        const a = find(left);
        const b = find(up);
        labels[i] = Math.min(a, b);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      } else labels[i] = left || up;
    }
  }
  // Second pass: resolve and compact in raster order of first appearance.
  const remap = new Int32Array(next);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const l = labels[i] as number;
    if (l === 0) continue;
    const root = find(l);
    if (remap[root] === 0) remap[root] = ++count;
    labels[i] = remap[root] as number;
  }
  return { labels, count };
}

export interface ComponentInfo {
  label: number;
  area: number; // cells
  c0: number;
  r0: number;
  c1: number; // exclusive
  r1: number;
}

export function componentInfo(labels: Int32Array, count: number, cols: number): ComponentInfo[] {
  const info: ComponentInfo[] = [];
  for (let l = 1; l <= count; l++)
    info.push({
      label: l,
      area: 0,
      c0: Number.MAX_SAFE_INTEGER,
      r0: Number.MAX_SAFE_INTEGER,
      c1: -1,
      r1: -1,
    });
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i] as number;
    if (l === 0) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    const s = info[l - 1] as ComponentInfo;
    s.area++;
    if (c < s.c0) s.c0 = c;
    if (r < s.r0) s.r0 = r;
    if (c + 1 > s.c1) s.c1 = c + 1;
    if (r + 1 > s.r1) s.r1 = r + 1;
  }
  return info;
}

/** Choose `k-1` cut positions in [lo, hi) near the ideal equal split, each at the least-occupied line. */
function chooseCuts(profile: Int32Array, lo: number, hi: number, k: number, window: number): number[] {
  const cuts: number[] = [];
  const span = hi - lo;
  for (let j = 1; j < k; j++) {
    const ideal = Math.round(lo + (span * j) / k);
    let best = ideal;
    let bestV = Number.POSITIVE_INFINITY;
    for (let p = Math.max(lo + 1, ideal - window); p <= Math.min(hi - 2, ideal + window); p++) {
      const v = (profile[p] as number) + Math.abs(p - ideal) * 0.01; // prefer the ideal on ties
      if (v < bestV) {
        bestV = v;
        best = p;
      }
    }
    cuts.push(best);
  }
  return cuts;
}

/**
 * Split oversized components in place (mask cells set to 0 along cut channels).
 * Returns the number of components that were split.
 */
export function splitOversized(
  mask: Uint8Array,
  cols: number,
  rows: number,
  cell: number,
  params: BuildParams,
): number {
  const { labels, count } = labelComponents(mask, cols, rows);
  const info = componentInfo(labels, count, cols);
  const tile = params.splitTilePx / cell;
  const ch = params.splitChannelCells;
  let split = 0;
  for (const s of info) {
    if (s.area * cell * cell <= params.splitAreaPx2) continue;
    const w = s.c1 - s.c0;
    const h = s.r1 - s.r0;
    const kx = Math.max(1, Math.round(w / tile));
    const ky = Math.max(1, Math.round(h / tile));
    if (kx === 1 && ky === 1) continue;
    split++;
    const colProfile = new Int32Array(cols);
    const rowProfile = new Int32Array(rows);
    for (let r = s.r0; r < s.r1; r++)
      for (let c = s.c0; c < s.c1; c++)
        if (labels[r * cols + c] === s.label) {
          colProfile[c]++;
          rowProfile[r]++;
        }
    const win = Math.max(1, Math.floor(tile / 4));
    for (const cut of chooseCuts(colProfile, s.c0, s.c1, kx, win))
      for (let r = s.r0; r < s.r1; r++)
        for (let c = cut; c < Math.min(s.c1, cut + ch); c++)
          if (labels[r * cols + c] === s.label) mask[r * cols + c] = 0;
    for (const cut of chooseCuts(rowProfile, s.r0, s.r1, ky, win))
      for (let r = cut; r < Math.min(s.r1, cut + ch); r++)
        for (let c = s.c0; c < s.c1; c++) if (labels[r * cols + c] === s.label) mask[r * cols + c] = 0;
  }
  return split;
}

/**
 * Grow components that are too thin to walk on (a single text line, a slim bar) until they can hold a
 * `minThicknessPx` disc, by at most `maxGrowCells` per side. Growth only enters water cells that keep a
 * one-cell moat to every other component, so islands never merge. Returns the number of grown components.
 */
export function thickenThin(
  mask: Uint8Array,
  cols: number,
  rows: number,
  cell: number,
  minThicknessPx: number,
  maxGrowCells: number,
): number {
  const { labels, count } = labelComponents(mask, cols, rows);
  const dist = distanceTransform(mask, cols, rows);
  const maxD = new Float32Array(count + 1);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i] as number;
    if (l && (dist[i] as number) > (maxD[l] as number)) maxD[l] = dist[i] as number;
  }
  const info = componentInfo(labels, count, cols);
  let grown = 0;
  for (const s of info) {
    const half = ((maxD[s.label] as number) - 0.5) * cell;
    const need = Math.ceil((minThicknessPx / 2 - half) / cell);
    if (need <= 0) continue;
    const steps = Math.min(maxGrowCells, need);
    grown++;
    let frontier: number[] = [];
    for (let r = s.r0; r < s.r1; r++)
      for (let c = s.c0; c < s.c1; c++) if (labels[r * cols + c] === s.label) frontier.push(r * cols + c);
    for (let k = 0; k < steps; k++) {
      const next: number[] = [];
      for (const i of frontier) {
        const c = i % cols;
        const r = (i - c) / cols;
        const nbrs = [
          c > 0 ? i - 1 : -1,
          c < cols - 1 ? i + 1 : -1,
          r > 0 ? i - cols : -1,
          r < rows - 1 ? i + cols : -1,
        ];
        for (const j of nbrs) {
          if (j < 0 || labels[j] !== 0) continue;
          // keep a one-cell moat to other components
          const jc = j % cols;
          const jr = (j - jc) / cols;
          let clash = false;
          for (let dr = -1; dr <= 1 && !clash; dr++)
            for (let dc = -1; dc <= 1; dc++) {
              const rr = jr + dr;
              const cc = jc + dc;
              if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
              const v = labels[rr * cols + cc] as number;
              if (v !== 0 && v !== s.label) {
                clash = true;
                break;
              }
            }
          if (clash) continue;
          labels[j] = s.label;
          mask[j] = 1;
          next.push(j);
        }
      }
      frontier = next;
    }
  }
  return grown;
}

export interface IslandRaster {
  /** 0 = water, 1..count = island (raster order). */
  labels: Int32Array;
  count: number;
  /** Distance transform of the kept land (cells). */
  dist: Float32Array;
  /** Cells of components dropped as too small (for provenance). */
  droppedMask: Uint8Array;
}

/** Label the mask and drop components that are too thin or too small. */
export function extractIslands(
  mask: Uint8Array,
  cols: number,
  rows: number,
  cell: number,
  params: BuildParams,
) {
  const { labels, count } = labelComponents(mask, cols, rows);
  const dist0 = distanceTransform(mask, cols, rows);
  const maxD = new Float32Array(count + 1);
  const area = new Int32Array(count + 1);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i] as number;
    if (l === 0) continue;
    area[l]++;
    if ((dist0[i] as number) > (maxD[l] as number)) maxD[l] = dist0[i] as number;
  }
  const keep = new Uint8Array(count + 1);
  const minHalf = params.minIslandThicknessPx / 2;
  for (let l = 1; l <= count; l++) {
    const thickHalf = ((maxD[l] as number) - 0.5) * cell; // center → edge
    keep[l] = thickHalf >= minHalf && (area[l] as number) * cell * cell >= params.minIslandAreaPx2 ? 1 : 0;
  }
  const kept = new Uint8Array(labels.length);
  const droppedMask = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i] as number;
    if (l === 0) continue;
    if (keep[l]) kept[i] = 1;
    else droppedMask[i] = 1;
  }
  const final = labelComponents(kept, cols, rows);
  const dist = distanceTransform(kept, cols, rows);
  const out: IslandRaster = { labels: final.labels, count: final.count, dist, droppedMask };
  return out;
}

/**
 * 03b (BI-1): fill narrow water gaps *inside* one land component, e.g. between a text row's title line and its
 * meta line, which the DOM padding leaves 1–2 cells apart but joined at one end. Such a component looks like
 * one island but the ball could only roll between its lines through that one join, often a neck narrower than
 * the ball. A water cell is filled when, along a row or a column, the same component lies within `maxGapCells`
 * on both sides and no other component touches it (islands never merge). ≈ 2013's dilate → blur → threshold,
 * which fused such lines. N. Returns the number of filled cells.
 */
export function fillInlets(mask: Uint8Array, cols: number, rows: number, maxGapCells: number): number {
  if (maxGapCells <= 0) return 0;
  const { labels } = labelComponents(mask, cols, rows);
  const fill: number[] = [];
  const at = (c: number, r: number) =>
    c < 0 || r < 0 || c >= cols || r >= rows ? 0 : (labels[r * cols + c] as number);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (labels[r * cols + c] !== 0) continue;
      let other = false;
      let near = 0;
      for (let dr = -1; dr <= 1 && !other; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const v = at(c + dc, r + dr);
          if (!v) continue;
          if (near && v !== near) {
            other = true;
            break;
          }
          near = v;
        }
      if (other) continue;
      let hit = false;
      for (const [dc, dr] of [
        [0, 1],
        [1, 0],
      ] as const) {
        let a = 0;
        let b = 0;
        for (let k = 1; k <= maxGapCells && !a; k++) a = at(c - dc * k, r - dr * k);
        for (let k = 1; k <= maxGapCells && !b; k++) b = at(c + dc * k, r + dr * k);
        if (a && a === b) {
          hit = true;
          break;
        }
      }
      if (hit) fill.push(r * cols + c);
    }
  for (const i of fill) mask[i] = 1;
  return fill.length;
}
