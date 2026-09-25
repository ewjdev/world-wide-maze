/**
 * The ONLY place page space ↔ world space conversion happens (contracts §1).
 *
 * Stage space (contracts §1): CSS px local to the stage slice, x right, y down, origin = slice top-left.
 * World space: meters, right-handed, +Y up. worldX = pageX / PX_PER_METER, worldZ = pageY / PX_PER_METER,
 * worldY = level * LEVEL_HEIGHT_M (island top surface).
 */
import { LEVEL_HEIGHT_M, PX_PER_METER } from './constants.ts';
import type { Vec2 } from './types.ts';

export type Vec3 = [number, number, number];

/** Stage-local point (px) + float level → world point (m). */
export function pageToWorld(p: Vec2, level = 0): Vec3 {
  return [p[0] / PX_PER_METER, level * LEVEL_HEIGHT_M, p[1] / PX_PER_METER];
}

/** World point (m) → page point (px). The Y component is dropped; use `worldYToLevel` for height. */
export function worldToPage(w: Vec3 | readonly [number, number, number]): Vec2 {
  return [w[0] * PX_PER_METER, w[2] * PX_PER_METER];
}

/** Page length (px) → world length (m). */
export function pxToMeters(px: number): number {
  return px / PX_PER_METER;
}

/** World length (m) → page length (px). */
export function metersToPx(m: number): number {
  return m * PX_PER_METER;
}

/** Island level → world Y of its top surface (m). */
export function levelToWorldY(level: number): number {
  return level * LEVEL_HEIGHT_M;
}

/** World Y (m) → fractional level. */
export function worldYToLevel(y: number): number {
  return y / LEVEL_HEIGHT_M;
}
