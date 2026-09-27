import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PX_PER_METER, pointInPolygon } from '@wwm/schema';
import { describe, expect, it } from 'vitest';
import {
  advanceProgress,
  createProgress,
  createRaceSimulation,
  type RaceCourse,
  type RaceInputSample,
  validateStunts,
} from '../src/index.ts';

const dir = resolve(import.meta.dirname, '../../../fixtures/race/island-leap');
const json = (f: string) => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
describe('Island Leap actual physics routes', () => {
  it.each(['safe', 'near', 'far'])(
    '%s reaches the shared finish using only recorded player input',
    async (route) => {
      const course: RaceCourse = json('course.json');
      expect(validateStunts(course)).toEqual([]);
      const { inputs }: { inputs: RaceInputSample[] } = json(`${route}-inputs.json`);
      const expected = json(`${route}-validation.json`);
      const sim = await createRaceSimulation(course);
      let progress = createProgress();
      let clearance = Infinity;
      let clearanceSamples = 0;
      const touched = new Set<number>();
      try {
        await sim.load(course.stage);
        let previous = sim.getBallState();
        for (const input of inputs) {
          const r = sim.step(input);
          progress = advanceProgress(progress, course.gates, {
            tick: progress.tick + 1,
            previous: previous.pos,
            current: r.ball.pos,
            fell: r.events.some((e) => e.type === 'fell' || e.type === 'lost'),
          });
          for (const e of r.events) if (e.type === 'island') touched.add(e.islandId);
          if (
            pointInPolygon(
              [r.ball.pos[0] * PX_PER_METER, r.ball.pos[2] * PX_PER_METER],
              course.stage.islands[2].contour,
              course.stage.islands[2].holes,
            )
          ) {
            clearance = Math.min(clearance, r.ball.pos[1] - 0.5 - course.stage.islands[2].level);
            clearanceSamples++;
          }
          previous = r.ball;
        }
        expect(progress).toEqual(expected.progress);
        expect(progress.reasons).toEqual([]);
        expect(sim.getMechanics().launches).toBe(route === 'safe' ? 0 : 1);
        expect(sim.getMechanics().landings).toBe(route === 'safe' ? 0 : 1);
        expect(inputs.some((i) => i.jump)).toBe(false);
        expect(inputs.filter((i) => i.turbo)).toHaveLength(route === 'far' ? 1 : 0);
        if (route === 'far') {
          expect(touched.has(2)).toBe(false);
          expect(touched.has(3)).toBe(true);
          expect(clearanceSamples).toBeGreaterThan(0);
          expect(clearance).toBeGreaterThan(2);
        }
        if (route === 'near') expect(touched.has(2)).toBe(true);
        if (route === 'safe') {
          expect(touched.has(4)).toBe(true);
          expect(touched.has(5)).toBe(true);
        }
      } finally {
        sim.dispose();
      }
    },
  );
});
