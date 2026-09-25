/**
 * Texture tiling math (pure). Long stage images can exceed the GPU's max texture size, so the image is cut
 * into horizontal bands ("tiles") of at most `maxSize` rows. Island-top triangles are clipped to each band
 * and get band-local UVs, so every tile is an ordinary 2D texture (one geometry group / draw per tile).
 */
import type { StageData, Vec2 } from '@wwm/schema';

export interface TexTile {
  index: number;
  /** First image row (inclusive) and end row (exclusive), in image px. */
  row0: number;
  row1: number;
  /** The same band in stage px (image px / texture.scale). */
  stageY0: number;
  stageY1: number;
}

export interface TilePlan {
  tiles: TexTile[];
  /** Image width after an optional downscale to fit `maxSize` (width is never tiled). */
  width: number;
  /** Uniform downscale applied to the image before tiling (1 = none). */
  downscale: number;
  /** Image px per stage px after the downscale. */
  scale: number;
}

/**
 * Plan the tiles for an image of `width × height` image px, with `scale` image px per stage px.
 * Width wider than `maxSize` is handled by a uniform downscale (rare: pages are ≤ 1280 CSS px × DPR 2).
 */
export function planTiles(width: number, height: number, scale: number, maxSize: number): TilePlan {
  if (!(maxSize > 0)) throw new Error('maxSize must be > 0');
  const downscale = width > maxSize ? maxSize / width : 1;
  const w = Math.min(maxSize, Math.round(width * downscale));
  const h = Math.max(1, Math.round(height * downscale));
  const s = scale * downscale;
  const n = Math.max(1, Math.ceil(h / maxSize));
  const tiles: TexTile[] = [];
  for (let i = 0; i < n; i++) {
    const row0 = Math.round((i * h) / n);
    const row1 = Math.round(((i + 1) * h) / n);
    tiles.push({
      index: i,
      row0,
      row1,
      stageY0: i === 0 ? Number.NEGATIVE_INFINITY : row0 / s,
      stageY1: i === n - 1 ? Number.POSITIVE_INFINITY : row1 / s,
    });
  }
  return { tiles, width: w, downscale, scale: s };
}

/**
 * Stage px → UV inside a tile. `v = 0` is the tile's top row (textures are uploaded with flipY = false).
 * Points outside the band clamp to its edge rows only through the sampler (no clamping here).
 */
export function tileUv(p: Vec2, tile: TexTile, plan: TilePlan): Vec2 {
  return [(p[0] * plan.scale) / plan.width, (p[1] * plan.scale - tile.row0) / (tile.row1 - tile.row0)];
}

/** Convenience: tile plan straight from a stage and the device limit. */
export function planStageTiles(stage: StageData, maxSize: number): TilePlan {
  return planTiles(stage.texture.width, stage.texture.height, stage.texture.scale, maxSize);
}

/**
 * Clip a triangle (stage px, x right / y down) to the horizontal band y0 ≤ y ≤ y1.
 * Returns the resulting convex polygon (0, 3, 4 or 5 vertices) in the input winding.
 */
export function clipTriangleToBand(tri: readonly [Vec2, Vec2, Vec2], y0: number, y1: number): Vec2[] {
  let poly: Vec2[] = [tri[0], tri[1], tri[2]];
  if (Number.isFinite(y0)) poly = clipHalfPlane(poly, (p) => p[1] - y0);
  if (poly.length && Number.isFinite(y1)) poly = clipHalfPlane(poly, (p) => y1 - p[1]);
  return poly;
}

/** Sutherland–Hodgman against one half plane `f(p) ≥ 0`. */
function clipHalfPlane(poly: Vec2[], f: (p: Vec2) => number): Vec2[] {
  const out: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % n] as Vec2;
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if (fa >= 0 !== fb >= 0) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Fan-triangulate a convex polygon. */
export function fan(poly: readonly Vec2[]): [Vec2, Vec2, Vec2][] {
  const out: [Vec2, Vec2, Vec2][] = [];
  for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0] as Vec2, poly[i] as Vec2, poly[i + 1] as Vec2]);
  return out;
}

/** Area of a triangle in px² (unsigned). */
export function triArea(t: readonly [Vec2, Vec2, Vec2]): number {
  return Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;
}
