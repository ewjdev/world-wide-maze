import { readFileSync } from 'node:fs';
import { type BallState, SIM_HZ, type SimStepResult, type StageData } from '@wwm/schema';
import { beforeEach, expect, test, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  ball: { pos: [0, 0.5, 0], vel: [8, 0, 0], quat: [0, 0, 0, 1], grounded: true } as BallState,
  events: [] as SimStepResult['events'],
  impulses: [] as number[][],
}));
vi.mock('@wwm/physics', () => ({
  createSimulation: async () => ({
    params: { ballRadius: 0.5 },
    load: async () => {},
    reset: () => {},
    dispose: () => {},
    setLock: () => {},
    getBallState: () => structuredClone(harness.ball),
    applyVelocityDelta: (v: number[]) => harness.impulses.push(v),
    step: () => ({ ball: structuredClone(harness.ball), events: harness.events, elevators: [] }),
  }),
}));

import { createRaceSimulation } from '../src/simulation.ts';
import type { RaceCourse } from '../src/types.ts';

const input = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: true, jump: false };
const stage: StageData = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
);
const course: RaceCourse = {
  schema: 'wwm.race-course/1',
  courseId: 'stack-test',
  title: 'Stack test',
  description: '',
  stage,
  textureUrl: '',
  generatorVersion: 'test',
  seed: 0,
  gates: [],
  stunts: {
    version: 1,
    cruiseSpeed: 8,
    chargeTicks: 3 * SIM_HZ,
    turboDeltaV: 8,
    turboMaxSpeed: 40,
    landingDeltaV: 0,
    launchPads: [],
  },
};
beforeEach(() => {
  harness.ball = { pos: [0, 0.5, 0], vel: [8, 0, 0], quat: [0, 0, 0, 1], grounded: true } as BallState;
  harness.events = [];
  harness.impulses = [];
});
test('every three seconds at full speed adds a turbo, including turns and flight', async () => {
  const sim = await createRaceSimulation(course);
  await sim.load(stage);
  for (let i = 0; i < 6 * SIM_HZ - 1; i++) {
    // Rotate velocity through a circle, then fly: no next-gate projection requirement.
    const a = i / 100;
    harness.ball.vel = [8 * Math.cos(a), 0, 8 * Math.sin(a)];
    harness.ball.grounded = i < 3 * SIM_HZ;
    sim.step(input);
  }
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 1, chargeTicks: 3 * SIM_HZ - 1 });
  sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 2, chargeTicks: 0, ready: true });
  for (let i = 0; i < 12 * SIM_HZ; i++) sim.step(input);
  expect(sim.getMechanics().turboCharges).toBe(6);
  sim.dispose();
});
test('slowing resets only the current charge; fresh presses spend one each without cooldown', async () => {
  const sim = await createRaceSimulation(course);
  for (let i = 0; i < 7 * SIM_HZ; i++) sim.step(input);
  harness.ball.vel = [0, 0, 0];
  sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 2, chargeTicks: 0 });
  sim.step({ ...input, turbo: true });
  expect(harness.impulses[0][0]).toBeCloseTo(0);
  expect(harness.impulses[0][2]).toBe(-8);
  expect(sim.getMechanics().turboCharges).toBe(1);
  sim.step({ ...input, turbo: true });
  expect(sim.getMechanics().turboCharges).toBe(1);
  sim.step(input);
  harness.ball.grounded = false;
  sim.step({ ...input, frameYaw: Math.PI / 2, turbo: true });
  expect(harness.impulses).toHaveLength(2);
  expect(harness.impulses[1][0]).toBeCloseTo(-8);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 0, ready: false });
  sim.dispose();
});
test('speed cap preserves a charge and does not count a held key as another press', async () => {
  const sim = await createRaceSimulation(course);
  for (let i = 0; i < 3 * SIM_HZ; i++) sim.step(input);
  harness.ball.vel = [40, 0, 0];
  sim.step({ ...input, turbo: true });
  expect(sim.getMechanics().turboCharges).toBe(1);
  harness.ball.vel = [8, 0, 0];
  sim.step({ ...input, turbo: true });
  expect(harness.impulses).toHaveLength(0);
  sim.step(input);
  sim.step({ ...input, turbo: true });
  expect(sim.getMechanics().turboCharges).toBe(0);
  sim.dispose();
});
test('each fall deducts exactly one turbo and life, deduplicates lost, and ends at zero', async () => {
  const sim = await createRaceSimulation(course);
  for (let i = 0; i < 9 * SIM_HZ; i++) sim.step(input);
  harness.events = [{ type: 'fell', restartAt: [0, 0] }];
  sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 2, lives: 2, exhausted: false });
  harness.events = [{ type: 'lost' }];
  sim.step(input);
  sim.penalizeRecovery();
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 2, lives: 2 });
  sim.reset();
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 2, lives: 2 });
  harness.events = [{ type: 'fell', restartAt: [0, 0] }];
  sim.step(input);
  sim.reset();
  sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 0, lives: 0, exhausted: true });
  expect(() => sim.reset()).toThrow('no lives');
  expect(sim.step(input).events).toEqual([]);
  await sim.load(stage);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 0, lives: 3, exhausted: false });
  sim.dispose();
});
test('plain courses have the same life budget, including manual recovery penalties', async () => {
  const { stunts: _, ...plain } = course;
  const sim = await createRaceSimulation(plain);
  sim.penalizeRecovery();
  sim.penalizeRecovery();
  expect(sim.getMechanics()).toMatchObject({ enabled: false, lives: 2, turboCharges: 0 });
  sim.reset();
  harness.events = [{ type: 'fell', restartAt: [0, 0] }];
  sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ lives: 1, turboCharges: 0 });
  sim.dispose();
});

test.each([-Math.PI / 2, Math.PI / 2])(
  'stationary turbo follows camera forward at yaw %s',
  async (frameYaw) => {
    const sim = await createRaceSimulation(course);
    for (let i = 0; i < 3 * SIM_HZ; i++) sim.step(input);
    harness.ball.vel = [0, 0, 0];
    sim.step({ ...input, frameYaw, turbo: true });
    expect(harness.impulses[0][0]).toBeCloseTo(-Math.sin(frameYaw) * 8);
    expect(harness.impulses[0][2]).toBeCloseTo(-Math.cos(frameYaw) * 8);
    sim.dispose();
  },
);
