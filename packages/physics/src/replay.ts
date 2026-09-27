/**
 * Replays: `InputSample[]` at SIM_HZ (contracts §5). `replay()` runs one headlessly and returns the event
 * stream (tagged with the tick it happened on) plus the final state. Deterministic: the same build + the
 * same StageData + the same inputs give the same result.
 */
import type {
  BallState,
  InputSample,
  LockSpec,
  SimEvent,
  SimStepResult,
  Simulation,
  StageData,
} from '@wwm/schema';
import { createSimulation, type LockableSimulation, type SimulationOptions } from './simulation.ts';

export interface TickedEvent {
  tick: number; // 1-based step index the event was emitted on
  event: SimEvent;
}

export interface ReplayResult {
  final: BallState;
  events: TickedEvent[];
  ticks: number;
  /** First tick with a 'goal' event, or -1. */
  goalTick: number;
}

export interface ReplayOptions extends SimulationOptions {
  /** Called after every step (e.g. to trace the path). Return `true` to stop early. */
  onStep?: (tick: number, r: SimStepResult) => boolean | undefined;
  /** Stop right after the goal event. */
  stopAtGoal?: boolean;
  /** Apply the contract's restart flow: on 'lost', `reset(restartAt)` (default true). */
  autoRestart?: boolean;
  /** contracts §10.4: runtime locks placed (closed) at load. Omit for every ranked replay. */
  locks?: LockSpec[];
  /** `setLock` calls, each applied right before step `tick` (1-based, like TickedEvent.tick). */
  lockTimeline?: LockChange[];
}

/** A scheduled `setLock(lockId, open)`, applied before step `tick`. */
export interface LockChange {
  tick: number;
  lockId: number;
  open: boolean;
}

/** Run `inputs` against a fresh simulation of `stage`. */
export async function replay(
  stage: StageData,
  inputs: readonly InputSample[],
  opts: ReplayOptions = {},
): Promise<ReplayResult> {
  const sim = await createSimulation(opts);
  try {
    await sim.load(stage, opts.locks ? { locks: opts.locks } : undefined);
    return runInputs(sim, inputs, opts);
  } finally {
    sim.dispose();
  }
}

/** Run `inputs` on an already-loaded simulation. */
export function runInputs(
  sim: Simulation,
  inputs: readonly InputSample[],
  opts: ReplayOptions = {},
): ReplayResult {
  const events: TickedEvent[] = [];
  let goalTick = -1;
  let last: SimStepResult | null = null;
  let restartAt: [number, number] | null = null;
  let tick = 0;
  const changes = opts.lockTimeline ? [...opts.lockTimeline].sort((a, b) => a.tick - b.tick) : [];
  if (changes.length > 0 && !('setLock' in sim)) throw new Error('replay: lockTimeline needs a lockable sim');
  let ci = 0;
  for (const input of inputs) {
    tick++;
    while (ci < changes.length && (changes[ci] as LockChange).tick <= tick) {
      const c = changes[ci++] as LockChange;
      (sim as LockableSimulation).setLock(c.lockId, c.open);
    }
    const r = sim.step(input);
    last = r;
    for (const event of r.events) {
      events.push({ tick, event });
      if (event.type === 'goal' && goalTick < 0) goalTick = tick;
      if (event.type === 'fell') restartAt = event.restartAt;
      if (event.type === 'lost' && opts.autoRestart !== false && restartAt) sim.reset(restartAt);
    }
    if (opts.onStep?.(tick, r)) break;
    if (opts.stopAtGoal && goalTick >= 0) break;
  }
  if (!last) throw new Error('replay: no inputs');
  return { final: last.ball, events, ticks: tick, goalTick };
}

/** Wrap a Simulation so every InputSample passed to `step` is recorded (a replay of the session). */
export function record(sim: Simulation): { sim: Simulation; inputs: InputSample[] } {
  const inputs: InputSample[] = [];
  const wrapped: Simulation = {
    load: (stage) => {
      inputs.length = 0;
      return sim.load(stage);
    },
    step: (input) => {
      inputs.push({ ...input });
      return sim.step(input);
    },
    reset: (to) => sim.reset(to),
    dispose: () => sim.dispose(),
  };
  return { sim: wrapped, inputs };
}
