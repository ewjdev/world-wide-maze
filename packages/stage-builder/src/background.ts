/**
 * Step 2: background removal (E: 2013 removed the most common screenshot color).
 *
 * - The dominant color is the most common 15-bit color bin over the cell grid (the page background).
 * - `capture.backgroundColor` is background too.
 * - Improvement (N): an element's own `bg` is *local* background inside that element's rect when the element is
 *   large (≥ `bgRegionMinViewportShare` of the viewport), so full-width colored bands and page wrappers don't become
 *   one giant island. Inside such a region only its own color counts as background (white text on a dark band stays
 *   foreground). Small colored boxes (buttons, cards, bars) stay foreground: they are recognizable islands.
 * - A cell is foreground if at least `fgCellFraction` of its samples differ from its background set by ΔE ≥ `bgDeltaE`.
 */
import { getLabLut, lutIndex, parseColor } from './color.ts';
import { forEachSample, type Grid, rectToCells } from './grid.ts';
import type { BuildParams } from './params.ts';
import type { SliceElement } from './slice-elements.ts';

export interface BackgroundResult {
  /** 1 = background cell. */
  backgroundMask: Uint8Array;
  /** Foreground sample share per cell, 0–255. */
  fgShare: Uint8Array;
  dominant: [number, number, number];
  /** Elements whose `bg` was used as local background. */
  regionElementIds: number[];
}

/**
 * Most common 15-bit color bin over the grid cells; returns the mean color of that bin. Cells inside
 * `exclude` (media rects: images are never the page background) are skipped unless that leaves nothing.
 */
export function dominantColor(grid: Grid, exclude?: Uint8Array): [number, number, number] {
  const n = grid.cols * grid.rows;
  const hist = new Uint32Array(1 << 15);
  const rgb = grid.cellRgb;
  let counted = 0;
  for (let i = 0; i < n; i++) {
    if (exclude?.[i]) continue;
    hist[lutIndex(rgb[i * 3] as number, rgb[i * 3 + 1] as number, rgb[i * 3 + 2] as number)]++;
    counted++;
  }
  if (counted === 0)
    for (let i = 0; i < n; i++)
      hist[lutIndex(rgb[i * 3] as number, rgb[i * 3 + 1] as number, rgb[i * 3 + 2] as number)]++;
  let best = 0;
  for (let b = 1; b < hist.length; b++) if ((hist[b] as number) > (hist[best] as number)) best = b;
  let r = 0;
  let g = 0;
  let bl = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (counted > 0 && exclude?.[i]) continue;
    const R = rgb[i * 3] as number;
    const G = rgb[i * 3 + 1] as number;
    const B = rgb[i * 3 + 2] as number;
    if (lutIndex(R, G, B) === best) {
      r += R;
      g += G;
      bl += B;
      k++;
    }
  }
  return k === 0 ? [255, 255, 255] : [Math.round(r / k), Math.round(g / k), Math.round(bl / k)];
}

export function classifyBackground(
  grid: Grid,
  elements: readonly SliceElement[],
  pageBackground: string,
  viewportArea: number,
  params: BuildParams,
): BackgroundResult {
  const lut = getLabLut();
  const { cols, rows, image } = grid;
  const n = cols * rows;
  const media = new Uint8Array(n);
  for (const e of elements) {
    if (e.kind !== 'image' && e.kind !== 'video' && e.kind !== 'canvas') continue;
    const { c0, c1, r0, r1 } = rectToCells(grid, e.rect);
    for (let r = r0; r < r1; r++) media.fill(1, r * cols + c0, r * cols + c1);
  }
  const dominant = dominantColor(grid, media);

  const labOf = (c: [number, number, number]): [number, number, number] => {
    const i = lutIndex(c[0], c[1], c[2]) * 3;
    return [lut[i] as number, lut[i + 1] as number, lut[i + 2] as number];
  };

  // Global background set.
  const global: [number, number, number][] = [labOf(dominant)];
  const pageBg = parseColor(pageBackground);
  if (pageBg) global.push(labOf(pageBg));

  // Local background regions, painted shallow → deep (deeper wins), larger first at equal depth.
  const regionSets: [number, number, number][][] = [global];
  const regionMap = new Int32Array(n); // 0 = global set
  const regionElementIds: number[] = [];
  const minArea = params.bgRegionMinViewportShare * viewportArea;
  const regions = elements
    .filter((e) => e.bg && e.rect.w * e.rect.h >= minArea)
    .sort((a, b) => a.depth - b.depth || b.rect.w * b.rect.h - a.rect.w * a.rect.h || a.id - b.id);
  for (const e of regions) {
    const idx = regionSets.length;
    regionSets.push([labOf(e.bg as [number, number, number])]);
    regionElementIds.push(e.id);
    const { c0, c1, r0, r1 } = rectToCells(grid, e.rect);
    for (let r = r0; r < r1; r++) regionMap.fill(idx, r * cols + c0, r * cols + c1);
  }

  const thr2 = params.bgDeltaE * params.bgDeltaE;
  const backgroundMask = new Uint8Array(n);
  const fgShare = new Uint8Array(n);
  const data = image.data;
  let fg = 0;
  let total = 0;
  let set: [number, number, number][] = global;
  const visit = (off: number) => {
    const li = lutIndex(data[off] as number, data[off + 1] as number, data[off + 2] as number) * 3;
    const L = lut[li] as number;
    const A = lut[li + 1] as number;
    const B = lut[li + 2] as number;
    total++;
    for (const bg of set) {
      const dl = L - bg[0];
      const da = A - bg[1];
      const db = B - bg[2];
      if (dl * dl + da * da + db * db < thr2) return;
    }
    fg++;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      set = regionSets[regionMap[i] as number] as [number, number, number][];
      fg = 0;
      total = 0;
      forEachSample(grid, c, r, visit);
      const share = total === 0 ? 0 : fg / total;
      fgShare[i] = Math.round(share * 255);
      backgroundMask[i] = share >= params.fgCellFraction && total > 0 ? 0 : 1;
    }
  }
  return { backgroundMask, fgShare, dominant, regionElementIds };
}
