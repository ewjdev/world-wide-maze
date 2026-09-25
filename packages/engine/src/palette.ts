/**
 * Colour roles and look constants.
 *
 * Values marked E come from the recovered 2013 bundle (`common/config`, `game/material/materiallib`,
 * `game/object/*`; see docs/reference/bundle-notes.md §11). The art itself is new; only the colour roles
 * and numbers are reused.
 */

/** E: fog / sky, `#F8F8F8` from 400 to 1000 WU (×0.926 m). */
export const FOG_COLOR = 0xf8f8f8;
export const FOG_NEAR_M = 370;
export const FOG_FAR_M = 926;

/** E: `COLOR_TRIANGLE`, the pastel facets of the "ocean" plane. */
export const COLOR_TRIANGLE = [
  '#c2e1bf',
  '#8ac487',
  '#a5ccb0',
  '#acc4d0',
  '#cabcc3',
  '#dcaeb0',
  '#edc9b4',
  '#f7e29c',
] as const;

/** E: `COLOR_WIRE`, line / dot colours over the ocean plane. */
export const COLOR_WIRE = [
  '#73ec61',
  '#00dd00',
  '#52dba6',
  '#77caeb',
  '#d9b2c8',
  '#f98f95',
  '#ffb46c',
  '#ffca00',
] as const;

/**
 * E: the "fragmented" flat-shaded materials, HSV base + per-face noise variation (0, .05, .08).
 * red = elevators, green = bridges, blue = island sides, yellow = rails.
 */
export const HSV = {
  red: [0, 0.64, 0.86],
  green: [0.33, 0.56, 0.58],
  blue: [0.558, 0.54, 0.82],
  yellow: [0.14, 0.7, 0.94],
} as const satisfies Record<string, readonly [number, number, number]>;
export const HSV_VARIATION = [0, 0.05, 0.08] as const;

/** E: ball colours (`game/object/ball`): shell #dddddd, dark #20262d, core #456e93. */
export const BALL_SHELL = 0xdddddd;
export const BALL_DARK = 0x20262d;
export const BALL_CORE = 0x456e93;
/** E: one-up tint `0x40A193`. */
export const BALL_ONEUP = 0x40a193;

/** E: small item teal `0x31A4AE`; large energy `0x3bc6d2` / `0x206a71`. */
export const ITEM_SMALL = 0x31a4ae;
export const ITEM_LARGE = 0x3bc6d2;
export const ITEM_LARGE_DARK = 0x206a71;

/** E: goal ribbon letters cycle red / yellow / green with a white stroke; goal wire `0x3bc6d2`. */
export const GOAL_LETTERS = ['#df2d2d', '#e5ba0b', '#53b853'] as const;
export const GOAL_WIRE = 0x3bc6d2;

/** E: ball-shadow uniforms (materiallib): radius .5–.6 WU, darkness .8, falloff over 15 WU. */
export const SHADOW_RADIUS_M = 0.556;
export const SHADOW_DARKNESS = 0.8;
export const SHADOW_FALLOFF_M = 13.9;

/** E: 2013 world unit in metres (bundle-notes unit conversion). */
export const WU = 0.926;

/** Rail collider thickness in @wwm/physics (N there); the visual rail hugs the same box. */
export const RAIL_THICKNESS_M = 0.1;
/** @wwm/physics `bridgeOverlap`: flat aprons reach this far past the island edge (m). */
export const BRIDGE_APRON_OVERLAP_M = 0.3;
/** E: ocean plane 3000 WU wide at y = −200 WU (islands start ≈ 10 WU). */
export const GROUND_SIZE_M = 2778;
export const GROUND_BELOW_LOWEST_M = 194;
