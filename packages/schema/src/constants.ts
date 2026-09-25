/**
 * Shared constants (contracts.md §1). Values marked "contract" are copied verbatim from contracts.md;
 * the few marked "derived" are named in contracts.md prose/comments and given a constant here so nobody
 * hard-codes them.
 */

/** Contract version implemented by this package (contracts.md header). */
export const CONTRACT_VERSION = '0.1.0';

// --- contract §1 ---------------------------------------------------------------------------------
export const PX_PER_METER = 40; // ball diameter ≈ 40 page px
export const BALL_RADIUS_M = 0.5;
export const LEVEL_HEIGHT_M = 1.5; // one "level" step (the original islands had integer levels)
export const MIN_BRIDGE_WIDTH_PX = 100; // ≥ 2.5 × ball diameter
export const MIN_ISLAND_SIZE_PX = 120;
export const OCEAN_Y_M = -6; // below this = fell
export const SIM_HZ = 120;
// Faithful scoring from the recovered 2013 desktop bundle (common/config)
export const NUM_BALLS = 3;
export const SMALL_SCORE = 1;
export const LARGE_SCORE = 100;
export const TIME_SCORE = 5; // per remaining second at goal
export const ONEUP_SCORE = 3000;

// --- derived (named in contracts.md comments) ----------------------------------------------------
/** contracts §2: page height cap for captures. */
export const MAX_PAGE_HEIGHT_PX = 6000;
/** contracts §2: default capture viewport. */
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;
/** contracts §5: tilt clamp for `InputSample.tiltX/tiltZ`, radians. */
export const MAX_TILT = 0.44;
/** contracts §3 invariants: min clearance of items/restart points from the island edge, page px (= 20). */
export const BALL_RADIUS_PX = BALL_RADIUS_M * PX_PER_METER;
/** contracts §6: host treats controller input as stale after this many ms. */
export const INPUT_STALE_MS = 250;
/** contracts §6: 6-digit room code. */
export const ROOM_CODE_LENGTH = 6;
