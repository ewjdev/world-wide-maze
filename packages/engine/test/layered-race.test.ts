import { readFileSync } from 'node:fs';
import { PX_PER_METER, type StageData } from '@wwm/schema';
import { Vector3 } from 'three/webgpu';
import { expect, test } from 'vitest';
import { ChaseCamera } from '../src/camera/chase.ts';
import { buildHeightfield, lineOfSight, sampleFloor, sampleTop } from '../src/geom/heightfield.ts';

const base: StageData = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
);
const layered: StageData = {
  ...base,
  bridges: [],
  elevators: [],
  islands: [10, 14].map((level, id) => ({
    ...(base.islands[0] as StageData['islands'][number]),
    id,
    level,
    contour: [
      [0, 0],
      [600, 0],
      [600, 600],
      [0, 600],
    ],
    holes: [],
    guardrails: [],
  })),
};

test('overhead race decks do not replace the lower camera floor or hide lower collisions', () => {
  const hf = buildHeightfield(layered);
  expect(sampleTop(hf, 15, 15)).toBe(14);
  expect(sampleFloor(hf, 15, 15, 13)).toBe(10);
  expect(sampleFloor(hf, 15, 15, 9)).toBeNaN();
  expect(lineOfSight(hf, [15, 10.8, 15], [15, 13, 19])).toBe(1);
  expect(lineOfSight(hf, [15, 9, 15], [15, 11, 15])).toBeLessThan(1);
  expect(lineOfSight(hf, [15, 13, 15], [15, 15, 15])).toBeLessThan(1);
  const chase = new ChaseCamera(hf);
  chase.reset(new Vector3(15, 10.5, 15), new Vector3(15, 10.5, 10));
  expect(chase.position.y).toBeLessThan(13.5);
});

test('heightfield follows the curved deck instead of filling its straight chord', () => {
  const stage: StageData = {
    ...base,
    islands: [],
    elevators: [],
    bridges: [
      {
        id: 0,
        from: 0,
        to: 1,
        a: [100, 100],
        b: [500, 100],
        control: [300, 500],
        width: 40,
        levelA: 10,
        levelB: 10,
        type: 'flat',
        bank: 0.18,
        rails: false,
      },
    ],
  };
  const hf = buildHeightfield(stage);
  expect(sampleTop(hf, 300 / PX_PER_METER, 300 / PX_PER_METER)).toBeCloseTo(10, 1);
  expect(sampleTop(hf, 300 / PX_PER_METER, 100 / PX_PER_METER)).toBeNaN();
});
