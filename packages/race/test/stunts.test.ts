import { readFileSync } from 'node:fs';
import { createSimulation } from '@wwm/physics';
import { PX_PER_METER, type StageData } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import {
  advanceProgress,
  compatible,
  createProgress,
  createRaceSimulation,
  inputAt,
  makeCompatibility,
  type RaceAttempt,
  type RaceCourse,
  type RaceInputSample,
  RaceRecorder,
  replayRace,
  validateAttempt,
  validateRecording,
  validateStunts,
} from '../src/index.ts';

const forward: RaceInputSample = { tiltX: 0.43, tiltZ: 0, frameYaw: 0, power: true, jump: false };
const pt = (x: number, z: number): [number, number] => [x * PX_PER_METER, z * PX_PER_METER];
function course(): RaceCourse & { stunts: NonNullable<RaceCourse['stunts']> } {
  const stage: StageData = JSON.parse(
    readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
  );
  const base = stage.islands[0];
  stage.islands = [
    {
      ...base,
      id: 0,
      contour: [pt(0, 0), pt(40, 0), pt(40, 12), pt(0, 12)],
      guardrails: [],
      restartPoints: [pt(2, 6)],
    },
    {
      ...base,
      id: 1,
      contour: [pt(43, 0), pt(180, 0), pt(180, 12), pt(43, 12)],
      guardrails: [],
      restartPoints: [pt(45, 6)],
    },
  ];
  stage.bridges = [];
  stage.elevators = [];
  stage.items = [];
  stage.start = { islandId: 0, pos: pt(2, 6) };
  stage.goal = { ...stage.goal, islandId: 1, pos: pt(170, 6) };
  return {
    schema: 'wwm.race-course/1',
    courseId: 'stunt-test',
    title: 'test',
    description: '',
    stage,
    textureUrl: '',
    seed: 1,
    generatorVersion: 'test',
    gates: [
      { id: 'finish', center: [150, 0.5, 6], normal: [1, 0], halfWidth: 6, halfHeight: 2, kind: 'finish' },
    ],
    stunts: {
      version: 1,
      cruiseSpeed: 5,
      chargeTicks: 360,
      turboDeltaV: 8,
      turboMaxSpeed: 25,
      landingDeltaV: 2,
      launchPads: [
        {
          id: 'jump',
          gate: {
            id: 'jump',
            center: [39.7, 0.5, 6],
            normal: [1, 0],
            halfWidth: 6,
            halfHeight: 1,
            kind: 'sector',
          },
          upSpeed: 15,
          minSpeed: 5,
          landingIslandIds: [1],
        },
      ],
    },
  };
}

describe('stunt recording and validation', () => {
  test('v1 remains byte compatible; v2 persists turbo and rejects reserved flags', () => {
    const old = new RaceRecorder();
    old.record({ ...forward, turbo: true });
    expect(old.finish().format).toBe('wwm.race-input/1');
    expect(inputAt(old.finish(), 0)).toEqual(forward);
    const recorder = new RaceRecorder(undefined, true);
    recorder.record({ ...forward, turbo: true });
    const r = recorder.finish();
    expect(r.data.byteLength).toBe(25);
    expect(r.format).toBe('wwm.race-input/2');
    expect(inputAt(r, 0)).toEqual({ ...forward, turbo: true });
    expect(validateRecording(r)).toBe(true);
    new DataView(r.data).setUint8(24, 8);
    expect(validateRecording(r)).toBe(false);
    expect(compatible(makeCompatibility('x'), makeCompatibility('x', true))).toBe(false);
  });
  test('rejects invalid tuning and nonexistent landing IDs before simulation allocation', async () => {
    const c = course();
    c.stunts.launchPads[0].landingIslandIds = [999];
    expect(validateStunts(c)).toContain('Invalid landing islands');
    await expect(createRaceSimulation(c)).rejects.toThrow('Invalid landing islands');
    c.stunts.launchPads[0].landingIslandIds = [1];
    c.stunts.turboDeltaV = Infinity;
    await expect(createRaceSimulation(c)).rejects.toThrow('Invalid stunt tuning');
  });
});
test('plain courses preserve original physics exactly tick for tick', async () => {
  const c: RaceCourse = course();
  delete c.stunts;
  const original = await createSimulation();
  const wrapped = await createRaceSimulation(c);
  try {
    await original.load(c.stage);
    await wrapped.load(c.stage);
    for (let tick = 0; tick < 1000; tick++) {
      const input = { ...forward, jump: tick === 100 };
      expect(wrapped.step(input)).toEqual(original.step(input));
    }
    expect(wrapped.getMechanics().enabled).toBe(false);
  } finally {
    original.dispose();
    wrapped.dispose();
  }
});
test('real physics launches once, rewards distinct island landing, and replays every turbo pose', async () => {
  const c = course();
  const sim = await createRaceSimulation(c);
  await sim.load(c.stage);
  const recorder = new RaceRecorder(undefined, true);
  let previous = sim.getBallState();
  let progress = createProgress();
  const poses: number[][] = [previous.pos];
  let charged = false;
  let turbo = false;
  let launched = false;
  let landed = false;
  try {
    for (let tick = 1; tick < 4000 && progress.finishTick === null; tick++) {
      const m = sim.getMechanics();
      const input = { ...forward, turbo: m.ready && !turbo };
      if (input.turbo) turbo = true;
      recorder.record(input);
      const r = sim.step(input);
      const after = sim.getMechanics();
      charged ||= after.ready;
      launched ||= after.launches === 1;
      landed ||= after.landings === 1;
      progress = advanceProgress(progress, c.gates, {
        tick,
        previous: previous.pos,
        current: r.ball.pos,
        fell: r.events.some((e) => e.type === 'fell'),
      });
      previous = r.ball;
      poses.push(r.ball.pos);
    }
    expect(charged).toBe(true);
    expect(turbo).toBe(true);
    expect(launched).toBe(true);
    expect(landed).toBe(true);
    expect(progress.finishTick).not.toBeNull();
    expect(progress.reasons).toEqual([]);
    const attempt: RaceAttempt = {
      schema: 'wwm.race-attempt/1',
      id: 'test',
      createdAt: 0,
      inputSource: 'keyboard',
      outcome: 'finished',
      compatibility: makeCompatibility(c.courseId, true),
      progress,
      recording: recorder.finish(),
    };
    expect(validateAttempt(attempt)).toBe(true);
    const track = await replayRace(c, attempt);
    expect(track.progress).toEqual(progress);
    for (let i = 0; i < poses.length; i++)
      expect(Array.from(track.pos.slice(i * 3, i * 3 + 3))).toEqual(poses[i].map(Math.fround));
    const savedCharges = sim.getMechanics().turboCharges;
    sim.reset();
    expect(sim.getMechanics()).toMatchObject({
      chargeTicks: 0,
      turboCharges: savedCharges,
      ready: savedCharges > 0,
      turboTicks: 0,
      launches: 1,
      landings: 1,
    });
    await sim.load(c.stage);
    expect(sim.getMechanics()).toMatchObject({ launches: 0, landings: 0, ready: false });
  } finally {
    sim.dispose();
  }
});
test('velocity delta changes velocity only and rejects nonfinite or excessive impulses', async () => {
  const sim = await createSimulation();
  const c = course();
  await sim.load(c.stage);
  try {
    for (let i = 0; i < 50; i++) sim.step(forward);
    const before = sim.getBallState();
    sim.applyVelocityDelta([1, 2, 3]);
    const after = sim.getBallState();
    expect(after.pos).toEqual(before.pos);
    expect(after.quat).toEqual(before.quat);
    expect(after.grounded).toBe(before.grounded);
    expect(after.vel[0]).toBeCloseTo(before.vel[0] + 1, 5);
    expect(after.vel[1]).toBeCloseTo(before.vel[1] + 2, 5);
    expect(() => sim.applyVelocityDelta([NaN, 0, 0])).toThrow();
    expect(() => sim.applyVelocityDelta([101, 0, 0])).toThrow();
  } finally {
    sim.dispose();
  }
});
test('held turbo is edge triggered and recovery retains the remaining stack', async () => {
  const c = course();
  c.stunts.launchPads = [];
  c.stage.islands[0].contour = [pt(0, 0), pt(400, 0), pt(400, 12), pt(0, 12)];
  c.gates[0].center[0] = 350;
  c.stunts.chargeTicks = 60;
  const sim = await createRaceSimulation(c);
  await sim.load(c.stage);
  let turbos = 0;
  try {
    // Holding before earning never fires: charging requires a new press.
    for (let i = 0; i < 600; i++) {
      sim.step({ ...forward, turbo: true });
      if (sim.getMechanics().lastEvent === 'turbo') turbos++;
    }
    expect(sim.getMechanics().ready).toBe(true);
    expect(turbos).toBe(0);
    sim.step({ ...forward, turbo: false });
    sim.step({ ...forward, turbo: true });
    expect(sim.getMechanics().lastEvent).toBe('turbo');
    for (let i = 0; i < 600; i++) {
      sim.step({ ...forward, turbo: true });
      if (sim.getMechanics().lastEvent === 'turbo') turbos++;
    }
    expect(turbos).toBe(0); // no second trigger, even after recharging
    const before = sim.getMechanics();
    sim.penalizeRecovery();
    sim.reset();
    expect(sim.getMechanics()).toMatchObject({
      turboCharges: before.turboCharges - 1,
      lives: 2,
      chargeTicks: 0,
      turboTicks: 0,
    });
  } finally {
    sim.dispose();
  }
});
test('landing on the launch island never awards a boost and a consumed pad cannot be farmed after recovery', async () => {
  const c = course();
  const pad = c.stunts.launchPads[0];
  pad.gate.center[0] = 10;
  pad.landingIslandIds = [0];
  pad.upSpeed = 8;
  const sim = await createRaceSimulation(c);
  await sim.load(c.stage);
  try {
    for (let i = 0; i < 450; i++) sim.step(forward);
    expect(sim.getMechanics().launches).toBe(1);
    expect(sim.getMechanics().landings).toBe(0);
    sim.reset();
    for (let i = 0; i < 450; i++) sim.step(forward);
    expect(sim.getMechanics().launches).toBe(1);
    expect(sim.getMechanics().landings).toBe(0);
  } finally {
    sim.dispose();
  }
});
test('turbo preserves a banked charge above its cap and can be used from standstill', async () => {
  const c = course();
  c.stunts.launchPads = [];
  c.stunts.chargeTicks = 10;
  c.stunts.turboMaxSpeed = 5;
  c.stage.islands[0].contour = [pt(0, 0), pt(400, 0), pt(400, 12), pt(0, 12)];
  c.gates[0].center[0] = 350;
  const sim = await createRaceSimulation(c);
  await sim.load(c.stage);
  try {
    for (let i = 0; i < 300; i++) sim.step(forward);
    expect(sim.getMechanics().ready).toBe(true);
    expect(Math.hypot(sim.getBallState().vel[0], sim.getBallState().vel[2])).toBeGreaterThan(5);
    sim.step({ ...forward, turbo: true });
    expect(sim.getMechanics().ready).toBe(true);
    const neutral = { ...forward, tiltX: 0, power: false, turbo: false };
    for (let i = 0; i < 1200; i++) sim.step(neutral);
    expect(Math.hypot(sim.getBallState().vel[0], sim.getBallState().vel[2])).toBeLessThan(0.1);
    const stored = sim.getMechanics().turboCharges;
    sim.step({ ...neutral, turbo: true });
    expect(sim.getMechanics()).toMatchObject({ turboCharges: stored - 1, turboTicks: 120 });
    expect(sim.getBallState().vel[2]).toBeLessThan(-1);
  } finally {
    sim.dispose();
  }
});
