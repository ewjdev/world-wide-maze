/**
 * `createWorkerSimulation()` — the contract `Simulation` backed by a Web Worker (worker.ts).
 *
 * The worker free-runs at SIM_HZ on its own clock. `step(input)` is therefore *non-blocking*: it forwards
 * the input (jump edges are counted so none are lost) and returns the ball state interpolated at
 * `now − interpDelayMs` between the two worker snapshots around that time, plus every event the worker
 * reported since the previous `step()` call. Call it once per rendered frame. Not tick-deterministic by
 * design (it follows wall time); use `createSimulation()` or `replayInWorker()` for deterministic runs.
 */
import type {
  BallState,
  InputSample,
  SimEvent,
  SimStepResult,
  Simulation,
  StageData,
  Vec2,
} from '@wwm/schema';
import { levelToWorldY } from '@wwm/schema/space';
import type { PhysicsParams } from './params.ts';
import type { RapierBuild } from './rapier.ts';
import type { ReplayResult } from './replay.ts';
import type { FromWorker, StateSnapshot, ToWorker } from './worker-protocol.ts';

export interface WorkerSimulationOptions {
  params?: Partial<PhysicsParams>;
  rapier?: RapierBuild;
  /** Render this far behind the newest worker state so there are two snapshots to blend (default 20 ms). */
  interpDelayMs?: number;
  /** Supply your own worker (tests, custom bundlers). Default: `new Worker(new URL('./worker.ts', …))`. */
  worker?: Worker;
}

export interface WorkerSimulation extends Simulation {
  /** Map view / pause: stop the worker clock (the stall guard also stops it if `step` isn't called). */
  setPaused(paused: boolean): void;
  /** Run a replay deterministically inside the worker (same code path as Node `replay`). */
  replayInWorker(stage: StageData, inputs: InputSample[]): Promise<ReplayResult>;
  /** Collider wireframe (line-segment endpoints xyz, rgba per vertex) of the loaded stage. */
  debugLines(): Promise<{ vertices: Float32Array; colors: Float32Array }>;
  /** Worker-side timing: mean step cost (ms, EMA) and achieved steps per second. */
  stats(): { stepMs: number; stepsPerSec: number; tick: number };
}

const ZERO_BALL: BallState = { pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], grounded: false };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blend(a: StateSnapshot, b: StateSnapshot, t: number): SimStepResult['ball'] {
  const qa = a.ball.quat;
  let qb = b.ball.quat;
  if (qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3] < 0)
    qb = [-qb[0], -qb[1], -qb[2], -qb[3]];
  const q: [number, number, number, number] = [
    lerp(qa[0], qb[0], t),
    lerp(qa[1], qb[1], t),
    lerp(qa[2], qb[2], t),
    lerp(qa[3], qb[3], t),
  ];
  const ql = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  return {
    pos: [
      lerp(a.ball.pos[0], b.ball.pos[0], t),
      lerp(a.ball.pos[1], b.ball.pos[1], t),
      lerp(a.ball.pos[2], b.ball.pos[2], t),
    ],
    quat: [q[0] / ql, q[1] / ql, q[2] / ql, q[3] / ql],
    vel: [
      lerp(a.ball.vel[0], b.ball.vel[0], t),
      lerp(a.ball.vel[1], b.ball.vel[1], t),
      lerp(a.ball.vel[2], b.ball.vel[2], t),
    ],
    grounded: t < 0.5 ? a.ball.grounded : b.ball.grounded,
  };
}

export async function createWorkerSimulation(opts: WorkerSimulationOptions = {}): Promise<WorkerSimulation> {
  const worker =
    opts.worker ??
    new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'wwm-physics' });
  const interpDelay = opts.interpDelayMs ?? 20;
  const send = (m: ToWorker) => worker.postMessage(m);

  let nextId = 1;
  const waiting = new Map<number, { resolve: (v: FromWorker) => void; reject: (e: Error) => void }>();
  let readyResolve: () => void = () => {};
  let readyReject: (e: Error) => void = () => {};
  const ready = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  const snaps: StateSnapshot[] = [];
  let epoch = -1;
  let events: SimEvent[] = [];
  let stepMs = 0;
  let stepsPerSec = 0;
  let prevJump = false;
  let jumps = 0;
  let disposed = false;

  worker.addEventListener('message', (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    switch (m.t) {
      case 'ready':
        readyResolve();
        return;
      case 'state':
        if (m.snap.epoch < epoch) return;
        if (m.snap.epoch > epoch) {
          epoch = m.snap.epoch;
          snaps.length = 0;
        }
        snaps.push(m.snap);
        if (snaps.length > 16) snaps.shift();
        for (const ev of m.events) events.push(ev);
        stepMs = m.stepMs;
        stepsPerSec = m.stepsPerSec;
        return;
      case 'error': {
        const w = m.id !== undefined ? waiting.get(m.id) : undefined;
        if (w && m.id !== undefined) {
          waiting.delete(m.id);
          w.reject(new Error(m.message));
        } else {
          readyReject(new Error(m.message));
          console.error('[wwm-physics worker]', m.message);
        }
        return;
      }
      default: {
        const w = waiting.get(m.id);
        if (w) {
          waiting.delete(m.id);
          w.resolve(m);
        }
      }
    }
  });
  worker.addEventListener('error', (e) =>
    readyReject(new Error(e.message || 'physics worker failed to start')),
  );

  const request = <T extends FromWorker>(make: (id: number) => ToWorker): Promise<T> => {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve: resolve as (v: FromWorker) => void, reject });
      send(make(id));
    });
  };

  send({ t: 'init', params: opts.params, rapier: opts.rapier });
  await ready;

  let lastStage: StageData | null = null;

  return {
    async load(stage: StageData) {
      lastStage = stage;
      events = [];
      await request((id) => ({ t: 'load', id, stage }));
    },
    step(input: InputSample): SimStepResult {
      if (disposed) throw new Error('@wwm/physics: disposed');
      if (input.jump && !prevJump) jumps++;
      prevJump = input.jump;
      send({ t: 'input', input: { ...input, jump: false }, jumps });
      jumps = 0;
      const out = events;
      events = [];
      const newest = snaps[snaps.length - 1];
      if (!newest) {
        const elevators = (lastStage?.elevators ?? []).map((el) => ({
          id: el.id,
          y: levelToWorldY(el.levelLow),
        }));
        return { ball: ZERO_BALL, events: out, elevators };
      }
      const rt = performance.timeOrigin + performance.now() - interpDelay;
      let ball = newest.ball;
      let elevators = newest.elevators;
      for (let i = snaps.length - 1; i > 0; i--) {
        const b = snaps[i] as StateSnapshot;
        const a = snaps[i - 1] as StateSnapshot;
        if (a.at <= rt && rt <= b.at) {
          const t = b.at > a.at ? (rt - a.at) / (b.at - a.at) : 1;
          ball = blend(a, b, t);
          elevators = b.elevators.map((el, k) => ({
            id: el.id,
            y: lerp(a.elevators[k]?.y ?? el.y, el.y, t),
          }));
          break;
        }
        if (i === 1 && rt < a.at) ball = a.ball;
      }
      return { ball, events: out, elevators };
    },
    reset(to?: Vec2) {
      send({ t: 'reset', to });
    },
    dispose() {
      disposed = true;
      worker.terminate();
      for (const w of waiting.values()) w.reject(new Error('disposed'));
      waiting.clear();
    },
    setPaused(paused: boolean) {
      send({ t: 'pause', paused });
    },
    async replayInWorker(stage: StageData, inputs: InputSample[]) {
      const m = await request<Extract<FromWorker, { t: 'replayResult' }>>((id) => ({
        t: 'replay',
        id,
        stage,
        inputs,
      }));
      return m.result;
    },
    async debugLines() {
      const m = await request<Extract<FromWorker, { t: 'debug' }>>((id) => ({ t: 'debug', id }));
      return { vertices: m.vertices, colors: m.colors };
    },
    stats() {
      return { stepMs, stepsPerSec, tick: snaps[snaps.length - 1]?.tick ?? 0 };
    },
  };
}
