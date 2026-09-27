import { readFileSync } from 'node:fs';
import { type BallState, SIM_HZ, type SimStepResult, type StageData } from '@wwm/schema';
import { beforeEach, expect, test, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  ball: { pos: [0, 0.5, 0], vel: [8, 0, 0], quat: [0, 0, 0, 1], grounded: true } as BallState,
  events: [] as SimStepResult['events'],
  impulses: [] as number[][],
  support: { normal: [0, 1, 0], surfaceId: 'island:0' } as {
    normal: [number, number, number];
    surfaceId: string;
  } | null,
  options: [] as unknown[],
}));
vi.mock('@wwm/physics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wwm/physics')>()),
  createSimulation: async (options: unknown) => {
    harness.options.push(options);
    return {
      params: { ballRadius: 0.5 },
      load: async () => {},
      reset: () => {},
      dispose: () => {},
      setLock: () => {},
      getBallState: () => structuredClone(harness.ball),
      getSurfaceSupport: () => structuredClone(harness.support),
      applyVelocityDelta: (v: number[]) => harness.impulses.push(v),
      step: () => ({ ball: structuredClone(harness.ball), events: harness.events, elevators: [] }),
    };
  },
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
  harness.options = [];
  harness.support = { normal: [0, 1, 0], surfaceId: 'island:0' };
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

const elevationStage = structuredClone(stage);
elevationStage.islands = [elevationStage.islands[0]];
elevationStage.bridges = [];
elevationStage.elevators = [];
elevationStage.items = [];
elevationStage.goal = {
  ...elevationStage.goal,
  islandId: elevationStage.start.islandId,
  pos: elevationStage.start.pos,
};
const elevationCourse: RaceCourse = { ...course, stage: elevationStage, physicsProfile: 'elevation-v1' };
test('elevation charges at tick 360 only on supported level or uphill travel', async () => {
  const sim = await createRaceSimulation(elevationCourse);
  expect(harness.options).toEqual([{ raceElevation: true }]);
  for (let i = 0; i < 359; i++) sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 0, chargeTicks: 359, chargingReason: 'charging' });
  sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 1, chargeTicks: 0 });
  // Same downhill ramp, opposite travel: uphill earns; Y velocity is irrelevant.
  harness.support = { normal: [0.2, 1, 0], surfaceId: 'ramp:1' };
  harness.ball.vel = [-8, -20, 0];
  for (let i = 0; i < 360; i++) sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 2, chargeTicks: 0, chargingReason: 'charging' });
});
test('entering downhill at tick 360 resets partial charge without spending stock', async () => {
  const sim = await createRaceSimulation(elevationCourse);
  for (let i = 0; i < 719; i++) sim.step(input);
  harness.support = { normal: [0.2, 1, 0], surfaceId: 'ramp:1' };
  harness.ball.vel = [8, 30, 0]; // Upward world velocity must not hide downhill travel.
  sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 1, chargeTicks: 0, chargingReason: 'downhill' });
  for (let i = 0; i < 720; i++) sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 1, chargeTicks: 0 });
  sim.step({ ...input, turbo: true });
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 0, chargeTicks: 0 });
  expect(harness.impulses).toHaveLength(1);
  harness.support = { normal: [0, 1, 0], surfaceId: 'island:1' };
  for (let i = 0; i < 359; i++) sim.step(input);
  expect(sim.getMechanics().turboCharges).toBe(0);
  sim.step(input);
  expect(sim.getMechanics().turboCharges).toBe(1);
});
test('airborne and missing support cannot complete a partial charge or farm a descent launch', async () => {
  const sim = await createRaceSimulation(elevationCourse);
  for (let i = 0; i < 719; i++) sim.step(input);
  harness.ball.grounded = false;
  for (let i = 0; i < 720; i++) sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 1, chargeTicks: 0, chargingReason: 'airborne' });
  sim.step({ ...input, turbo: true });
  expect(sim.getMechanics().turboCharges).toBe(0);
  harness.ball.grounded = true;
  harness.support = null;
  for (let i = 0; i < 360; i++) sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 0, chargeTicks: 0, chargingReason: 'airborne' });
});
test('surface grade deadband ignores seam noise but includes bank crossfall in the travel direction', async () => {
  const sim = await createRaceSimulation(elevationCourse);
  harness.support = { normal: [0.0009, 1, 0.2], surfaceId: 'ramp:1' };
  for (let i = 0; i < 360; i++) sim.step(input);
  expect(sim.getMechanics().turboCharges).toBe(1);
  harness.ball.vel = [0, 0, 8];
  sim.step(input);
  expect(sim.getMechanics()).toMatchObject({ chargeTicks: 0, chargingReason: 'downhill' });
});
test('elevation overspeed preserves stock at turbo cap and falling deducts once', async () => {
  const sim = await createRaceSimulation(elevationCourse);
  for (let i = 0; i < 720; i++) sim.step(input);
  harness.support = { normal: [0.2, 1, 0], surfaceId: 'ramp:1' };
  harness.ball.vel = [48, 0, 0];
  sim.step({ ...input, turbo: true });
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 2, chargeTicks: 0, chargingReason: 'downhill' });
  expect(harness.impulses).toHaveLength(0);
  harness.events = [{ type: 'fell', restartAt: [0, 0] }];
  sim.step(input);
  harness.events = [{ type: 'lost' }];
  sim.step(input);
  expect(sim.getMechanics()).toMatchObject({
    turboCharges: 1,
    lives: 2,
    chargeTicks: 0,
    chargingReason: 'recovering',
  });
  sim.reset();
  expect(sim.getMechanics()).toMatchObject({ turboCharges: 1, lives: 2, chargeTicks: 0 });
});
test('unknown profile rejects before allocating simulation', async () => {
  await expect(
    createRaceSimulation({ ...course, physicsProfile: 'future' } as unknown as RaceCourse),
  ).rejects.toThrow('Unknown Race physics profile');
  expect(harness.options).toHaveLength(0);
});

test('elevation rejects invalid geometry before allocating physics', async () => {
  const bad = structuredClone(elevationCourse);
  bad.stage.goal.pos = [-100, -100];
  await expect(createRaceSimulation(bad)).rejects.toThrow('out-of-bounds');
  expect(harness.options).toHaveLength(0);
});
