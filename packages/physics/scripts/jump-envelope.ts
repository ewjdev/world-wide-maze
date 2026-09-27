/**
 * Phase 22 M0 spike: how high and how far can the ball get with POWER + JUMP? Measured with the real simulation.
 *
 *   node packages/physics/scripts/jump-envelope.ts [--json out.json]
 *
 * - apex: the highest the ball's *bottom* gets above a flat floor, jumping from rest and from full speed, with the
 *   gravity tilt at every combination of max pitch / roll (a tilted gravity has a smaller vertical component, so
 *   the jump goes higher than on a level board).
 * - envelope: run up at max forward tilt for `runUpSec`, jump before a cliff edge, keep full tilt in the air.
 *   D(Δh) = the farthest horizontal distance past the edge at which the ball bottom is still ≥ Δh (+ a rail height
 *   when the landing edge has a guardrail). Δh < 0 is a drop onto a lower island.
 */
import { writeFileSync } from 'node:fs';
import { type InputSample, SIM_HZ, type StageData } from '@wwm/schema';
import { pxToMeters } from '@wwm/schema/space';
import { DEFAULT_PARAMS } from '../src/params.ts';
import { createSimulation, type RapierSimulation } from '../src/simulation.ts';
import { island, makeStage, rect } from '../test/helpers/stages.ts';

const R = DEFAULT_PARAMS.ballRadius;
const RAIL = DEFAULT_PARAMS.railHeight;
const PITCH = DEFAULT_PARAMS.maxTiltPitch;
const ROLL = DEFAULT_PARAMS.maxTiltRoll;
// forward = (−sin ψ, −cos ψ): ψ = −π/2 rolls towards +X
const EAST = -Math.PI / 2;

/** A long plate (level 0, no rails) ending at x = EDGE_PX, plus nothing beyond: a cliff. */
const EDGE_PX = 4000;
const CLIFF: StageData = makeStage({
  islands: [island(0, rect(0, 0, EDGE_PX, 2000), 0, { guardrails: [], restartPoints: [[60, 1000]] })],
  start: [60, 1000],
  width: EDGE_PX + 2000,
  height: 2000,
});
const EDGE_M = pxToMeters(EDGE_PX);

function input(p: Partial<InputSample>): InputSample {
  return { tiltX: 0, tiltZ: 0, frameYaw: EAST, power: false, jump: false, ...p };
}

async function apex(sim: RapierSimulation, runUpSec: number, tiltZ: number, tiltX: number): Promise<number> {
  await sim.load(CLIFF);
  for (let i = 0; i < 30; i++) sim.step(input({}));
  const run = Math.round(runUpSec * SIM_HZ);
  for (let i = 0; i < run; i++) sim.step(input({ power: true, tiltZ, tiltX }));
  let best = 0;
  let jumped = false;
  for (let i = 0; i < 2 * SIM_HZ; i++) {
    const r = sim.step(input({ power: true, tiltZ, tiltX, jump: !jumped }));
    jumped = true;
    best = Math.max(best, r.ball.pos[1] - R);
  }
  return best;
}

interface Traj {
  runUpSec: number;
  speed: number;
  /** (x past the edge, ball-bottom y) samples after take-off */
  pts: [number, number][];
}

/** Run up, jump when the ball is `before` metres from the edge, and record the flight. */
async function flight(sim: RapierSimulation, runUpSec: number, before: number): Promise<Traj | null> {
  await sim.load(CLIFF);
  // start far enough back that the run-up ends near the edge: search the start in a first pass
  for (let i = 0; i < 30; i++) sim.step(input({}));
  const run = Math.round(runUpSec * SIM_HZ);
  // place the ball so that after the run-up it is roughly `before` short of the edge: run on a copy first
  let x = pxToMeters(60);
  let speed = 0;
  for (let i = 0; i < run; i++) {
    const r = sim.step(input({ power: true, tiltZ: PITCH }));
    x = r.ball.pos[0];
    speed = r.ball.vel[0];
  }
  const travelled = x - pxToMeters(60);
  const startX = EDGE_M - before - travelled;
  if (startX < 1) return null;
  await sim.load(CLIFF);
  sim.setBallState([startX, R + 0.001, pxToMeters(1000)]);
  for (let i = 0; i < 30; i++) sim.step(input({}));
  for (let i = 0; i < run; i++) {
    const r = sim.step(input({ power: true, tiltZ: PITCH }));
    speed = r.ball.vel[0];
  }
  const pts: [number, number][] = [];
  for (let i = 0; i < 3 * SIM_HZ; i++) {
    const r = sim.step(input({ power: true, tiltZ: PITCH, jump: i === 0 }));
    pts.push([r.ball.pos[0] - EDGE_M, r.ball.pos[1] - R]);
    if (r.ball.pos[1] < -14) break;
  }
  return { runUpSec, speed, pts };
}

/** Farthest x past the edge with ball bottom ≥ h, for a trajectory that left the edge above `clear`. */
function reach(t: Traj, h: number, clear: number): number {
  // the ball must pass the edge (x = 0) with its bottom ≥ clear
  let atEdge = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < t.pts.length; i++) {
    const [x0, y0] = t.pts[i - 1] as [number, number];
    const [x1, y1] = t.pts[i] as [number, number];
    if (x0 <= 0 && x1 >= 0) atEdge = x1 === x0 ? y1 : y0 + ((y1 - y0) * (0 - x0)) / (x1 - x0);
  }
  if (atEdge < clear) return Number.NaN;
  let best = Number.NaN;
  for (const [x, y] of t.pts) if (x > 0 && y >= h) best = Number.isNaN(best) ? x : Math.max(best, x);
  return best;
}

export interface Envelope {
  maxApexBottomM: number;
  /** Δh values (m, target floor − take-off floor) */
  dh: number[];
  /** by run-up seconds: take-off speed and D(Δh) with rails (clear 0.556 m at both edges) / open edges */
  byRunUp: Record<string, { speed: number; railed: number[]; open: number[] }>;
}

export async function measureEnvelope(log = false): Promise<Envelope> {
  const sim = await createSimulation();
  const apexRows: { runUpSec: number; tiltZ: number; tiltX: number; apexM: number }[] = [];
  for (const runUpSec of [0, 1, 3])
    for (const tz of [0, PITCH])
      for (const tx of [0, ROLL]) {
        apexRows.push({ runUpSec, tiltZ: tz, tiltX: tx, apexM: await apex(sim, runUpSec, tz, tx) });
      }
  const maxApex = Math.max(...apexRows.map((r) => r.apexM));
  if (log) {
    console.log(`max apex of the ball bottom: ${maxApex.toFixed(2)} m`);
    for (const r of apexRows)
      console.log(
        `  run-up ${r.runUpSec}s pitch ${r.tiltZ.toFixed(2)} roll ${r.tiltX.toFixed(2)} → ${r.apexM.toFixed(2)} m`,
      );
  }
  const hs = [2, 1.5, 1, 0.5, 0, -1, -2, -3, -4, -6, -8];
  const env: Envelope['byRunUp'] = {};
  for (const runUpSec of [0, 0.5, 1, 2, 4, 8]) {
    const railed = hs.map(() => Number.NaN);
    const open = hs.map(() => Number.NaN);
    let speed = 0;
    for (let before = 0; before <= 8; before += 0.25) {
      const t = await flight(sim, runUpSec, before);
      if (!t) continue;
      speed = t.speed;
      for (const [k, h] of hs.entries()) {
        const a = reach(t, h + RAIL, RAIL);
        const b = reach(t, h, 0);
        if (!Number.isNaN(a))
          railed[k] = Number.isNaN(railed[k] as number) ? a : Math.max(railed[k] as number, a);
        if (!Number.isNaN(b)) open[k] = Number.isNaN(open[k] as number) ? b : Math.max(open[k] as number, b);
      }
    }
    env[String(runUpSec)] = { speed, railed, open };
    if (log)
      console.log(
        `run-up ${runUpSec}s (take-off ${speed.toFixed(1)} m/s): D(Δh) railed / open, m:\n${hs
          .map(
            (h, k) =>
              `  Δh ${h.toFixed(1)}: ${(railed[k] as number).toFixed(2)} / ${(open[k] as number).toFixed(2)}`,
          )
          .join('\n')}`,
      );
  }
  sim.dispose();
  return { maxApexBottomM: maxApex, dh: hs, byRunUp: env };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await measureEnvelope(true);
  const i = process.argv.indexOf('--json');
  if (i > 0 && process.argv[i + 1])
    writeFileSync(process.argv[i + 1] as string, JSON.stringify(out, null, 2));
}
