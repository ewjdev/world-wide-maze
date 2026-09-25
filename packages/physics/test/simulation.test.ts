import { FALL_LOST_DELAY_SEC, type InputSample, SIM_HZ, type SimEvent, type StageData } from '@wwm/schema';
import { pxToMeters } from '@wwm/schema/space';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DEFAULT_PARAMS, FEEL_CHECKS } from '../src/params.ts';
import { createSimulation, type RapierSimulation } from '../src/simulation.ts';
import { HANDMADE, island, makeStage, rect } from './helpers/stages.ts';

const IDLE: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };
const R = DEFAULT_PARAMS.ballRadius;

/** A 1000 × 1000 px flat plate (74 m square) at level 0, railed except on its east edge, where a +3 m
 *  island (no rails) starts. */
const FEEL: StageData = makeStage({
  islands: [
    island(0, rect(0, 0, 1000, 1000), 0, {
      restartPoints: [[500, 500]],
      guardrails: [
        [
          [1000, 1000],
          [0, 1000],
          [0, 0],
          [1000, 0],
        ],
      ],
    }),
    island(1, rect(1000, 0, 200, 400), 3, { guardrails: [] }),
  ],
  start: [500, 500],
  width: 1600,
});

function run(sim: RapierSimulation, n: number, input: Partial<InputSample> = {}): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...sim.step({ ...IDLE, ...input }).events);
  return events;
}

let sim: RapierSimulation;
beforeAll(async () => {
  sim = await createSimulation();
});
afterAll(() => sim.dispose());

describe('tilt = rotation of gravity (E)', () => {
  test('ball settles at rest on the start point', async () => {
    await sim.load(FEEL);
    run(sim, 60);
    const b = sim.getBallState();
    expect(b.pos[1]).toBeCloseTo(R, 2);
    expect(Math.hypot(...b.vel)).toBeLessThan(0.05);
    expect(b.grounded).toBe(true);
  });

  test.each([
    [0, [0, -1]],
    [Math.PI / 2, [-1, 0]],
    [Math.PI, [0, 1]],
    [-Math.PI / 2, [1, 0]],
  ] as const)('frameYaw %f: +tiltZ rolls the ball "forward" = (−sin ψ, −cos ψ)', async (yaw, dir) => {
    await sim.load(FEEL);
    run(sim, 10);
    run(sim, 60, { power: true, tiltZ: 0.3, frameYaw: yaw });
    const v = sim.getBallState().vel;
    expect(v[0] * dir[0] + v[2] * dir[1]).toBeGreaterThan(2);
    expect(Math.abs(v[0] * dir[1] - v[2] * dir[0])).toBeLessThan(0.05);
  });

  test('+tiltX rolls right (frameYaw 0 ⇒ +X)', async () => {
    await sim.load(FEEL);
    run(sim, 60, { power: true, tiltX: 0.3 });
    expect(sim.getBallState().vel[0]).toBeGreaterThan(2);
  });

  test('without POWER the tilt is ignored (E)', async () => {
    await sim.load(FEEL);
    run(sim, 120, { power: false, tiltZ: 0.6, tiltX: 0.3 });
    expect(Math.hypot(...sim.getBallState().vel)).toBeLessThan(0.05);
  });

  test('tilt is smoothed with τ ≈ 0.18 s: 1 tick in, the ball barely moves', async () => {
    await sim.load(FEEL);
    run(sim, 10);
    run(sim, 1, { power: true, tiltZ: 0.785 });
    const v1 = Math.hypot(...sim.getBallState().vel);
    expect(v1).toBeLessThan(0.02);
  });

  test(`max downhill acceleration at 45° ≈ 5/7·g·sin45° ≈ ${FEEL_CHECKS.maxDownhillAccel.toFixed(1)} m/s²`, async () => {
    await sim.load(FEEL);
    run(sim, 10);
    run(sim, 120, { power: true, tiltZ: 0.785 }); // smoothing converged (>5 τ)
    sim.setBallState([pxToMeters(500), R, pxToMeters(900)], [0, 0, 0]);
    run(sim, 1, { power: true, tiltZ: 0.785 });
    const v0 = sim.getBallState().vel[2];
    run(sim, 12, { power: true, tiltZ: 0.785 });
    const a = -(sim.getBallState().vel[2] - v0) / (12 / SIM_HZ);
    expect(Math.abs(a - FEEL_CHECKS.maxDownhillAccel)).toBeLessThan(FEEL_CHECKS.maxDownhillAccelTol);
  });
});

describe('jump (E)', () => {
  test(`apex ≈ ${FEEL_CHECKS.jumpApexM} m with damping`, async () => {
    await sim.load(FEEL);
    run(sim, 30);
    run(sim, 1, { jump: true });
    let apex = 0;
    for (let i = 0; i < 90; i++) apex = Math.max(apex, sim.step(IDLE).ball.pos[1] - R);
    expect(Math.abs(apex - FEEL_CHECKS.jumpApexM)).toBeLessThan(FEEL_CHECKS.jumpApexTol);
  });

  test('POWER is not required, but a contact within 100 ms is', async () => {
    await sim.load(FEEL);
    run(sim, 30);
    sim.setBallState([pxToMeters(500), 6, pxToMeters(500)]);
    run(sim, 15); // > 100 ms since the last contact
    run(sim, 1, { jump: true });
    expect(sim.getBallState().vel[1]).toBeLessThan(0); // no impulse in mid-air
  });

  test('coyote time: jumping ≤ 100 ms after leaving the ground still works', async () => {
    await sim.load(FEEL);
    run(sim, 30);
    sim.setBallState([pxToMeters(500), R + 0.3, pxToMeters(500)]);
    run(sim, 1); // just left the ground (the previous tick touched)
    run(sim, 1, { jump: true });
    expect(sim.getBallState().vel[1]).toBeGreaterThan(10);
  });

  test('edge-triggered: holding jump fires once', async () => {
    await sim.load(FEEL);
    run(sim, 30);
    let maxY = 0;
    for (let i = 0; i < 200; i++) maxY = Math.max(maxY, sim.step({ ...IDLE, jump: true }).ball.pos[1]);
    expect(maxY).toBeLessThan(R + FEEL_CHECKS.jumpApexM + FEEL_CHECKS.jumpApexTol);
    // after landing, still held → still no second jump
    expect(sim.getBallState().pos[1]).toBeCloseTo(R, 1);
  });

  test('cannot jump onto a +3 m island', async () => {
    await sim.load(FEEL);
    sim.setBallState([pxToMeters(990) - R, R, pxToMeters(200)]);
    run(sim, 10);
    let onTop = false;
    for (let i = 0; i < 3 * SIM_HZ; i++) {
      const b = sim.step({ ...IDLE, power: true, tiltX: 0.436, jump: i % 40 === 0 }).ball;
      if (b.pos[0] > pxToMeters(1000) && b.pos[1] > 3) onTop = true;
    }
    expect(onTop).toBe(false);
  });
});

describe('POWER release brakes (E: angular damping 4.61/s)', () => {
  test('releasing POWER stops the ball much sooner than coasting with POWER held', async () => {
    const coast = async (power: boolean) => {
      await sim.load(FEEL);
      run(sim, 10);
      sim.setBallState([pxToMeters(500), R, pxToMeters(900)], [0, 0, -8]);
      sim.step({ ...IDLE, power });
      const start = sim.getBallState().pos[2];
      run(sim, 5 * SIM_HZ, { power });
      return start - sim.getBallState().pos[2];
    };
    const braked = await coast(false);
    const held = await coast(true);
    expect(braked).toBeLessThan(held * 0.8);
    expect(braked).toBeLessThan(6); // "stops within reasonable distance" from 8 m/s
    expect(Math.abs(sim.getBallState().vel[2])).toBeLessThan(0.1);
  });
});

describe('rails', () => {
  test('bounce off a rail without trapping (restitution 0.7 × 0.35, Multiply)', async () => {
    await sim.load(FEEL);
    run(sim, 10);
    sim.setBallState([pxToMeters(500), R, 1.2], [0, 0, -10]);
    const events: SimEvent[] = [];
    let minZ = Number.POSITIVE_INFINITY;
    let bounced = false;
    for (let i = 0; i < 60; i++) {
      const r = sim.step({ ...IDLE, power: true });
      events.push(...r.events);
      minZ = Math.min(minZ, r.ball.pos[2]);
      if (r.ball.vel[2] > 0.5) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(events.some((e) => e.type === 'bump')).toBe(true);
    expect(minZ).toBeGreaterThan(R - 0.05); // never inside the rail (inner face on the edge line z = 0)
    // not trapped: tilting away (backwards = +Z at frameYaw 0) rolls it off the rail
    run(sim, SIM_HZ, { power: true, tiltZ: -0.4 });
    expect(sim.getBallState().vel[2]).toBeGreaterThan(1);
  });
});

describe('falls, restart (E)', () => {
  test('fell → restartAt on the last-touched island, lost after 3 s, reset() respawns', async () => {
    await sim.load(FEEL);
    run(sim, 20);
    // throw the ball over the rail
    sim.setBallState([pxToMeters(960), 2.5, pxToMeters(500)], [12, 4, 0]);
    const events: { tick: number; e: SimEvent }[] = [];
    for (let i = 1; i <= 8 * SIM_HZ; i++) for (const e of sim.step(IDLE).events) events.push({ tick: i, e });
    const fell = events.find((x) => x.e.type === 'fell');
    const lost = events.find((x) => x.e.type === 'lost');
    expect(fell?.e).toEqual({ type: 'fell', restartAt: [500, 500] });
    expect(lost).toBeDefined();
    expect((lost?.tick ?? 0) - (fell?.tick ?? 0)).toBe(FALL_LOST_DELAY_SEC * SIM_HZ);
    expect(events.filter((x) => x.e.type === 'fell')).toHaveLength(1);
    sim.reset([500, 500]);
    run(sim, 30);
    const b = sim.getBallState();
    expect(b.pos[0]).toBeCloseTo(pxToMeters(500), 2);
    expect(b.pos[1]).toBeCloseTo(R, 2);
    expect(b.grounded).toBe(true);
  });

  test('input is ignored while falling and gravity doubles', async () => {
    await sim.load(FEEL);
    sim.setBallState([pxToMeters(500), -12, pxToMeters(500)], [0, 0, 0]);
    const r = sim.step({ ...IDLE, power: true, tiltZ: 0.7 });
    expect(r.events[0]?.type).toBe('fell');
    run(sim, SIM_HZ + 1, { power: true, tiltZ: 0.7 });
    const v1 = sim.getBallState().vel;
    run(sim, 12, { power: true, tiltZ: 0.7 });
    const v2 = sim.getBallState().vel;
    expect(Math.abs(v2[2])).toBeLessThan(Math.abs(v1[2])); // tilt eased to 0: no further sideways push
    const a = -(v2[1] - v1[1]) * 10; // over 0.1 s
    // 92.6 m/s² minus linear damping (1.2/s · |v|)
    expect(a + 1.204 * -v1[1]).toBeGreaterThan(85);
  });
});

describe('handmade-simple events', () => {
  test('island event on first contact with the start island', async () => {
    await sim.load(HANDMADE);
    const events = run(sim, 5);
    expect(events).toContainEqual({ type: 'island', islandId: HANDMADE.start.islandId });
  });

  test('an item fires exactly once even when the ball sits on it', async () => {
    await sim.load(HANDMADE);
    const it = HANDMADE.items[0];
    if (!it) throw new Error('items');
    sim.reset(it.pos);
    const events = run(sim, 240);
    expect(events.filter((e) => e.type === 'item')).toEqual([{ type: 'item', itemId: it.id, kind: it.kind }]);
  });

  test('goal fires once when entering the goal cylinder', async () => {
    await sim.load(HANDMADE);
    sim.reset(HANDMADE.goal.pos);
    const events = run(sim, 120);
    expect(events.filter((e) => e.type === 'goal')).toHaveLength(1);
  });

  test('elevator: trigger at the low end carries the ball up (velocity zeroed), start/end events, heights', async () => {
    await sim.load(HANDMADE);
    const e = HANDMADE.elevators[0];
    if (!e) throw new Error('elevator');
    sim.reset([380, 540]); // island 2, just east of the lower platform
    run(sim, 20);
    const ys: number[] = [];
    const events: SimEvent[] = [];
    for (let i = 0; i < 6 * SIM_HZ; i++) {
      const r = sim.step({ ...IDLE, power: true, tiltX: 0.3, frameYaw: Math.PI }); // yaw π: right = −X (west)
      events.push(...r.events);
      ys.push(r.elevators[0]?.y ?? Number.NaN);
      if (r.events.some((x) => x.type === 'elevator' && x.phase === 'end')) break;
    }
    expect(events.filter((x) => x.type === 'elevator')).toEqual([
      { type: 'elevator', elevatorId: e.id, phase: 'start' },
      { type: 'elevator', elevatorId: e.id, phase: 'end' },
    ]);
    const b = sim.getBallState();
    expect(b.pos[1]).toBeCloseTo(e.levelHigh + R, 1);
    expect(Math.hypot(...b.vel)).toBeLessThan(0.01);
    expect(Math.min(...ys)).toBeCloseTo(e.levelLow, 3);
    expect(Math.max(...ys)).toBeCloseTo(e.levelHigh, 3);
    // cooldown: sitting still on the platform does not re-trigger
    const after = run(sim, 3 * SIM_HZ);
    expect(after.filter((x) => x.type === 'elevator')).toHaveLength(0);
  });
});

describe('05b: low-rise elevators do not wedge the ball (BI-3)', () => {
  /** Low island (level 12) and high island (12 + rise) 9 px apart, a lift between them (footprint 18.75 px
   *  ending at the high island's edge, so the lower platform lies on the low island). */
  const liftStage = (rise: number): StageData =>
    makeStage({
      islands: [
        island(0, rect(40, 100, 100, 80), 12, {
          guardrails: [
            [
              [140, 160],
              [140, 180],
              [40, 180],
              [40, 100],
              [140, 100],
              [140, 120],
            ],
          ],
        }),
        island(1, rect(149, 100, 100, 80), 12 + rise, {
          guardrails: [
            [
              [149, 120],
              [149, 100],
              [249, 100],
              [249, 180],
              [149, 180],
              [149, 160],
            ],
          ],
        }),
      ],
      elevators: [
        {
          id: 0,
          islandFrom: 0,
          islandTo: 1,
          a: [140, 140],
          b: [149, 140],
          width: 40,
          levelLow: 12,
          levelHigh: 12 + rise,
          travelSec: 1 + 0.162 * rise,
          cooldownSec: 2,
        },
      ],
      start: [200, 140],
      startIsland: 1,
    });

  for (const rise of [0.5, 1.04, 6]) {
    test(`rise ${rise} D: ride down, then roll off the lower end`, async () => {
      const s = await createSimulation();
      await s.load(liftStage(rise));
      s.reset([200, 140]);
      const west = { ...IDLE, power: true, tiltX: 0.3, frameYaw: Math.PI }; // yaw π: right = −X (west)
      const phases: string[] = [];
      for (let t = 0; t < 8 * SIM_HZ && !phases.includes('end'); t++)
        for (const e of s.step(west).events) if (e.type === 'elevator') phases.push(e.phase);
      expect(phases).toEqual(['start', 'end']);
      const x0 = s.getBallState().pos[0];
      for (let i = 0; i < 3 * SIM_HZ; i++) s.step(west);
      const b = s.getBallState();
      // pre-05b, a rise < 1.463 D left the ball pinned under the returning partner platform with |v| = 0
      expect(x0 - b.pos[0]).toBeGreaterThan(pxToMeters(30));
      expect(b.pos[1]).toBeCloseTo(12 + R, 1);
      s.dispose();
    });
  }
});
