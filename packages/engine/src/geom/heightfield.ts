/**
 * Low-res top-surface heightfield of islands and bridge decks (pure). The chase camera uses it to stay
 * above geometry and to test the ball→camera line of sight without raycasting meshes.
 */
import { LEVEL_HEIGHT_M, PX_PER_METER, SLAB_THICKNESS_M, type StageData, type Vec2 } from '@wwm/schema';

export interface Heightfield {
  /** Cell size in px. */
  cell: number;
  cols: number;
  rows: number;
  /** Top surface Y (m) per cell, NaN where there is nothing. */
  top: Float32Array;
  /** Bottom Y (m) per cell (top − slab thickness), NaN where empty. */
  bottom: Float32Array;
}

export function buildHeightfield(stage: StageData, cellPx = 4): Heightfield {
  const cols = Math.max(1, Math.ceil(stage.size.width / cellPx));
  const rows = Math.max(1, Math.ceil(stage.size.height / cellPx));
  const top = new Float32Array(cols * rows).fill(Number.NaN);
  const bottom = new Float32Array(cols * rows).fill(Number.NaN);
  const put = (c: number, r: number, y: number, thick: number) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const i = r * cols + c;
    const cur = top[i] as number;
    if (Number.isNaN(cur) || y > cur) {
      top[i] = y;
      bottom[i] = y - thick;
    }
  };
  for (const isl of stage.islands) {
    const y = isl.level * LEVEL_HEIGHT_M;
    fillPolygon([isl.contour, ...isl.holes], cellPx, cols, rows, (c, r) => put(c, r, y, SLAB_THICKNESS_M));
  }
  for (const br of stage.bridges) {
    const len = Math.hypot(br.b[0] - br.a[0], br.b[1] - br.a[1]);
    if (len < 1e-6) continue;
    const d: Vec2 = [(br.b[0] - br.a[0]) / len, (br.b[1] - br.a[1]) / len];
    const n: Vec2 = [-d[1], d[0]];
    const w = br.width / 2;
    const rect: Vec2[] = [
      [br.a[0] + n[0] * w, br.a[1] + n[1] * w],
      [br.b[0] + n[0] * w, br.b[1] + n[1] * w],
      [br.b[0] - n[0] * w, br.b[1] - n[1] * w],
      [br.a[0] - n[0] * w, br.a[1] - n[1] * w],
    ];
    fillPolygon([rect], cellPx, cols, rows, (c, r) => {
      const px = (c + 0.5) * cellPx;
      const py = (r + 0.5) * cellPx;
      const t = Math.min(1, Math.max(0, ((px - br.a[0]) * d[0] + (py - br.a[1]) * d[1]) / len));
      put(c, r, (br.levelA + (br.levelB - br.levelA) * t) * LEVEL_HEIGHT_M, SLAB_THICKNESS_M);
    });
  }
  return { cell: cellPx, cols, rows, top, bottom };
}

/** Even-odd scanline fill of rings at cell centres. */
export function fillPolygon(
  rings: readonly (readonly Vec2[])[],
  cell: number,
  cols: number,
  rows: number,
  visit: (c: number, r: number) => void,
): void {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of rings)
    for (const p of ring) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  const r0 = Math.max(0, Math.floor(minY / cell));
  const r1 = Math.min(rows - 1, Math.ceil(maxY / cell));
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const y = (r + 0.5) * cell;
    xs.length = 0;
    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = ring[i] as Vec2;
        const b = ring[j] as Vec2;
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] as number) / cell - 0.5));
      const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] as number) / cell - 0.5));
      for (let c = c0; c <= c1; c++) visit(c, r);
    }
  }
}

/** Top surface height (m) at world (x, z), or NaN. */
export function sampleTop(hf: Heightfield, x: number, z: number): number {
  const c = Math.floor((x * PX_PER_METER) / hf.cell);
  const r = Math.floor((z * PX_PER_METER) / hf.cell);
  if (c < 0 || r < 0 || c >= hf.cols || r >= hf.rows) return Number.NaN;
  return hf.top[r * hf.cols + c] as number;
}

/**
 * Walk the segment from `a` to `b` (world m) and return the smallest fraction t ∈ (0, 1] at which the
 * segment passes through a slab (between bottom and top + clearance), or 1 if the line is clear.
 */
export function lineOfSight(
  hf: Heightfield,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  clearance = 0.15,
  steps = 24,
): number {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    const c = Math.floor((x * PX_PER_METER) / hf.cell);
    const r = Math.floor((z * PX_PER_METER) / hf.cell);
    if (c < 0 || r < 0 || c >= hf.cols || r >= hf.rows) continue;
    const top = hf.top[r * hf.cols + c] as number;
    if (Number.isNaN(top)) continue;
    const bot = hf.bottom[r * hf.cols + c] as number;
    if (y < top + clearance && y > bot - clearance) return t;
  }
  return 1;
}

/** Lowest island top (m); the fall depth and the ocean are measured from here. */
export function lowestTop(stage: StageData): number {
  let m = Number.POSITIVE_INFINITY;
  for (const i of stage.islands) m = Math.min(m, i.level * LEVEL_HEIGHT_M);
  return Number.isFinite(m) ? m : 0;
}
