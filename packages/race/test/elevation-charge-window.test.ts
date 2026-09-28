import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  createRaceSimulation,
  makeCompatibility,
  type RaceCourse,
  type RaceInputSample,
} from '../src/index.ts';

/** Real compressive contacts across eased uphill seams must permit uninterrupted charging. */
test.each(['hairpin-terraces', 'twin-canyons'])(
  '%s earns a turbo through its actual uphill charge window',
  async (slug) => {
    const fixture = (name: string) =>
      JSON.parse(
        readFileSync(new URL(`../../../fixtures/race/${slug}/${name}.json`, import.meta.url), 'utf8'),
      );
    const course = fixture('course') as RaceCourse;
    const recording = fixture('charge-window-inputs') as { courseId: string; inputs: RaceInputSample[] };
    const proof = fixture('charge-window-validation');
    expect(recording.courseId).toBe(course.courseId);
    expect(proof.compatibility).toEqual(
      makeCompatibility(course.courseId, !!course.stunts, course.physicsProfile),
    );
    expect(recording.inputs.length).toBeGreaterThan(360);
    expect(recording.inputs.length).toBeLessThan(4800);
    const sim = await createRaceSimulation(course);
    try {
      await sim.load(course.stage);
      for (let tick = 0; tick < recording.inputs.length; tick++) {
        const input = recording.inputs[tick];
        expect(input).toMatchObject({ power: true, jump: false, turbo: false });
        expect(Math.abs(input.tiltX)).toBeLessThanOrEqual(0.436);
        expect(Math.abs(input.tiltZ)).toBeLessThanOrEqual(0.436);
        const result = sim.step(input);
        expect(result.events.some((event) => event.type === 'fell' || event.type === 'lost')).toBe(false);
        expect(sim.getMechanics().chargingReason).not.toBe('downhill');
        expect(sim.getMechanics().turboCharges).toBe(tick === recording.inputs.length - 1 ? 1 : 0);
      }
      expect(sim.getMechanics()).toEqual(proof.mechanics);
      expect(sim.getMechanics()).toMatchObject({
        turboCharges: 1,
        chargeTicks: 0,
        lives: 3,
        lastEvent: 'charged',
      });
      expect(sim.getBallState()).toEqual(proof.ball);
    } finally {
      sim.dispose();
    }
  },
);
