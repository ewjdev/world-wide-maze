import type { StageData } from '@wwm/schema';
import { expect, test } from 'vitest';
import { DEFAULT_LAYERS, islandAt, islandHue, LAYER_LABELS, levelColor } from '../src/draw.ts';

const stage = {
  islands: [
    {
      id: 0,
      contour: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
    },
    {
      id: 1,
      contour: [
        [200, 0],
        [300, 0],
        [300, 100],
        [200, 100],
      ],
    },
  ],
} as unknown as StageData;

test('islandAt finds the island under a point', () => {
  expect(islandAt(stage, [50, 50])).toBe(0);
  expect(islandAt(stage, [250, 10])).toBe(1);
  expect(islandAt(stage, [150, 50])).toBeNull();
});

test('every layer has a UI label', () => {
  expect(LAYER_LABELS.map(([k]) => k).sort()).toEqual(Object.keys(DEFAULT_LAYERS).sort());
});

test('colors are deterministic and clamped', () => {
  expect(islandHue(3)).toBe(islandHue(3));
  expect(levelColor(0)).toBe(levelColor(9));
  expect(levelColor(100)).toBe(levelColor(24));
});
