/**
 * @wwm/physics — deterministic Rapier 3D simulation of the ball (contracts §5).
 * Headless (Node, solver, tests): `createSimulation()`. Game: `createWorkerSimulation()` (Web Worker).
 */
/**
 * Bump whenever collider geometry, params or step order change: replays (InputSample[]) are only
 * reproducible on the same physics version + Rapier build. Regenerate fixtures with `pnpm --filter @wwm/physics replay:make`.
 */
export const PHYSICS_VERSION = '0.1.0';
export { dcos, dsin } from './dmath.ts';
export {
  type BoxSpec,
  type ColliderRole,
  countTriangles,
  elevatorFootprint,
  type StaticSpec,
  staticSpecs,
} from './geometry.ts';
export { DEFAULT_PARAMS, FEEL_CHECKS, PARAM_LABELS, type PhysicsParams, resolveParams } from './params.ts';
export { loadRapier, type RapierBuild } from './rapier.ts';
export {
  type ReplayOptions,
  type ReplayResult,
  record,
  replay,
  runInputs,
  type TickedEvent,
} from './replay.ts';
export { createSimulation, RapierSimulation, type SimStats, type SimulationOptions } from './simulation.ts';
export {
  createWorkerSimulation,
  type WorkerSimulation,
  type WorkerSimulationOptions,
} from './worker-client.ts';
