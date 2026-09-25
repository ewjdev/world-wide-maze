// Unit tests on a tiny synthetic WWMMM-shaped stage (invented data; no third-party content).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cropRows, decodePng, encodePng } from './png.ts';
import { checkStructure, convertWwmmm, resolveScale, signedArea, type WwmmmStage } from './wwmmm-to-stage.ts';

// Two 200x100 islands side by side, 50px gap, the right one 20px higher; one ramp-like bridge (type 0),
// one elevator (type 1) back, two small items, one large item. Outer rings listed with negative
// shoelace area in page coords, as in the real data.
const rect = (x: number, y: number, w: number, h: number): number[] => [x, y, x, y + h, x + w, y + h, x + w, y];
const fixture: WwmmmStage = {
  title: 'Synthetic', url: 'https://example.test/',
  start: [100, 50, 100], goal: [350, 50, 120],
  islands: [
    { id: 0, level: 100, contours: [rect(0, 0, 200, 100)], guardrails: [[0, 0, 0, 100]], restartPoints: [100, 50] },
    { id: 1, level: 120, contours: [rect(250, 0, 200, 100)], guardrails: [[450, 0, 450, 100]], restartPoints: [350, 50] },
  ],
  bridges: [
    { angle: 0, distance: 50, level: [100, 120], start: [200, 30], type: 0, width: 39 },
    { angle: 180, distance: 50, level: [120, 100], start: [250, 70], type: 1, width: 39 },
  ],
  small_items: [100, 50, 100, 60, 50, 100],
  large_items: [350, 50, 120],
};

test('ball scale matches 2013 ball radius to contract ball radius', () => {
  assert.equal(resolveScale('raw'), 1);
  assert.ok(Math.abs(resolveScale('ball') - 20 / 5.4) < 1e-9);
});

test('converts flat arrays, triplets, bridges and elevators', () => {
  const { stage, extra } = convertWwmmm(fixture, { scale: 'raw', texturePath: 't.png', texture: { width: 1024, height: 1356 } });
  assert.equal(stage.schema, 'wwm.stage/1');
  assert.equal(stage.islands.length, 2);
  assert.deepEqual(stage.islands[0].contour[1], [0, 100]);
  assert.equal(stage.items.length, 3);
  assert.equal(stage.items.filter((i) => i.kind === 'large').length, 1);
  assert.equal(stage.items[2].islandId, 1);
  assert.equal(stage.bridges.length, 1);
  assert.deepEqual([stage.bridges[0].from, stage.bridges[0].to], [0, 1]);
  assert.deepEqual(stage.bridges[0].b, [250, 30]);
  assert.equal(stage.elevators.length, 1);
  assert.deepEqual([stage.elevators[0].islandFrom, stage.elevators[0].islandTo], [1, 0]);
  assert.equal(stage.start.islandId, 0);
  assert.equal(stage.goal.islandId, 1);
  assert.equal(stage.timeLimitSec, 300);
  assert.equal((extra.counts as { smallItems: number }).smallItems, 2);
  assert.ok(signedArea(stage.islands[0].contour) < 0);
});

test('structural check flags contract violations', () => {
  const { stage } = convertWwmmm(fixture, { scale: 'raw', texturePath: 't.png', texture: { width: 1, height: 1 } });
  const issues = checkStructure(stage);
  assert.ok(issues.some((s) => s.includes('width 39 < 100')));
  assert.ok(!issues.some((s) => s.startsWith('unreachable')));
});

test('png round trip and crop', () => {
  const data = new Uint8Array(4 * 3 * 4).map((_, i) => (i * 37) & 0xff);
  const img = { width: 4, height: 3, data };
  const back = decodePng(encodePng(img));
  assert.deepEqual(back, img);
  const c = cropRows(back, 1, 3);
  assert.equal(c.height, 2);
  assert.deepEqual(c.data, data.slice(16));
});
