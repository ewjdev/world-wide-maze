/**
 * Tunneling: at (2×) the max achievable speed, into a guardrail, into a bridge's side rail, and dropping onto
 * a bridge deck edge — 1,000 randomized trials, 0 tunnel-throughs allowed.
 */
import { type InputSample, mulberry32, SIM_HZ, type StageData } from '@wwm/schema';
import { pxToMeters } from '@wwm/schema/space';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DEFAULT_PARAMS } from '../src/params.ts';
import { createSimulation, type RapierSimulation } from '../src/simulation.ts';
import { island, makeStage, rect } from './helpers/stages.ts';

const R = DEFAULT_PARAMS.ballRadius;
const IDLE: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: true, jump: false };
const BRIDGE_Z = pxToMeters(550);
const BRIDGE_HALF_W = pxToMeters(40) / 2;
const BRIDGE_X0 = pxToMeters(1010);
const BRIDGE_X1 = pxToMeters(1290);

const STAGE: StageData = makeStage({
  islands: [
    island(0, rect(0, 0, 1000, 1000), 0, {
      guardrails: [
        [
          [1000, 570],
          [1000, 1000],
          [0, 1000],
          [0, 0],
          [1000, 0],
          [1000, 530],
        ],
      ],
    }),
    island(1, rect(1300, 400, 300, 300), 0),
  ],
  bridges: [
    { id: 0, from: 0, to: 1, a: [1000, 550], b: [1300, 550], width: 40, type: 'flat', levelA: 0, levelB: 0 },
  ],
  start: [500, 500],
  width: 1700,
});

let sim: RapierSimulation;
let vmax = 0;
beforeAll(async () => {
  sim = await createSimulation();
  await sim.load(STAGE);
  // Max achievable rolling speed: full 45° pitch for 4 s down the long axis of the plate.
  sim.setBallState([pxToMeters(500), R, pxToMeters(990)]);
  for (let i = 0; i < 4 * SIM_HZ; i++) {
    const r = sim.step({ ...IDLE, tiltZ: 0.785 });
    vmax = Math.max(vmax, Math.hypot(r.ball.vel[0], r.ball.vel[2]));
  }
});
afterAll(() => sim.dispose());

describe('tunneling (1,000 randomized trials)', () => {
  test('max achievable rolling speed is bounded (terminal velocity from damping)', () => {
    console.log(`[physics] max rolling speed at 45° tilt: ${vmax.toFixed(2)} m/s; trials use up to 2× that`);
    expect(vmax).toBeGreaterThan(8);
    expect(vmax).toBeLessThan(40);
  });

  test('500 × into a guardrail: 0 tunnel-throughs', () => {
    expect(guardrailTrials(sim, 500)).toBe(0);
  });

  test('250 × into a bridge side rail: 0 tunnel-throughs', () => {
    expect(bridgeRailTrials(sim, 250)).toBe(0);
  });

  test('250 × dropped onto a bridge deck edge at up to 80 m/s (> falling terminal speed): 0 tunnel-throughs', () => {
    expect(deckDropTrials(sim, 250)).toBe(0);
  });

  test('negative control: the detectors do fire when the rails / deck are missing', async () => {
    const bare = await createSimulation();
    await bare.load({ ...STAGE, bridges: [], islands: STAGE.islands.map((i) => ({ ...i, guardrails: [] })) });
    expect(guardrailTrials(bare, 20)).toBeGreaterThan(15);
    expect(deckDropTrials(bare, 20)).toBeGreaterThan(15);
    bare.dispose();
  });
});

function guardrailTrials(sim: RapierSimulation, n: number): number {
  const rnd = mulberry32(1234);
  let tunnels = 0;
  for (let t = 0; t < n; t++) {
    const z = 10 + rnd() * 50;
    const x = 0.8 + rnd() * 2;
    const speed = 5 + rnd() * (2 * vmax - 5);
    const ang = (rnd() - 0.5) * (Math.PI / 1.5); // ±60° around −X
    sim.setBallState([x, R, z], [-speed * Math.cos(ang), 0, speed * Math.sin(ang)]);
    for (let i = 0; i < 60; i++) {
      const b = sim.step(IDLE).ball;
      if (b.pos[0] < -0.05 && b.pos[1] - R < DEFAULT_PARAMS.railHeight) {
        tunnels++;
        break;
      }
    }
  }
  return tunnels;
}

function bridgeRailTrials(sim: RapierSimulation, n: number): number {
  const rnd = mulberry32(99);
  let tunnels = 0;
  for (let t = 0; t < n; t++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const x = BRIDGE_X0 + 2 + rnd() * (BRIDGE_X1 - BRIDGE_X0 - 4);
    const z = BRIDGE_Z + (rnd() - 0.5) * (2 * (BRIDGE_HALF_W - R - 0.1));
    const speed = 5 + rnd() * (2 * vmax - 5);
    const ang = (rnd() - 0.5) * (Math.PI / 1.5);
    sim.setBallState([x, R, z], [speed * Math.sin(ang), 0, side * speed * Math.cos(ang)]);
    for (let i = 0; i < 30; i++) {
      const b = sim.step(IDLE).ball;
      const over = b.pos[1] - R >= DEFAULT_PARAMS.railHeight - 0.05;
      if (
        Math.abs(b.pos[2] - BRIDGE_Z) > BRIDGE_HALF_W + 0.05 &&
        !over &&
        b.pos[0] > BRIDGE_X0 &&
        b.pos[0] < BRIDGE_X1
      ) {
        tunnels++;
        break;
      }
    }
  }
  return tunnels;
}

function deckDropTrials(sim: RapierSimulation, n: number): number {
  const rnd = mulberry32(7);
  let tunnels = 0;
  const deckBottom = -DEFAULT_PARAMS.slabThickness;
  for (let t = 0; t < n; t++) {
    const x = BRIDGE_X0 + 2 + rnd() * (BRIDGE_X1 - BRIDGE_X0 - 4);
    // bias towards the edges: |offset| ∈ [0.3, 1.0] of the half width
    const z = BRIDGE_Z + (rnd() < 0.5 ? -1 : 1) * (0.3 + 0.7 * rnd()) * (BRIDGE_HALF_W - R);
    const vy = -(5 + rnd() * 75);
    sim.setBallState([x, 3 + rnd() * 17, z], [(rnd() - 0.5) * 2, vy, (rnd() - 0.5) * 2]);
    let prev = sim.getBallState().pos;
    for (let i = 0; i < 90; i++) {
      const b = sim.step(IDLE).ball.pos;
      // Crossing the deck's bottom plane: where? Inside the deck footprint (not past its edge) ⇒ tunnel.
      if (prev[1] >= deckBottom && b[1] < deckBottom) {
        const u = (prev[1] - deckBottom) / (prev[1] - b[1]);
        const cx = prev[0] + (b[0] - prev[0]) * u;
        const cz = prev[2] + (b[2] - prev[2]) * u;
        if (Math.abs(cz - BRIDGE_Z) < BRIDGE_HALF_W - 0.1 && cx > BRIDGE_X0 && cx < BRIDGE_X1) tunnels++;
        break;
      }
      prev = b;
    }
  }
  return tunnels;
}
