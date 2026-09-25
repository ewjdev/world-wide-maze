// Unit tests on a tiny synthetic WWMMM-shaped stage (invented data; no third-party content).
import assert from 'node:assert/strict';
import { isCCW, parseStage, validateStage } from '@wwm/schema';
import { test } from 'vitest';
import { cropRows, decodePng, encodePng, padRows } from './png.ts';
import { convertWwmmm, resolveScale, summarise, type WwmmmStage } from './wwmmm-to-stage.ts';

// Two 200x100 islands side by side, 50px gap, the right one 20px higher; one ramp-like bridge (type 0),
// one DESCENDING elevator (type 1) back, two small items, one large item. Outer rings listed with negative
// shoelace area in page coords, as in the real data.
const rect = (x: number, y: number, w: number, h: number): number[] => [
  x,
  y,
  x,
  y + h,
  x + w,
  y + h,
  x + w,
  y,
];
const fixture: WwmmmStage = {
  title: 'Synthetic',
  url: 'https://example.test/',
  start: [100, 50, 100],
  goal: [350, 50, 120],
  islands: [
    {
      id: 0,
      level: 100,
      contours: [rect(0, 0, 200, 100)],
      guardrails: [[0, 0, 0, 100]],
      restartPoints: [100, 50],
    },
    {
      id: 1,
      level: 120,
      contours: [rect(250, 0, 200, 100)],
      guardrails: [[450, 0, 450, 100]],
      restartPoints: [350, 50],
    },
  ],
  bridges: [
    { angle: 0, distance: 50, level: [100, 120], start: [200, 30], type: 0, width: 39 },
    { angle: 180, distance: 50, level: [120, 100], start: [250, 70], type: 1, width: 39 },
  ],
  small_items: [100, 50, 100, 60, 50, 100],
  large_items: [350, 50, 120],
};
const opts = { texturePath: 't.png', texture: { width: 1024, height: 1358 } };

test('ball scale matches the 2013 ball radius to the contract ball radius (×1.25)', () => {
  assert.equal(resolveScale('raw'), 1);
  assert.equal(resolveScale('ball'), 1.25);
});

test('converts to a structurally valid v0.2 StageData', async () => {
  const { stage, extra } = await convertWwmmm(fixture, { ...opts, scale: 'raw' });
  assert.doesNotThrow(() => parseStage(stage));
  assert.equal(stage.schema, 'wwm.stage/2');
  assert.equal(stage.builderVersion, '0.2.0-wwmmm-import');
  assert.match(stage.stageId, /^[0-9a-f]{64}$/);
  assert.equal(stage.islands.length, 2);
  // Outer rings flipped to positive shoelace area.
  assert.ok(stage.islands.every((i) => isCCW(i.contour)));
  assert.equal(stage.items.length, 3);
  assert.equal(stage.items.filter((i) => i.kind === 'large').length, 1);
  assert.equal(stage.items[2]?.islandId, 1);
  assert.equal(stage.bridges.length, 1);
  assert.deepEqual([stage.bridges[0]?.from, stage.bridges[0]?.to], [0, 1]);
  assert.deepEqual(stage.bridges[0]?.b, [250, 30]);
  assert.equal(stage.bridges[0]?.type, 'ramp');
  assert.equal(stage.start.islandId, 0);
  assert.equal(stage.goal.islandId, 1);
  assert.equal(stage.timeLimitSec, 300);
  assert.equal((extra.counts as { smallItems: number }).smallItems, 2);
  assert.deepEqual(stage.source.slice, { index: 0, count: 1, y: 0, height: 1358 });
  assert.deepEqual(stage.size, { width: 1024, height: 1358 });
  assert.equal(stage.texture.scale, 1);
});

test('float levels in ball diameters at the ball scale', async () => {
  const { stage } = await convertWwmmm(fixture, { ...opts, scale: 'ball' });
  // h / 10.8 (2013 ball diameter in px).
  assert.equal(stage.islands[0]?.level, 9.2593);
  assert.equal(stage.islands[1]?.level, 11.1111);
  assert.deepEqual(stage.size, { width: 1280, height: 1697.5 });
  assert.equal(stage.texture.scale, 0.8);
  assert.equal(stage.goal.radius, 12.5);
});

test('descending 2013 elevator becomes from = lower island, a = lower platform', async () => {
  const { stage } = await convertWwmmm(fixture, { ...opts, scale: 'raw' });
  const e = stage.elevators[0];
  assert.ok(e);
  assert.deepEqual([e.islandFrom, e.islandTo], [0, 1]);
  assert.deepEqual(
    [e.a, e.b],
    [
      [200, 70],
      [250, 70],
    ],
  );
  assert.equal(e.levelLow, stage.islands[0]?.level);
  assert.equal(e.levelHigh, stage.islands[1]?.level);
  assert.equal(e.travelSec, 1.3); // 1000 + 20 px * 0.1 * 150 ms
  assert.equal(e.cooldownSec, 2);
});

test('issues come from the real validateStage', async () => {
  const { stage, issues } = await convertWwmmm(fixture, { ...opts, scale: 'raw' });
  assert.deepEqual(issues, validateStage(stage).errors);
  const codes = new Set(issues.map((i) => i.code));
  // Δ20 px over a 50 px deck is far steeper than 10°: a genuine violation the synthetic data contains.
  assert.ok(codes.has('ramp-too-steep'));
  assert.ok(!codes.has('unreachable-island'));
  assert.ok(!codes.has('schema'));
  assert.ok(!codes.has('contour-orientation'));
  assert.ok(!codes.has('elevator-level-mismatch'));
  assert.ok(summarise(issues).some((l) => l.includes('ramp-too-steep')));
});

test('png round trip, crop and pad', () => {
  const data = new Uint8Array(4 * 3 * 4).map((_, i) => (i * 37) & 0xff);
  const img = { width: 4, height: 3, data };
  const back = decodePng(encodePng(img));
  assert.deepEqual(back, img);
  const c = cropRows(back, 1, 3);
  assert.equal(c.height, 2);
  assert.deepEqual(c.data, data.slice(16));
  const p = padRows(c, 4);
  assert.equal(p.height, 4);
  assert.deepEqual(p.data.slice(32, 48), data.slice(32, 48)); // repeated last row
  assert.deepEqual(p.data.slice(48, 64), data.slice(32, 48));
});
