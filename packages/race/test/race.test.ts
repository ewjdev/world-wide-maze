import { readFileSync } from 'node:fs';
import { createSimulation } from '@wwm/physics';
import type { InputSample, StageData } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import {
  advanceProgress,
  betterAttempt,
  createProgress,
  inputAt,
  isEligible,
  makeCompatibility,
  markPractice,
  RaceRecorder,
  replayRace,
  sampleRaceTrack,
  validateAttempt,
  validateGates,
  validateRecording,
} from '../src/index.ts';
import type { RaceAttempt, RaceCourse, RaceGate } from '../src/types.ts';

const neutral: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };
const gate = (x: number, kind: RaceGate['kind'] = 'sector'): RaceGate => ({
  id: String(x),
  center: [x, 0, 0],
  normal: [1, 0],
  halfWidth: 2,
  halfHeight: 2,
  kind,
});
function attempt(ticks = 1): RaceAttempt {
  const recorder = new RaceRecorder();
  for (let i = 0; i < ticks; i++) recorder.record(neutral);
  return {
    schema: 'wwm.race-attempt/1',
    id: 'attempt',
    createdAt: 1,
    compatibility: makeCompatibility('course'),
    inputSource: 'keyboard',
    outcome: 'finished',
    progress: { tick: ticks, nextGate: 1, sectorTicks: [], finishTick: ticks, reasons: [] },
    recording: recorder.finish(),
  };
}
describe('authoritative ordered gates', () => {
  test('swept crossings in one tick are ordered physically, not awarded merely by array order', () => {
    const result = advanceProgress(createProgress(), [gate(2), gate(4, 'finish')], {
      tick: 1,
      previous: [0, 0, 0],
      current: [5, 0, 0],
    });
    expect(result).toMatchObject({ sectorTicks: [1], finishTick: 1 });
    const reversed = advanceProgress(createProgress(), [gate(4), gate(2, 'finish')], {
      tick: 1,
      previous: [0, 0, 0],
      current: [5, 0, 0],
    });
    expect(reversed.finishTick).toBeNull();
  });
  test('early finish remains available after later required sector crossing', () => {
    const gates = [gate(4), gate(2, 'finish')];
    let p = advanceProgress(createProgress(), gates, { tick: 1, previous: [0, 0, 0], current: [5, 0, 0] });
    p = advanceProgress(p, gates, { tick: 2, previous: [5, 0, 0], current: [0, 0, 0] });
    p = advanceProgress(p, gates, { tick: 3, previous: [0, 0, 0], current: [3, 0, 0] });
    expect(p.finishTick).toBe(3);
  });
  test('finite height/width and forward direction reject shortcut crossings', () => {
    for (const [previous, current] of [
      [
        [0, 4, 0],
        [4, 4, 0],
      ],
      [
        [0, 0, 4],
        [4, 0, 4],
      ],
      [
        [4, 0, 0],
        [0, 0, 0],
      ],
    ] as [number[], number[]][]) {
      const p = advanceProgress(createProgress(), [gate(2, 'finish')], {
        tick: 1,
        previous: previous as [number, number, number],
        current: current as [number, number, number],
      });
      expect(p.finishTick).toBeNull();
    }
  });
  test('fall marks practice before a simultaneous finish', () => {
    const p = advanceProgress(createProgress(), [gate(2, 'finish')], {
      tick: 1,
      previous: [0, 0, 0],
      current: [3, 0, 0],
      fell: true,
    });
    expect(p.finishTick).toBe(1);
    expect(p.reasons).toEqual(['fall']);
  });
  test('overlapping coplanar gates rejected; separate finite sections allowed', () => {
    expect(validateGates([gate(2), { ...gate(2, 'finish'), id: 'finish' }])).not.toEqual([]);
    expect(validateGates([gate(2), { ...gate(2, 'finish'), id: 'finish', center: [2, 0, 10] }])).toEqual([]);
  });
});
describe('bounded exact recordings', () => {
  test('float64 values survive binary record/load without rounding', () => {
    const r = new RaceRecorder();
    const input = { ...neutral, tiltX: Math.PI / 17, frameYaw: -Math.PI, power: true, jump: true };
    r.record(input);
    expect(inputAt(r.finish(), 0)).toEqual(input);
  });
  test('last permitted tick stays eligible; next tick caps without overwriting prefix', () => {
    const r = new RaceRecorder({ ticks: 2, bytes: 100 });
    r.record(neutral);
    r.record(neutral);
    expect(r.finish().truncated).toBe(false);
    expect(r.record(neutral)).toBe(false);
    expect(r.finish()).toMatchObject({ ticks: 2, truncated: true });
    expect(r.finish().data.byteLength).toBe(50);
  });
  test('recovery bytes reserve space for the upcoming complete sample', () => {
    const r = new RaceRecorder({ ticks: 100, bytes: 81 });
    r.record(neutral);
    expect(r.recover({ beforeTick: 2, destination: [0, 0], reason: 'recovery' })).toBe(false);
    expect(r.finish().recoveries).toEqual([]);
    expect(r.truncated).toBe(true);
  });
  test('oversized or malformed buffers rejected before decoding', () => {
    expect(
      validateRecording({
        format: 'wwm.race-input/1',
        data: new ArrayBuffer(0),
        ticks: 72_001,
        recoveries: [],
        truncated: false,
      }),
    ).toBe(false);
    const a = attempt();
    new DataView(a.recording.data).setFloat64(0, NaN, true);
    expect(validateAttempt(a)).toBe(false);
  });
  test('incompatible, practice, truncated, and tied runs never replace a best', () => {
    const a = attempt(2);
    const b = attempt(2);
    b.id = 'new';
    expect(betterAttempt(b, a)).toBe(false);
    b.progress.reasons.push('pause');
    expect(isEligible(b)).toBe(false);
    const c = attempt(1);
    c.compatibility.courseId = 'other';
    expect(betterAttempt(c, a)).toBe(false);
  });
});
test('real physics replay continues past Original goal, reproduces recovery, and samples tick zero', async () => {
  const stage: StageData = JSON.parse(
    readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
  );
  stage.goal.pos = [...stage.start.pos];
  stage.goal.islandId = stage.start.islandId;
  const course: RaceCourse = {
    schema: 'wwm.race-course/1',
    courseId: 'course',
    title: '',
    description: '',
    stage,
    textureUrl: '',
    gates: [gate(10000, 'finish')],
    generatorVersion: 'test',
    seed: 1,
  };
  const sim = await createSimulation();
  await sim.load(stage);
  const initial = sim.getBallState();
  const recorder = new RaceRecorder();
  let previous = initial;
  let progress = createProgress();
  let sawGoal = false;
  for (let tick = 1; tick <= 20; tick++) {
    if (tick === 10) {
      sim.reset(stage.start.pos);
      previous = sim.getBallState();
      recorder.recover({ beforeTick: tick, destination: stage.start.pos, reason: 'recovery' });
      progress = markPractice(progress, 'recovery');
    }
    recorder.record(neutral);
    const step = sim.step(neutral);
    sawGoal ||= step.events.some((e) => e.type === 'goal');
    progress = advanceProgress(progress, course.gates, {
      tick,
      previous: previous.pos,
      current: step.ball.pos,
    });
    previous = step.ball;
  }
  sim.dispose();
  const a: RaceAttempt = { ...attempt(), outcome: 'abandoned', progress, recording: recorder.finish() };
  const track = await replayRace(course, a);
  expect(sawGoal).toBe(true);
  expect(track.ticks).toBe(20);
  expect(track.discontinuities[10]).toBe(1);
  expect(sampleRaceTrack(track, 0)?.pos[0]).toBeCloseTo(initial.pos[0], 5);
  expect(sampleRaceTrack(track, 20)?.pos[1]).toBeCloseTo(previous.pos[1], 5);
  expect(sampleRaceTrack(track, 21)).toBeNull();
  const tampered = structuredClone(a);
  tampered.progress.sectorTicks = [5];
  tampered.progress.nextGate = 1;
  await expect(replayRace(course, tampered)).rejects.toThrow('does not reproduce');
});

test('a completed real-physics attempt reproduces exact finish and sector ticks', async () => {
  const stage: StageData = JSON.parse(
    readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
  );
  const sim = await createSimulation();
  await sim.load(stage);
  let previous = sim.getBallState();
  const start = previous.pos;
  const course: RaceCourse = {
    schema: 'wwm.race-course/1',
    courseId: 'course',
    title: '',
    description: '',
    stage,
    textureUrl: '',
    gates: [
      { ...gate(start[0] + 0.15), center: [start[0] + 0.15, start[1], start[2]] },
      { ...gate(start[0] + 0.35, 'finish'), center: [start[0] + 0.35, start[1], start[2]] },
    ],
    generatorVersion: 'test',
    seed: 1,
  };
  const recorder = new RaceRecorder();
  let progress = createProgress();
  for (let tick = 1; tick < 1000 && progress.finishTick === null; tick++) {
    const input = { ...neutral, tiltX: 0.3, power: true };
    recorder.record(input);
    const result = sim.step(input);
    progress = advanceProgress(progress, course.gates, {
      tick,
      previous: previous.pos,
      current: result.ball.pos,
      fell: result.events.some((e) => e.type === 'fell'),
    });
    previous = result.ball;
  }
  sim.dispose();
  expect(progress.finishTick).not.toBeNull();
  const a: RaceAttempt = { ...attempt(), progress, recording: recorder.finish() };
  expect(isEligible(a)).toBe(true);
  const track = await replayRace(course, a);
  expect(track.progress).toEqual(progress);
  expect(track.ticks).toBe(progress.finishTick);
});

test('replay enforces recovery life costs and rejects fabricated free fall resets', async () => {
  const stage: StageData = JSON.parse(
    readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
  );
  const course: RaceCourse = {
    schema: 'wwm.race-course/1',
    courseId: 'course',
    title: '',
    description: '',
    stage,
    textureUrl: '',
    gates: [gate(10000, 'finish')],
    generatorVersion: 'test',
    seed: 1,
  };
  const a = attempt(5);
  a.outcome = 'abandoned';
  a.progress = { tick: 5, nextGate: 0, sectorTicks: [], finishTick: null, reasons: ['recovery'] };
  a.recording.recoveries = [2, 3].map((beforeTick) => ({
    beforeTick,
    destination: stage.start.pos,
    reason: 'recovery',
  }));
  expect((await replayRace(course, a)).ticks).toBe(5);
  a.recording.recoveries.push({ beforeTick: 4, destination: stage.start.pos, reason: 'recovery' });
  await expect(replayRace(course, a)).rejects.toThrow('no lives');
  a.recording.recoveries = [{ beforeTick: 2, destination: stage.start.pos, reason: 'fall' }];
  a.progress.reasons = ['fall'];
  await expect(replayRace(course, a)).rejects.toThrow('no preceding fall');
  a.recording.recoveries = [];
  a.compatibility.rulesVersion = 'wwm.race-rules/1';
  expect(validateAttempt(a)).toBe(true);
  await expect(replayRace(course, a)).rejects.toThrow('Incompatible');
});
