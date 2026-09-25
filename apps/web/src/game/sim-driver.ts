/**
 * Two ways to drive the contract `Simulation` from the render loop.
 *
 * - `WorkerDriver` (default): `createWorkerSimulation()`. The worker free-runs at SIM_HZ on its own clock;
 *   each frame we hand it the latest input and get an interpolated ball plus every event since last frame.
 * - `LockstepDriver`: `createSimulation()` on the main thread with a fixed-step accumulator. Tick-exact and
 *   deterministic, so an injected replay (`InputSample[]` at SIM_HZ) reproduces the Node result exactly. Used
 *   for replays / e2e and as a fallback when workers are unavailable.
 *
 * `advance()` returns how much *simulated* time passed, which is what the game timer consumes.
 */
import { createSimulation, createWorkerSimulation, type WorkerSimulation } from '@wwm/physics';
import {
  type BallState,
  type InputSample,
  SIM_HZ,
  type SimEvent,
  type Simulation,
  type StageData,
  type Vec2,
} from '@wwm/schema';

export interface AdvanceResult {
  ball: BallState | null;
  /** Interpolation factor for `engine.setBall` (undefined = already interpolated). */
  alpha?: number;
  elevators: { id: number; y: number }[];
  /** Simulated seconds that elapsed. */
  simDt: number;
}

/**
 * Input for the next step. `tick` counts steps since `load()`; `dt` is the simulated time this input covers
 * (1/SIM_HZ in lockstep, the frame time for the worker). The game advances its timer here, so timer and sim
 * stay tick-aligned in lockstep (deterministic scores for replays).
 */
export type InputFn = (tick: number, dt: number) => InputSample;
/** Handle an event; return true to stop stepping for this frame (e.g. the phase changed). */
export type EventFn = (e: SimEvent) => boolean;

export interface SimDriver {
  readonly kind: 'worker' | 'lockstep';
  load(stage: StageData): Promise<void>;
  /** Step the sim for a render frame of `dt` seconds. */
  advance(dt: number, input: InputFn, onEvent: EventFn): AdvanceResult;
  reset(to?: Vec2): void;
  setPaused(p: boolean): void;
  /** Ticks stepped since the last `load()` (lockstep only; worker returns an estimate). */
  readonly tick: number;
  dispose(): void;
}

const H = 1 / SIM_HZ;

export class WorkerDriver implements SimDriver {
  readonly kind = 'worker' as const;
  #sim: WorkerSimulation;
  #paused = true;
  #t = 0;
  constructor(sim: WorkerSimulation) {
    this.#sim = sim;
    sim.setPaused(true);
  }
  get tick() {
    return Math.round(this.#t * SIM_HZ);
  }
  async load(stage: StageData) {
    this.#sim.setPaused(true);
    this.#paused = true;
    await this.#sim.load(stage);
    this.#t = 0;
  }
  advance(dt: number, input: InputFn, onEvent: EventFn): AdvanceResult {
    if (this.#paused) return { ball: null, elevators: [], simDt: 0 };
    const r = this.#sim.step(input(this.tick, dt));
    this.#t += dt;
    for (const e of r.events) if (onEvent(e)) break;
    return { ball: r.ball, elevators: r.elevators, simDt: dt };
  }
  reset(to?: Vec2) {
    this.#sim.reset(to);
  }
  setPaused(p: boolean) {
    if (p === this.#paused) return;
    this.#paused = p;
    this.#sim.setPaused(p);
  }
  dispose() {
    this.#sim.dispose();
  }
}

export class LockstepDriver implements SimDriver {
  readonly kind = 'lockstep' as const;
  #sim: Simulation;
  #acc = 0;
  #tick = 0;
  #paused = true;
  #last: { ball: BallState; elevators: { id: number; y: number }[] } | null = null;
  constructor(sim: Simulation) {
    this.#sim = sim;
  }
  get tick() {
    return this.#tick;
  }
  async load(stage: StageData) {
    await this.#sim.load(stage);
    this.#acc = 0;
    this.#tick = 0;
    this.#last = null;
  }
  advance(dt: number, input: InputFn, onEvent: EventFn): AdvanceResult {
    if (this.#paused) return { ball: null, elevators: [], simDt: 0 };
    this.#acc += dt;
    let steps = 0;
    // Never spiral: at most 1/4 s of catch-up per frame.
    const max = Math.ceil(SIM_HZ / 4);
    while (this.#acc >= H && steps < max) {
      const r = this.#sim.step(input(this.#tick, H));
      this.#tick++;
      steps++;
      this.#acc -= H;
      this.#last = { ball: r.ball, elevators: r.elevators };
      let stop = false;
      for (const e of r.events) if (onEvent(e)) stop = true;
      if (stop || this.#paused) {
        this.#acc = 0;
        break;
      }
    }
    if (steps >= max) this.#acc = 0;
    return {
      ball: this.#last?.ball ?? null,
      alpha: this.#acc / H,
      elevators: this.#last?.elevators ?? [],
      simDt: steps * H,
    };
  }
  reset(to?: Vec2) {
    this.#sim.reset(to);
    this.#acc = 0;
  }
  setPaused(p: boolean) {
    this.#paused = p;
    if (p) this.#acc = 0;
  }
  dispose() {
    this.#sim.dispose();
  }
}

export async function createDriver(kind: 'worker' | 'lockstep'): Promise<SimDriver> {
  if (kind === 'worker' && typeof Worker !== 'undefined') {
    try {
      return new WorkerDriver(await createWorkerSimulation());
    } catch (e) {
      console.warn('[wwm] physics worker unavailable, running on the main thread', e);
    }
  }
  return new LockstepDriver(await createSimulation());
}
