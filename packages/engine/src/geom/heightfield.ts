/**
 * Low-res top-surface heightfield of islands and bridge decks (pure). The chase camera uses it to stay
 * above geometry and to test the ball→camera line of sight without raycasting meshes.
 */
import {
  bridgeSurfaceMesh,
  LEVEL_HEIGHT_M,
  PX_PER_METER,
  SLAB_THICKNESS_M,
  type StageData,
  type Vec2,
} from '@wwm/schema';

export interface Heightfield {
  /** Cell size in px. */
  cell: number;
  cols: number;
  rows: number;
  /** Top surface Y (m) per cell, NaN where there is nothing. */
  top: Float32Array;
  /** Bottom Y (m) per cell (top − slab thickness), NaN where empty. */
  bottom: Float32Array;
  /** Additional lower slabs in overlapping cells, stored as bottom/top pairs. */
  lower?: Map<number, number[]>;
}

export function buildHeightfield(stage: StageData, cellPx = 4): Heightfield {
  const cols = Math.max(1, Math.ceil(stage.size.width / cellPx));
  const rows = Math.max(1, Math.ceil(stage.size.height / cellPx));
  const top = new Float32Array(cols * rows).fill(Number.NaN);
  const bottom = new Float32Array(cols * rows).fill(Number.NaN);
  const lower = new Map<number, number[]>();
  const put = (c: number, r: number, y: number, thick: number) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const i = r * cols + c;
    const cur = top[i] as number;
    if (!Number.isNaN(cur) && Math.abs(y - cur) > 0.05) {
      const slabs = lower.get(i) ?? [];
      const lo = y > cur ? (bottom[i] as number) : y - thick,
        hi = Math.min(y, cur);
      if (!slabs.some((v, k) => k % 2 === 1 && Math.abs(v - hi) < 0.05)) slabs.push(lo, hi);
      lower.set(i, slabs);
    }
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
    if (br.control || br.bank || br.elevationProfile) {
      const mesh = bridgeSurfaceMesh(br, SLAB_THICKNESS_M);
      const vertex = (i: number): [number, number, number] => [
        (mesh.vertices[i * 3] as number) * PX_PER_METER,
        mesh.vertices[i * 3 + 1] as number,
        (mesh.vertices[i * 3 + 2] as number) * PX_PER_METER,
      ];
      const triangle = (ia: number, ib: number, ic: number) => {
        const a = vertex(ia),
          b = vertex(ib),
          d = vertex(ic);
        const den = (b[2] - d[2]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[2] - d[2]);
        if (Math.abs(den) < 1e-8) return;
        fillPolygon(
          [
            [
              [a[0], a[2]],
              [b[0], b[2]],
              [d[0], d[2]],
            ],
          ],
          cellPx,
          cols,
          rows,
          (c, r) => {
            const x = (c + 0.5) * cellPx,
              z = (r + 0.5) * cellPx;
            const u = ((b[2] - d[2]) * (x - d[0]) + (d[0] - b[0]) * (z - d[2])) / den;
            const v = ((d[2] - a[2]) * (x - d[0]) + (a[0] - d[0]) * (z - d[2])) / den;
            put(c, r, u * a[1] + v * b[1] + (1 - u - v) * d[1], SLAB_THICKNESS_M);
          },
        );
      };
      for (let i = 0; i + 4 < mesh.vertices.length / 3; i += 4) {
        triangle(i, i + 4, i + 5);
        triangle(i, i + 5, i + 1);
      }
      continue;
    }
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
  return { cell: cellPx, cols, rows, top, bottom, lower };
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

/** Highest floor below a world height; an overhead bridge is not the camera's floor. */
export function sampleFloor(hf: Heightfield, x: number, z: number, ceiling: number): number {
  const c = Math.floor((x * PX_PER_METER) / hf.cell),
    r = Math.floor((z * PX_PER_METER) / hf.cell);
  if (c < 0 || r < 0 || c >= hf.cols || r >= hf.rows) return Number.NaN;
  const i = r * hf.cols + c,
    top = hf.top[i] as number;
  let floor = top <= ceiling ? top : Number.NaN;
  const lower = hf.lower?.get(i) ?? [];
  for (let k = 1; k < lower.length; k += 2) {
    const y = lower[k] as number;
    if (y <= ceiling && (Number.isNaN(floor) || y > floor)) floor = y;
  }
  return floor;
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
    const lower = hf.lower?.get(r * hf.cols + c) ?? [];
    for (let k = 0; k < lower.length; k += 2)
      if (y < (lower[k + 1] as number) + clearance && y > (lower[k] as number) - clearance) return t;
  }
  return 1;
}

/** Lowest island top (m); the fall depth and the ocean are measured from here. */
export function lowestTop(stage: StageData): number {
  let m = Number.POSITIVE_INFINITY;
  for (const i of stage.islands) m = Math.min(m, i.level * LEVEL_HEIGHT_M);
  return Number.isFinite(m) ? m : 0;
}
