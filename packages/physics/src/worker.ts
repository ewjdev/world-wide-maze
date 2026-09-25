/**
 * Web Worker entry: owns a RapierSimulation and steps it at SIM_HZ against its own clock, so physics holds
 * 120 Hz even when rendering drops (as the 2013 Physijs worker held 60 Hz). Posts the latest state plus
 * every event after each batch of ticks. Input is latched: the newest InputSample is used for every tick
 * and jump edges are counted, so a press shorter than one tick is never lost.
 *
 * Stall guard: if the main thread stops sending input for STALL_MS (map/pause view, hidden tab), the clock
 * stops instead of catching up in a burst.
 */
import type { InputSample, SimEvent } from '@wwm/schema';
import { levelToWorldY } from '@wwm/schema/space';
import { replay } from './replay.ts';
import { RapierSimulation } from './simulation.ts';
import type { FromWorker, ToWorker } from './worker-protocol.ts';

const STALL_MS = 150;
const MAX_CATCHUP_TICKS = 24;

interface WorkerScope {
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  addEventListener(type: 'message', f: (e: MessageEvent<ToWorker>) => void): void;
}
const scope = self as unknown as WorkerScope;
const post = (m: FromWorker, transfer?: Transferable[]) => scope.postMessage(m, transfer);

let simP: Promise<RapierSimulation> | null = null;
let sim: RapierSimulation | null = null;
let loaded = false;
let paused = false;
let epoch = 0;
let input: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };
let pendingJumps = 0;
let jumpHeld = false; // the tick after a latched jump is sent with jump=false to re-arm the edge
let lastInputAt = 0;
let clock = 0; // performance.now() of the last simulated tick
let pendingEvents: SimEvent[] = [];
let stepMsAvg = 0;
let stepsWindow = 0;
let stepsPerSec = 0;
let windowStart = 0;

const absNow = (t: number) => performance.timeOrigin + t;

function postState(): void {
  if (!sim) return;
  const ball = sim.getBallState();
  const s = sim.stats();
  post({
    t: 'state',
    snap: { epoch, tick: s.tick, at: absNow(clock), ball, elevators: lastElevators },
    events: pendingEvents,
    stepMs: stepMsAvg,
    stepsPerSec,
  });
  pendingEvents = [];
}

let lastElevators: { id: number; y: number }[] = [];

function loop(): void {
  const now = performance.now();
  if (sim && loaded && !paused && now - lastInputAt <= STALL_MS) {
    const dtMs = 1000 / sim.params.simHz;
    let n = 0;
    while (clock + dtMs <= now && n < MAX_CATCHUP_TICKS) {
      let jump = false;
      if (jumpHeld) jumpHeld = false;
      else if (pendingJumps > 0) {
        pendingJumps--;
        jump = true;
        jumpHeld = true;
      }
      const r = sim.step({ ...input, jump });
      stepMsAvg = stepMsAvg * 0.95 + sim.stats().lastStepMs * 0.05;
      lastElevators = r.elevators;
      for (const e of r.events) pendingEvents.push(e);
      clock += dtMs;
      n++;
    }
    if (n === MAX_CATCHUP_TICKS) clock = now; // too far behind: drop time rather than spiral
    stepsWindow += n;
    if (now - windowStart >= 1000) {
      stepsPerSec = (stepsWindow * 1000) / (now - windowStart);
      stepsWindow = 0;
      windowStart = now;
    }
    if (n > 0) postState();
  } else {
    clock = now;
  }
  setTimeout(loop, 2);
}

async function handle(m: ToWorker): Promise<void> {
  switch (m.t) {
    case 'init':
      simP = RapierSimulation.create({ params: m.params, rapier: m.rapier });
      sim = await simP;
      windowStart = performance.now();
      loop();
      post({ t: 'ready' });
      return;
    case 'load': {
      const s = sim ?? (await simP);
      if (!s) throw new Error('worker: init first');
      await s.load(m.stage);
      loaded = true;
      epoch++;
      pendingEvents = [];
      pendingJumps = 0;
      clock = performance.now();
      windowStart = clock;
      stepsWindow = 0;
      lastElevators = m.stage.elevators.map((e) => ({ id: e.id, y: levelToWorldY(e.levelLow) }));
      post({ t: 'loaded', id: m.id });
      postState();
      return;
    }
    case 'input':
      input = m.input;
      pendingJumps += m.jumps;
      if (!paused && performance.now() - lastInputAt > STALL_MS) clock = performance.now();
      lastInputAt = performance.now();
      return;
    case 'reset':
      if (!sim || !loaded) return;
      sim.reset(m.to);
      epoch++;
      pendingJumps = 0;
      postState();
      return;
    case 'pause':
      paused = m.paused;
      clock = performance.now();
      return;
    case 'replay': {
      const s = sim ?? (await simP);
      const result = await replay(m.stage, m.inputs, { params: s?.params });
      post({ t: 'replayResult', id: m.id, result });
      return;
    }
    case 'debug': {
      const d = sim?.debugLines() ?? { vertices: new Float32Array(), colors: new Float32Array() };
      post({ t: 'debug', id: m.id, vertices: d.vertices, colors: d.colors }, [
        d.vertices.buffer,
        d.colors.buffer,
      ]);
      return;
    }
  }
}

scope.addEventListener('message', (e) => {
  handle(e.data).catch((err: unknown) => {
    const id = 'id' in e.data ? (e.data as { id: number }).id : undefined;
    post({ t: 'error', id, message: err instanceof Error ? err.message : String(err) });
  });
});
