/**
 * Every physics tunable, in SI per-second units (never per-tick), each labelled:
 *   E = evidenced by the recovered 2013 build (docs/reference/fidelity-spec.md §1–2, §4; bundle-notes.md)
 *   R = reconstructed (inferred from evidence, reasoning in the comment)
 *   N = new (our choice; no 2013 equivalent or a deliberate change)
 *
 * The 2013 game ran Bullet (ammo.js via Physijs) at a fixed 60 Hz. Per-tick factors were converted to
 * per-second rates so the same feel holds at SIM_HZ = 120 (and at the 60 Hz parity mode, `simHz: 60`).
 */
import {
  BALL_RADIUS_M,
  ELEVATOR_COOLDOWN_SEC,
  FALL_DEPTH_M,
  FALL_LOST_DELAY_SEC,
  GOAL_SENSOR_HEIGHT_M,
  GRAVITY_MPS2,
  ITEM_PICKUP_RADIUS_M,
  JUMP_DELTA_V_MPS,
  JUMP_GRACE_SEC,
  KEYBOARD_TILT,
  MAX_TILT_PITCH,
  MAX_TILT_ROLL,
  PX_PER_METER,
  SIM_HZ,
} from '@wwm/schema';

export interface PhysicsParams {
  /** Fixed step rate. Contract: SIM_HZ (120). 60 = strict 2013 parity mode for A/B feel tests (sandbox only). */
  simHz: number;

  // ── gravity & tilt ──
  /** E: 50 WU/s² × 0.926 m/WU. */
  gravity: number;
  /** E: gravity tweens to ×2 over `fallGravityRampSec` once FALLING starts. */
  fallGravityScale: number;
  /** E: 1 s tween (easing unknown → linear, R). */
  fallGravityRampSec: number;
  /** E: phone roll limit ±20° — but the keyboard allows ±25° (KEYBOARD_TILT), so the sim clamps to the larger. */
  maxTiltRoll: number;
  /** E: phone pitch limit ±45°. */
  maxTiltPitch: number;
  /** E: slerp 0.09 per 60 Hz tick → τ = −(1/60)/ln(0.91) ≈ 0.177 s. Target-tilt smoothing time constant. */
  tiltTau: number;
  /** N: optional direct torque assist (N·m per rad of tilt) — 0 = faithful pure gravity-rotation model. */
  torqueAssist: number;

  // ── ball ──
  /** Contract BALL_RADIUS_M (2013: 0.54 WU). */
  ballRadius: number;
  /** E: mass 1. */
  ballMass: number;
  /** E: ballFriction .95. */
  ballFriction: number;
  /** E: ballRestitution .35. */
  ballRestitution: number;
  /** E: 0.7 active & inactive; Bullet v·(1−0.7)^dt → −ln(0.3) = 1.204 /s. */
  linearDamping: number;
  /** E: 0.7 while POWER held → 1.204 /s. */
  angularDampingActive: number;
  /** E: 0.99 without POWER → −ln(0.01) = 4.605 /s (brakes). */
  angularDampingInactive: number;

  // ── surfaces ──
  /** E: floorFriction .95 (islands, bridges, elevator decks). */
  floorFriction: number;
  /** E: floorRestitution .7. */
  floorRestitution: number;
  /** E: guardrailFriction .5. */
  railFriction: number;
  /** E: guardrailRestitution .7. */
  railRestitution: number;
  /** E: island slab 0.5 WU thick (side wall from level down to level − 0.5 WU). */
  slabThickness: number;
  /** R: rails are a collider from the surface up to this height (2013: a 0.5–0.6 WU ribbon; a solid wall is safer). */
  railHeight: number;
  /** N: rail collider thickness (2013 ribbons had zero thickness). */
  railThickness: number;
  /** N: flat bridge decks overlap their islands by this much so no seam opens at the mouth. */
  bridgeOverlap: number;

  // ── jump ──
  /** E: jumpPower 180 × WORLD_SCALE = 18 WU/s → 16.7 m/s (applied as a central impulse, so Δv with mass 1). */
  jumpDeltaV: number;
  /** E: must have touched anything within the last 100 ms. */
  jumpGraceSec: number;
  /** N: a jump consumes the grace window (no double impulse from two presses within 100 ms). */
  jumpConsumesGrace: boolean;

  // ── sensors ──
  /** E: ghost sphere r 1 WU. */
  itemRadius: number;
  /** E: centred 0.54 WU above the surface → one ball radius. */
  itemHeight: number;
  /** E: ghost cylinder h 2 WU (radius comes from StageData.goal.radius). */
  goalHeight: number;

  // ── elevators ──
  /** E: platform length max(distance, 15 px of the 1024-px 2013 stage) → 15 × 1.25 = 18.75 px. */
  elevatorMinPlatformPx: number;
  /** E: cooldown after arrival. StageData.elevators[].cooldownSec wins if present. */
  elevatorCooldownSec: number;
  /** R: a sensor end counts as "touched" when the ball centre is over the platform footprint and within this
   *  height above the deck (2013: invisible sensor boxes at the ends). */
  elevatorSensorHeight: number;

  // ── falls ──
  /** E (CD-10): 'fell' when ball.y < lowest island top − FALL_DEPTH_M. */
  fallDepth: number;
  /** E: 'lost' this long after 'fell'. */
  fallLostDelaySec: number;

  // ── events ──
  /** N: minimum impact speed (m/s, along the contact normal) for `landed` / `bump`. */
  impactMinSpeed: number;
  /** N: contact normal · up above this = ground (also BallState.grounded). */
  groundNormalY: number;
  /** N: `landed` only after at least this long without any contact. */
  landedMinAirSec: number;
  /** N: contacts with a gap below this count as touching (Rapier reports predicted contacts too). */
  touchDistance: number;

  // ── solver ──
  /** N: Rapier solver iterations (default 4). */
  solverIterations: number;
}

const WU = 0.926; // m per 2013 world unit (BALL_RADIUS_M / 0.54)

export const DEFAULT_PARAMS: Readonly<PhysicsParams> = Object.freeze({
  simHz: SIM_HZ,
  gravity: GRAVITY_MPS2,
  fallGravityScale: 2,
  fallGravityRampSec: 1,
  maxTiltRoll: Math.max(MAX_TILT_ROLL, KEYBOARD_TILT),
  maxTiltPitch: Math.max(MAX_TILT_PITCH, KEYBOARD_TILT),
  tiltTau: 0.17672088421066812, // −(1/60)/ln(0.91); literal so every JS engine agrees bit-for-bit
  torqueAssist: 0,

  ballRadius: BALL_RADIUS_M,
  ballMass: 1,
  ballFriction: 0.95,
  ballRestitution: 0.35,
  linearDamping: 1.2039728043259361, // −ln(0.3)
  angularDampingActive: 1.2039728043259361, // −ln(0.3)
  angularDampingInactive: 4.605170185988091, // −ln(0.01)

  floorFriction: 0.95,
  floorRestitution: 0.7,
  railFriction: 0.5,
  railRestitution: 0.7,
  slabThickness: 0.5 * WU,
  railHeight: 0.6 * WU,
  railThickness: 0.1,
  bridgeOverlap: 0.3,

  jumpDeltaV: JUMP_DELTA_V_MPS,
  jumpGraceSec: JUMP_GRACE_SEC,
  jumpConsumesGrace: true,

  itemRadius: ITEM_PICKUP_RADIUS_M,
  itemHeight: BALL_RADIUS_M,
  goalHeight: GOAL_SENSOR_HEIGHT_M,

  elevatorMinPlatformPx: 15 * (PX_PER_METER / 10.8),
  elevatorCooldownSec: ELEVATOR_COOLDOWN_SEC,
  elevatorSensorHeight: 1.2,

  fallDepth: FALL_DEPTH_M,
  fallLostDelaySec: FALL_LOST_DELAY_SEC,

  impactMinSpeed: 1,
  groundNormalY: 0.6,
  landedMinAirSec: 0.1,
  touchDistance: 0.02,

  solverIterations: 4,
});

/** Label of each param for the sandbox / docs: E evidenced, R reconstructed, N new. */
export const PARAM_LABELS: Readonly<Record<keyof PhysicsParams, 'E' | 'R' | 'N'>> = Object.freeze({
  simHz: 'N',
  gravity: 'E',
  fallGravityScale: 'E',
  fallGravityRampSec: 'E',
  maxTiltRoll: 'E',
  maxTiltPitch: 'E',
  tiltTau: 'E',
  torqueAssist: 'N',
  ballRadius: 'E',
  ballMass: 'E',
  ballFriction: 'E',
  ballRestitution: 'E',
  linearDamping: 'E',
  angularDampingActive: 'E',
  angularDampingInactive: 'E',
  floorFriction: 'E',
  floorRestitution: 'E',
  railFriction: 'E',
  railRestitution: 'E',
  slabThickness: 'E',
  railHeight: 'R',
  railThickness: 'N',
  bridgeOverlap: 'N',
  jumpDeltaV: 'E',
  jumpGraceSec: 'E',
  jumpConsumesGrace: 'N',
  itemRadius: 'E',
  itemHeight: 'E',
  goalHeight: 'E',
  elevatorMinPlatformPx: 'E',
  elevatorCooldownSec: 'E',
  elevatorSensorHeight: 'R',
  fallDepth: 'E',
  fallLostDelaySec: 'E',
  impactMinSpeed: 'N',
  groundNormalY: 'N',
  landedMinAirSec: 'N',
  touchDistance: 'N',
  solverIterations: 'N',
});

export function resolveParams(overrides?: Partial<PhysicsParams>): PhysicsParams {
  return { ...DEFAULT_PARAMS, ...overrides };
}

/**
 * Feel checks (tolerances for tests and the sandbox checklist). R: derived from the evidenced constants.
 * - jump apex ≈ 2.5 WU (≈ 2.3 m, 4.7 ball radii) with damping.
 * - max downhill acceleration on a 45°-tilted gravity ≈ 5/7 · g · sin 45° ≈ 23 m/s² for a rolling sphere.
 */
export const FEEL_CHECKS = Object.freeze({
  jumpApexM: 2.3,
  jumpApexTol: 0.35,
  maxDownhillAccel: (5 / 7) * GRAVITY_MPS2 * Math.SQRT1_2,
  maxDownhillAccelTol: 3,
});
