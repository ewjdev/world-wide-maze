import { readFileSync } from 'node:fs';
import { createSimulation } from '@wwm/physics';
import {
  advanceProgress,
  createProgress,
  createRaceSimulation,
  type RaceCourse,
  type RaceGate,
  type RaceProgress,
  racePhysicsOptions,
} from '@wwm/race';
import { type InputSample, SIM_HZ, type SimEvent } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { island, makeStage, rect } from '../../../packages/physics/test/helpers/stages.ts';
import { LockstepDriver, type ObservedStep } from '../src/game/sim-driver.ts';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/race/flow-sprint/${name}`, import.meta.url), 'utf8'));
const course = fixture('course.json') as RaceCourse;
const { inputs, courseId } = fixture('solver-inputs.json') as { inputs: InputSample[]; courseId: string };
const expected = fixture('race-validation.json').progress as RaceProgress;
const idle: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };

function drive(driver: LockstepDriver, schedule: number[]) {
  let progress = createProgress();
  let observed = 0;
  const events: SimEvent[] = [];
  let previousTick = 0;
  let previousPosition: number[] | null = null;
  driver.setPaused(false);
  for (let frame = 0; frame < inputs.length * 3 && progress.finishTick === null; frame++) {
    driver.advance(
      schedule[frame % schedule.length],
      (tick) => inputs[tick] ?? idle,
      (event) => {
        events.push(event);
        return false; // Original's goal sensor never stops a Race.
      },
      (step) => {
        expect(step.tick).toBe(previousTick + 1);
        if (previousPosition) expect(step.previous.pos).toEqual(previousPosition);
        previousTick = step.tick;
        previousPosition = step.current.pos;
        observed++;
        progress = advanceProgress(progress, course.gates, {
          tick: step.tick,
          previous: step.previous.pos,
          current: step.current.pos,
          fell: step.events.some((event) => event.type === 'fell'),
        });
        return progress.finishTick !== null;
      },
    );
  }
  return { progress, observed, events };
}

describe('Race authoritative driver ticks', () => {
  test('a swept step can cross ordered gates and stop before remaining render-frame ticks', async () => {
    const stage = makeStage({
      islands: [island(0, rect(0, 0, 1000, 1000), 0)],
      start: [200, 500],
      width: 1000,
      height: 1000,
    });
    const gates: RaceGate[] = [21, 22, 23].map((x, index) => ({
      id: `gate-${index}`,
      kind: index === 2 ? 'finish' : 'sector',
      center: [x, 1, 30],
      normal: [1, 0],
      halfWidth: 3,
      halfHeight: 3,
    }));
    const sim = await createSimulation();
    const driver = new LockstepDriver(sim);
    let progress = createProgress();
    try {
      await driver.load(stage);
      sim.setBallState([20, 1, 30], [600, 0, 0]);
      driver.setPaused(false);
      const result = driver.advance(
        1 / 30,
        () => idle,
        () => false,
        (step) => {
          progress = advanceProgress(progress, gates, {
            tick: step.tick,
            previous: step.previous.pos,
            current: step.current.pos,
          });
          return progress.finishTick !== null;
        },
      );
      expect(progress.sectorTicks).toEqual([1, 1]);
      expect(progress.finishTick).toBe(1);
      expect(driver.tick).toBe(1);
      expect(result.simDt).toBe(1 / SIM_HZ);
    } finally {
      driver.dispose();
    }
  });
  test.each([
    ['30 Hz', [1 / 30]],
    ['60 Hz', [1 / 60]],
    ['144 Hz', [1 / 144]],
    ['variable frames and capped catch-up', [0.004, 0.042, 0.017, 0.32, 0.009, 0.021]],
  ] as const)(
    'same frozen input finishes at the same sector/finish ticks at %s',
    async (_label, schedule) => {
      expect(courseId).toBe(course.courseId);
      const sim = await createRaceSimulation(course);
      const driver = new LockstepDriver(sim);
      try {
        await driver.load(course.stage);
        const result = drive(driver, [...schedule]);
        expect(result.progress).toEqual(expected);
        expect(result.observed).toBe(expected.finishTick);
        expect(driver.tick).toBe(expected.finishTick);
      } finally {
        driver.dispose();
      }
    },
  );

  test('early Original goal contact does not prevent later Race finish; repeated load retries restore ticks and physics', async () => {
    const stage = structuredClone(course.stage);
    stage.goal = { ...stage.goal, ...stage.start };
    // Deliberately relocate Original's goal sensor for this low-level driver test;
    // the real course validator requires a different goal island. Use the same
    // selected physics profile as live Race without weakening course validation.
    const sim = await createSimulation(racePhysicsOptions(course.physicsProfile));
    const driver = new LockstepDriver(sim);
    try {
      let initial: ReturnType<typeof sim.getBallState> | null = null;
      for (let retry = 0; retry < 2; retry++) {
        driver.setPaused(true);
        await driver.load(stage);
        expect(driver.tick).toBe(0);
        if (initial) expect(sim.getBallState()).toEqual(initial);
        else initial = sim.getBallState();
        const result = drive(driver, [1 / 30]);
        expect(result.events.filter((event) => event.type === 'goal')).toHaveLength(1);
        expect(result.progress).toEqual(expected);
        // Ending a render batch early must leave no queued catch-up ticks on retry.
        driver.setPaused(true);
        expect(
          driver.advance(
            1,
            () => idle,
            () => false,
          ).simDt,
        ).toBe(0);
      }
    } finally {
      driver.dispose();
    }
  });

  test('recovery rebases the observer previous pose without creating a teleport gate crossing', async () => {
    const stage = makeStage({
      islands: [island(0, rect(0, 0, 1000, 1000), 0)],
      start: [200, 500],
      width: 1000,
      height: 1000,
    });
    const gate: RaceGate = {
      id: 'finish',
      kind: 'finish',
      center: [500 / 13.5, 0.4, 500 / 13.5],
      normal: [1, 0],
      halfWidth: 5,
      halfHeight: 3,
    };
    const sim = await createSimulation();
    const driver = new LockstepDriver(sim);
    let progress = createProgress();
    const steps: ObservedStep[] = [];
    const observe = (step: ObservedStep) => {
      steps.push(step);
      progress = advanceProgress(progress, [gate], {
        tick: step.tick,
        previous: step.previous.pos,
        current: step.current.pos,
      });
      return false;
    };
    try {
      await driver.load(stage);
      driver.setPaused(false);
      driver.advance(
        1 / SIM_HZ,
        () => idle,
        () => false,
        observe,
      );
      driver.reset([800, 500]);
      const resetState = sim.getBallState();
      driver.advance(
        1 / SIM_HZ,
        () => idle,
        () => false,
        observe,
      );
      expect(steps[1].previous).toEqual(resetState);
      expect(steps[1].previous.pos[0]).toBeGreaterThan(gate.center[0]);
      expect(progress.tick).toBe(2);
      expect(progress.finishTick).toBeNull();
      expect(progress.nextGate).toBe(0);
      expect(driver.tick).toBe(2);
    } finally {
      driver.dispose();
    }
  });
});
