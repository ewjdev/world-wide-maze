/**
 * @wwm/solver — plays generated stages with the real physics to prove they are playable (Phase 09).
 * planner (nav.ts + plan.ts) → pilot (pilot.ts, InputSample channel) → solveStage (solve.ts) →
 * validatePlayable / buildPlayableStage / difficultyStars (validate.ts) → ghost replays (ghost.ts).
 */
export {
  auditIslands,
  diagnoseNoRoute,
  FAILURE_KINDS,
  type FailureKind,
  type IslandIssue,
  type SolveFailure,
} from './diagnose.ts';
export { formatGhost, type GhostReplay, toGhostReplay } from './ghost.ts';
export {
  BALL_RADIUS_PX,
  buildNavGrid,
  cellCenter,
  cellOf,
  ELEVATOR_MIN_PLATFORM_PX,
  type ElevatorPortal,
  type NavGrid,
  type NavOptions,
  nearestWalkable,
  surfaceAt,
  walkable,
} from './nav.ts';
export { DEFAULT_GAINS, NEUTRAL, type PilotGains, steer } from './pilot.ts';
export {
  astar,
  DEFAULT_TUNING,
  type Leg,
  type LegVertex,
  type PlanRequest,
  type PlanTuning,
  planRoute,
  type Route,
  reachable,
} from './plan.ts';
export {
  DEFAULT_VARIANTS,
  type SolveAttempt,
  type SolveOptions,
  type SolveResult,
  type SolveVariant,
  setSimulationFactory,
  solveStage,
} from './solve.ts';
export {
  type BuildPlayableOptions,
  buildPlayableStage,
  difficultyStars,
  PAR_REJECT_SEC,
  PlayabilityError,
  type PlayableReport,
  type PlayableStage,
  type ValidatePlayableOptions,
  type ValidatePlayableResult,
  validatePlayable,
} from './validate.ts';
