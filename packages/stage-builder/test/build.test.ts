/** End-to-end tests of `buildStage` on synthetic captures. */
import { computeStageId, MAX_STAGE_HEIGHT_PX, sliceCount, validateStage } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { BUILDER_VERSION, BuildError, buildStage, buildStageUnchecked } from '../src/index.ts';
import { stageStats } from '../src/stats.ts';
import { synthCapture } from './helpers.ts';

const twoBlocks = (scale = 1) =>
  synthCapture(
    640,
    400,
    [
      { rect: { x: 60, y: 100, w: 200, h: 150 }, kind: 'image', color: [200, 60, 60] },
      { rect: { x: 320, y: 100, w: 200, h: 150 }, kind: 'image', color: [60, 60, 200] },
    ],
    { scale },
  );

describe('buildStage', () => {
  test('two rectangles → 2 islands and 1 bridge, valid, start left and goal right', () => {
    const { capture, image } = twoBlocks();
    const { stage, debug } = buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' });
    expect(validateStage(stage).errors).toEqual([]);
    expect(stage.islands).toHaveLength(2);
    expect(stage.bridges.length + stage.elevators.length).toBe(1);
    expect(stage.start.pos[0]).toBeLessThan(stage.goal.pos[0]);
    expect(stage.islands.map((i) => i.sourceElementIds)).toEqual([[0], [1]]);
    expect(stage.texture).toEqual({ path: '', width: 640, height: 400, scale: 1 });
    expect(stage.timeLimitSec).toBe(300);
    expect(debug.labels.length).toBe(debug.cols * debug.rows);
    expect(debug.candidateBridges).toHaveLength(1);
    expect(Object.keys(debug.timingsMs)).toContain('total');
  });

  test('deterministic: same input → byte-identical JSON; different seed → different maze details', () => {
    const { capture, image } = twoBlocks();
    const input = { capture, image, sliceIndex: 0, seed: 42, difficulty: 'hard' as const };
    const a = JSON.stringify(buildStage(input).stage);
    const b = JSON.stringify(buildStage(input).stage);
    expect(a).toBe(b);
    const c = JSON.stringify(buildStage({ ...input, seed: 43 }).stage);
    expect(c).not.toBe(a);
  });

  test('stageId matches computeStageId', async () => {
    const { capture, image } = twoBlocks();
    const { stage } = buildStage({ capture, image, sliceIndex: 0, seed: 5, difficulty: 'easy' });
    expect(stage.stageId).toBe(await computeStageId(capture.captureId, 0, 5, BUILDER_VERSION, 'easy'));
  });

  test('screenshot scale 2 gives the same geometry as scale 1', () => {
    const one = twoBlocks(1);
    const two = twoBlocks(2);
    const s1 = buildStage({ ...one, sliceIndex: 0, seed: 3, difficulty: 'normal' }).stage;
    const s2 = buildStage({ ...two, sliceIndex: 0, seed: 3, difficulty: 'normal' }).stage;
    expect(s2.texture).toEqual({ path: '', width: 1280, height: 800, scale: 2 });
    expect(s2.islands.map((i) => i.contour)).toEqual(s1.islands.map((i) => i.contour));
    expect(s2.bridges).toEqual(s1.bridges);
  });

  test('slices: stage-local coordinates, clipped elements, out-of-slice provenance', () => {
    const h = MAX_STAGE_HEIGHT_PX + 600; // 2 balanced slices of 1150 px
    const { capture, image } = synthCapture(640, h, [
      { rect: { x: 60, y: 100, w: 200, h: 150 }, kind: 'image', color: [200, 60, 60] },
      { rect: { x: 360, y: 100, w: 200, h: 150 }, kind: 'image', color: [60, 200, 60] },
      { rect: { x: 60, y: 1300, w: 200, h: 150 }, kind: 'image', color: [60, 60, 200] },
      { rect: { x: 360, y: 1300, w: 200, h: 150 }, kind: 'image', color: [200, 200, 60] },
      { rect: { x: 60, y: 1100, w: 500, h: 100 }, kind: 'image', color: [120, 60, 120] }, // straddles 1150
    ]);
    expect(sliceCount(capture)).toBe(2);
    const s1 = buildStage({ capture, image, sliceIndex: 1, seed: 1, difficulty: 'normal' }).stage;
    expect(validateStage(s1).errors).toEqual([]);
    expect(s1.source.slice).toEqual({ index: 1, count: 2, y: 1150, height: 1150 });
    expect(s1.size).toEqual({ width: 640, height: 1150 });
    const ys = s1.islands.flatMap((i) => i.contour.map((p) => p[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...ys)).toBeLessThan(60); // the straddling block was clipped to the slice top
    expect(s1.provenance.dropped).toContainEqual({ elementId: 0, reason: 'out-of-slice' });
    expect(s1.provenance.keptElementIds).toEqual(expect.arrayContaining([2, 3, 4]));
  });

  test('a blank slice still yields a valid single-island stage (fallback)', () => {
    const { capture, image } = synthCapture(640, 400, []);
    const { stage } = buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' });
    expect(validateStage(stage).ok).toBe(true);
    expect(stage.islands).toHaveLength(1);
    expect(stage.provenance.notes.join(' ')).toMatch(/fallback/);
  });

  test('fixed elements are dropped with reason "fixed"', () => {
    const { capture, image } = twoBlocks();
    capture.elements.push({
      id: 99,
      kind: 'header',
      rect: { x: 0, y: 0, w: 640, h: 40 },
      depth: 2,
      z: 10,
      fixed: true,
    });
    const { stage } = buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' });
    expect(stage.provenance.dropped).toContainEqual({ elementId: 99, reason: 'fixed' });
  });

  test('easy difficulty may add loops; normal is a perfect maze', () => {
    // a 3×3 grid of blocks has 12 candidate edges and 8 tree edges
    const blocks = [];
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++)
        blocks.push({
          rect: { x: 40 + x * 200, y: 40 + y * 200, w: 160, h: 160 },
          kind: 'image' as const,
          color: [90, 90, 90] as [number, number, number],
        });
    const { capture, image } = synthCapture(640, 640, blocks);
    const normal = buildStage({ capture, image, sliceIndex: 0, seed: 2, difficulty: 'normal' }).stage;
    expect(stageStats(normal).isTree).toBe(true);
    const easy = buildStage(
      { capture, image, sliceIndex: 0, seed: 2, difficulty: 'easy' },
      { params: { loopShare: { easy: 1, normal: 0, hard: 0 } } },
    ).stage;
    expect(easy.bridges.length + easy.elevators.length).toBeGreaterThan(8);
    expect(validateStage(easy).ok).toBe(true);
  });

  test('BuildError carries BUILD_FAILED when nothing validates', () => {
    const { capture, image } = twoBlocks();
    // an impossible minimum island thickness removes everything but the fallback; a zero-width deck can't validate
    const r = buildStageUnchecked(
      { capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' },
      { params: { bridgeWidthMinPx: 1, bridgeWidthMaxPx: 3 } },
    );
    expect(r.debug.validationErrors.length).toBeGreaterThan(0);
    expect(() =>
      buildStage(
        { capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' },
        { params: { bridgeWidthMinPx: 1, bridgeWidthMaxPx: 3 } },
      ),
    ).toThrow(BuildError);
  });
});
