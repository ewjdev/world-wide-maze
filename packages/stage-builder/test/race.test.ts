import { readFileSync } from 'node:fs';
import { validateStage } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { decodePng } from '../src/node/png.ts';
import { buildRaceCourse, type RaceAuthoring } from '../src/race.ts';
import { applyRaceElevation } from '../src/race-elevation.ts';

const load = (slug: string) => {
  const dir = new URL(`../../../fixtures/race/${slug}/`, import.meta.url);
  const png = decodePng(readFileSync(new URL('texture.png', dir)));
  return {
    input: {
      capture: JSON.parse(readFileSync(new URL('capture.json', dir), 'utf8')),
      image: { ...png, data: new Uint8ClampedArray(png.data) },
      sliceIndex: 0,
      seed: 24,
      difficulty: 'normal' as const,
    },
    author: JSON.parse(readFileSync(new URL('authoring.json', dir), 'utf8')) as RaceAuthoring,
    elevation: JSON.parse(readFileSync(new URL('elevation-design.json', dir), 'utf8')),
    saved: JSON.parse(readFileSync(new URL('course.json', dir), 'utf8')),
  };
};

describe('curated HTML Race terrain and routes', () => {
  test.each(['flow-sprint', 'switchback', 'longline'])('%s rebuild is byte-identical and valid', (slug) => {
    const { input, author, saved, elevation } = load(slug);
    const base = buildRaceCourse(input, author);
    expect(base).toEqual(buildRaceCourse(input, author));
    expect(validateStage(base.stage).errors).toEqual([]);
    expect(base.stage.bridges.every((bridge) => bridge.levelA >= bridge.levelB)).toBe(true);
    const course = applyRaceElevation(base, elevation);
    expect(course).toEqual(saved);
    expect(applyRaceElevation(course, elevation)).toEqual(course);
    expect(base.stage.bridges.every((bridge) => bridge.elevationProfile === undefined)).toBe(true);
    expect(validateStage(course.stage, { mode: 'race' }).errors).toEqual([]);
    expect(course.stage.bridges).toHaveLength(author.sections.length - 1);
    expect(course.gates).toHaveLength(author.sections.length);
    expect(course.stage.elevators).toEqual([]);
    expect(course.stage.items).toEqual([]);
    expect(course.stage.portals).toEqual([]);
    expect(course.stage.islands.every((island) => island.sourceElementIds.length > 0)).toBe(true);
    expect(course.stage.bridges.some((bridge) => bridge.levelA < bridge.levelB)).toBe(true);
    expect(course.stage.bridges.some((bridge) => bridge.levelA > bridge.levelB)).toBe(true);
  });
  test('resolved settings and actual source/texture contents partition course identity', () => {
    const { input, author, saved, elevation } = load('flow-sprint');
    for (const changed of [
      { ...author, descentPerBridge: 0.2 },
      { ...author, textureHash: 'changed' },
      { ...author, sourceHash: 'changed' },
      { ...author, bridgeWidthPx: 72 },
    ]) {
      expect(applyRaceElevation(buildRaceCourse(input, changed), elevation).courseId).not.toBe(
        saved.courseId,
      );
    }
    expect(applyRaceElevation(buildRaceCourse({ ...input, seed: 25 }, author), elevation).courseId).not.toBe(
      saved.courseId,
    );
    const relocated = {
      ...input,
      capture: {
        ...input.capture,
        capturedAt: '2030-01-01T00:00:00Z',
        url: 'http://localhost:9000/relocated',
      },
    };
    // The base HTML builder remains relocation-neutral. The frozen elevation release
    // hashes its complete owned source metadata together with the final geometry.
    expect(buildRaceCourse(relocated, author).courseId).toBe(buildRaceCourse(input, author).courseId);
  });
  test('bounded route search uses incoming heading and checked interior approaches', () => {
    const { input, author } = load('flow-sprint');
    const first = buildRaceCourse(input, { ...author, routeStrategy: 'search' });
    expect(first.validation.routeSearch?.order).toHaveLength(9);
    expect(first.validation.routeSearch?.examined).toBeLessThanOrEqual(4096);
    expect(first.validation.routeSearch?.score).toBeGreaterThan(0);
    expect(first).toEqual(buildRaceCourse(input, { ...author, routeStrategy: 'search' }));
    expect(validateStage(first.stage).ok).toBe(true);
  });
  test('invalid author hints fail with actionable errors rather than an unrelated maze', () => {
    const { input, author } = load('flow-sprint');
    expect(() => buildRaceCourse(input, { ...author, sections: author.sections.slice(0, 2) })).toThrow(
      'covers',
    );
    expect(() =>
      buildRaceCourse(input, {
        ...author,
        sections: author.sections.map((s, i) => (i ? s : { ...s, center: [0, 0] })),
      }),
    ).toThrow('walkable terrain');
    expect(() =>
      buildRaceCourse(input, {
        ...author,
        sections: author.sections.map((s, i) => (i ? s : { ...s, elementIds: [] })),
      }),
    ).toThrow('provenance');
    const sections = [...author.sections];
    [sections[1], sections[4]] = [sections[4], sections[1]];
    expect(() => buildRaceCourse(input, { ...author, sections })).toThrow('No safe cardinal connector');
  });
});
