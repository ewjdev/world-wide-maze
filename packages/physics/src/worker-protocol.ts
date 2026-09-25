/** Messages between `createWorkerSimulation()` (main thread) and `worker.ts`. Internal to @wwm/physics. */
import type { BallState, InputSample, SimEvent, StageData, Vec2 } from '@wwm/schema';
import type { PhysicsParams } from './params.ts';
import type { RapierBuild } from './rapier.ts';
import type { ReplayResult } from './replay.ts';

export type ToWorker =
  | { t: 'init'; params?: Partial<PhysicsParams>; rapier?: RapierBuild }
  | { t: 'load'; id: number; stage: StageData }
  /** Latest input; `jumps` = rising jump edges seen on the main thread since the previous message. */
  | { t: 'input'; input: InputSample; jumps: number }
  | { t: 'reset'; to?: Vec2 }
  | { t: 'pause'; paused: boolean }
  | { t: 'replay'; id: number; stage: StageData; inputs: InputSample[] }
  | { t: 'debug'; id: number };

export interface StateSnapshot {
  /** Increments on load/reset so the main thread drops stale snapshots. */
  epoch: number;
  tick: number;
  /** Absolute time (performance.timeOrigin + now, ms) the tick represents. */
  at: number;
  ball: BallState;
  elevators: { id: number; y: number }[];
}

export type FromWorker =
  | { t: 'ready' }
  | { t: 'loaded'; id: number }
  | { t: 'state'; snap: StateSnapshot; events: SimEvent[]; stepMs: number; stepsPerSec: number }
  | { t: 'replayResult'; id: number; result: ReplayResult }
  | { t: 'debug'; id: number; vertices: Float32Array; colors: Float32Array }
  | { t: 'error'; id?: number; message: string };
