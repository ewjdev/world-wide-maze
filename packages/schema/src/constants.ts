/**
 * Shared constants (contracts §1). Values marked "contract" are copied verbatim from contracts.md;
 * the few marked "derived" are named in contracts.md prose/comments and given a constant here so nobody
 * hard-codes them. "E" = evidenced by the recovered 2013 build (docs/reference/fidelity-spec.md).
 */

/** Contract version implemented by this package (contracts.md header). */
export const CONTRACT_VERSION = '0.2.7';

// --- contract §1: scale --------------------------------------------------------------------------
/** 1 ball diameter = 1 m = 13.5 px (2013: 10.8 px of a 1024 stage). */
export const PX_PER_METER = 13.5;
export const BALL_RADIUS_M = 0.5;
/** `level` is a float in ball diameters (2013 island heights ≈ 9–23 D). */
export const LEVEL_HEIGHT_M = 1.0;
/** Max ramp slope |Δh| / horizontal length, 10° (E). */
export const MAX_RAMP_SLOPE = 0.1765; // tan 10° ≈ 0.17633 plus float tolerance (2013 ramps measure 0.17625–0.17643)
/** 2.5 D (2013 decks 1.6–3.6 D). */
export const MIN_BRIDGE_WIDTH_PX = 34;
/** 2 D. */
export const MIN_ISLAND_SIZE_PX = 27;
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;
/** Capture height cap (page CSS px). */
export const MAX_PAGE_HEIGHT_PX = 6000;
/** One stage slice ≈ 1.33 × width (2013: 1024 × 1358). Longer pages → more stages in a run. */
export const MAX_STAGE_HEIGHT_PX = 1700;
/** Screenshots at 2× for close-range sharpness. */
export const CAPTURE_DPR = 2;
/** At most this many large items per stage (E, case study). */
export const MAX_LARGE_ITEMS = 6;

// --- contract §1: simulation (E, converted from 2013 world units at 0.926 m/WU) -------------------
export const SIM_HZ = 120;
/** ×2 while falling. */
export const GRAVITY_MPS2 = 46.3;
export const JUMP_DELTA_V_MPS = 16.7;
/** Jump only if the ball touched something within this window. */
export const JUMP_GRACE_SEC = 0.1;
/** Phone pitch limit ±45°. */
export const MAX_TILT_PITCH = 0.785;
/** Phone roll limit ±20°. */
export const MAX_TILT_ROLL = 0.349;
/** Keyboard tilt ±25° on both axes. */
export const KEYBOARD_TILT = 0.436;
export const ITEM_PICKUP_RADIUS_M = 0.926;
export const GOAL_RADIUS_M = 0.926;
export const GOAL_SENSOR_HEIGHT_M = 1.85;
export const ELEVATOR_COOLDOWN_SEC = 2;
/** 'fell' when ball.y < (lowest island top − FALL_DEPTH_M). */
export const FALL_DEPTH_M = 9;
/** 'lost' fires this long after 'fell'. */
export const FALL_LOST_DELAY_SEC = 3;

// --- contract §1: rules (E, recovered common/config) ----------------------------------------------
/** Fixed per stage; resets on every respawn. */
export const TIME_LIMIT_SEC_DEFAULT = 300;
/** SPARE balls; game over when spares < 0 (4 attempts). */
export const NUM_BALLS = 3;
export const SMALL_SCORE = 1;
export const LARGE_SCORE = 100;
/** × remaining whole seconds at goal. */
export const TIME_SCORE = 5;
/** Each multiple crossed in the run total → +1 spare if spares < 3. */
export const ONEUP_SCORE = 3000;

// --- derived (named in contracts.md prose/comments) ----------------------------------------------
/** contracts §3 invariants: min clearance of items/restart points/start from the island edge, px (= 6.75). */
export const BALL_RADIUS_PX = BALL_RADIUS_M * PX_PER_METER;
/** contracts §9 (v0.1.0): bridge / elevator endpoints must be on, or within this many px of, their island. */
export const ENDPOINT_TOLERANCE_PX = 20;
/** Items are pickup zones: they may sit closer to the edge than the ball radius (2013 fixture: 3.75 px ≈ 0.28 D). */
export const ITEM_EDGE_CLEARANCE_PX = 0.25 * PX_PER_METER;
/** contracts §3 Elevator.travelSec default: 1 + ELEVATOR_TRAVEL_SEC_PER_M × Δh_m (cubicInOut). */
export const ELEVATOR_TRAVEL_BASE_SEC = 1;
export const ELEVATOR_TRAVEL_SEC_PER_M = 0.162;
/** contracts §6: host treats controller input as stale after this many ms. */
export const INPUT_STALE_MS = 250;
/** contracts §6: 6-digit room code. */
export const ROOM_CODE_LENGTH = 6;
/** contracts §5 (v0.2.2): shared world dimensions so renderer and physics agree. */
export const SLAB_THICKNESS_M = 0.463; // E: 0.5 WU island slab
export const RAIL_HEIGHT_M = 0.556; // R: rail collider/visual height; rails sit just OUTSIDE the edge line (and outside bridge deck width)
export const ELEVATOR_MIN_PLATFORM_PX = 18.75; // E: platform length = max(|b−a|, this) along a→b, ending at b

// --- contract §9 v0.2.7 --------------------------------------------------------------------------
/** CCR-12-3: `CaptureBundleSchema` size limits (a capture larger than this is rejected by `parseCapture`). */
export const CAPTURE_LIMITS = {
  elements: 20_000,
  title: 512,
  url: 2048,
  text: 120,
  linesPerElement: 200,
} as const;
/** CCR-12-2: pairing / host tokens are 128 random bits, base64url without padding (22 chars). */
export const ROOM_TOKEN_BYTES = 16;
/** CCR-12-2: WebSocket close code for a missing or invalid room token (contracts §9, next to 4400/4404/4409). */
export const ROOM_CLOSE_CODES = {
  badRequest: 4400,
  unauthorized: 4401,
  notFound: 4404,
  replaced: 4409,
} as const;
