import { readFileSync } from 'node:fs';
import { validateStage } from '@wwm/schema';
import { expect, test } from 'vitest';
import { type RaceCourse, validateGates, validateStunts } from '../src/index.ts';

const slugs = [
  'flow-delta',
  'hairpin-terraces',
  'skipping-stones',
  'twin-canyons',
  'cliff-ribbon',
  'bankshot-basin',
  'switchyard',
  'sky-weave',
  'needle-garden',
  'redline-relay',
];
const read = (path: string) => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
for (const slug of slugs) {
  test(`${slug}: published geometry, flight graph and verified route evidence agree`, () => {
    const course: RaceCourse = read(`fixtures/race/${slug}/course.json`);
    expect(read(`apps/web/public/race/${slug}/course.json`)).toEqual(course);
    expect(validateStage(course.stage).errors).toEqual([]);
    expect(validateGates(course.gates)).toEqual([]);
    expect(validateStunts(course)).toEqual([]);
    expect(course.stage.bridges.every((bridge) => bridge.rails === false)).toBe(true);
    const pads = course.stunts?.launchPads ?? [];
    expect(course.stage.flightLinks).toHaveLength(pads.length);
    const targets = new Set(course.stage.flightLinks?.map((link) => link.to));
    for (const pad of pads) for (const id of pad.landingIslandIds) expect(targets.has(id)).toBe(true);
    const straights = read(`fixtures/race/${slug}/straight-validation.json`);
    expect(straights.courseId).toBe(course.courseId);
    expect(straights.pass).toBe(true);
    expect(straights.longStraights.length).toBeLessThanOrEqual(1);
    const resets = read(`fixtures/race/${slug}/reset-validation.json`);
    expect(resets.courseId).toBe(course.courseId);
    expect(resets.checks.every((check: { pass: boolean }) => check.pass)).toBe(true);
    const evidence = read(`fixtures/race/${slug}/race-validation.json`);
    const routes = read(`fixtures/race/${slug}/route-points.json`).routes;
    expect(evidence.courseId).toBe(course.courseId);
    expect(evidence.routes).toHaveLength(routes.length);
    for (const run of evidence.routes) {
      expect(run.courseId).toBe(course.courseId);
      expect(run.replayVerified).toBe(true);
      expect(run.progress.reasons).toEqual([]);
      expect(run.progress.nextGate).toBe(course.gates.length);
      expect(run.progress.finishTick).toBeGreaterThan(0);
      const expected = routes.find((route: { id: string }) => route.id === run.route).expectedLaunches;
      expect(run.mechanics.launches).toBe(expected);
      expect(run.mechanics.landings).toBe(expected);
    }
  });
}

for (const slug of ['flow-sprint', 'switchback', 'longline', 'island-leap']) {
  test(`${slug}: classic course has turbo and at most one audited long straight`, () => {
    const course: RaceCourse = read(`fixtures/race/${slug}/course.json`);
    expect(read(`apps/web/public/race/${slug}/course.json`)).toEqual(course);
    expect(validateStunts(course)).toEqual([]);
    expect(course.stunts?.chargeTicks).toBe(360);
    const audit = read(`fixtures/race/${slug}/straight-validation.json`);
    expect(audit.courseId).toBe(course.courseId);
    expect(audit.pass).toBe(true);
    expect(audit.longStraights.length).toBeLessThanOrEqual(1);
  });
}
