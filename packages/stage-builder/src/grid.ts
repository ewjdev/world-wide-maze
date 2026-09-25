/**
 * Step 1: the work grid. The slice (stage-local px) is divided into square cells of `cellPx`; every later
 * raster step works on this grid. Pixel sampling honours `screenshot.scale` (image px = page px × scale).
 */
import type { Rect, RGBAImage } from '@wwm/schema';

export interface Grid {
  cols: number;
  rows: number;
  /** Cell edge, stage px. */
  cell: number;
  /** Stage size, px. */
  width: number;
  height: number;
  /** Page-space y of the slice origin. */
  sliceY: number;
  /** Image px per page px. */
  scale: number;
  image: RGBAImage;
  /** Sub-samples per cell axis (samples sit at CSS-px spacing, capped at 3). */
  samplesPerAxis: number;
  /** Average RGB per cell (for the debugger's "grid" layer and the dominant-color pass). */
  cellRgb: Uint8Array;
}

export function createGrid(
  image: RGBAImage,
  scale: number,
  width: number,
  height: number,
  sliceY: number,
  cell: number,
): Grid {
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const samplesPerAxis = Math.max(1, Math.min(3, Math.round(cell)));
  const grid: Grid = {
    cols,
    rows,
    cell,
    width,
    height,
    sliceY,
    scale,
    image,
    samplesPerAxis,
    cellRgb: new Uint8Array(cols * rows * 3),
  };
  const rgb = grid.cellRgb;
  const acc = [0, 0, 0];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      acc[0] = acc[1] = acc[2] = 0;
      let n = 0;
      forEachSample(grid, c, r, (off) => {
        acc[0] += image.data[off] as number;
        acc[1] += image.data[off + 1] as number;
        acc[2] += image.data[off + 2] as number;
        n++;
      });
      const i = (r * cols + c) * 3;
      if (n > 0) {
        rgb[i] = Math.round((acc[0] as number) / n);
        rgb[i + 1] = Math.round((acc[1] as number) / n);
        rgb[i + 2] = Math.round((acc[2] as number) / n);
      }
    }
  }
  return grid;
}

/**
 * Visit the image byte offset of each sample in cell (c, r). Samples outside the image (a capture whose
 * screenshot is shorter than the page) are skipped.
 */
export function forEachSample(grid: Grid, c: number, r: number, fn: (offset: number) => void): void {
  const { cell, samplesPerAxis: s, scale, image, sliceY, width, height } = grid;
  const iw = image.width;
  const ih = image.height;
  for (let j = 0; j < s; j++) {
    const y = r * cell + ((j + 0.5) * cell) / s;
    if (y >= height) break;
    const iy = Math.floor((sliceY + y) * scale);
    if (iy < 0 || iy >= ih) continue;
    for (let i = 0; i < s; i++) {
      const x = c * cell + ((i + 0.5) * cell) / s;
      if (x >= width) break;
      const ix = Math.floor(x * scale);
      if (ix < 0 || ix >= iw) continue;
      fn((iy * iw + ix) * 4);
    }
  }
}

/** Cell range [c0, c1) × [r0, r1) covered by a stage-local rect (any overlap counts), clamped to the grid. */
export function rectToCells(
  grid: Pick<Grid, 'cols' | 'rows' | 'cell'>,
  rect: Rect,
): { c0: number; c1: number; r0: number; r1: number } {
  const { cell, cols, rows } = grid;
  const c0 = Math.max(0, Math.floor(rect.x / cell));
  const r0 = Math.max(0, Math.floor(rect.y / cell));
  const c1 = Math.min(cols, Math.ceil((rect.x + rect.w) / cell));
  const r1 = Math.min(rows, Math.ceil((rect.y + rect.h) / cell));
  return { c0, c1: Math.max(c0, c1), r0, r1: Math.max(r0, r1) };
}
