/**
 * Phase 03b: the builder fixes for the Phase 09 solver's issues (docs/build-log/phase-09-builder-issues.md) and
 * the difficulty levers. The end-to-end proof is the batch eval (tools/batch-eval); these pin each mechanism.
 */
import type { StageData, Vec2 } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { removeDiagonalPinches } from '../src/contours.ts';
import { buildStage, DIFFICULTY_PARAMS, resolveParams } from '../src/index.ts';
import { fillInlets, labelComponents } from '../src/islands.ts';
import { loadCapture } from '../src/node/index.ts';
import { D } from '../src/params.ts';
import { cutRailGaps, polylineLength } from '../src/rails.ts';
import { stageStats } from '../src/stats.ts';
import { analyzeWalkable, onMain, splitAtNecks } from '../src/walkable.ts';
import { maskFrom, maskToRows } from './helpers.ts';

describe('walkable area (BI-1)', () => {
  /** Two 60 × 60 px squares joined by a 20 px long neck `neck` px wide. */
  const dumbbell = (neck: number) => {
    const y0 = 30 - neck / 2;
    return [
      {
        contour: [
          [0, 0],
          [60, 0],
          [60, y0],
          [80, y0],
          [80, 0],
          [140, 0],
          [140, 60],
          [80, 60],
          [80, y0 + neck],
          [60, y0 + neck],
          [60, 60],
          [0, 60],
        ] as Vec2[],
        holes: [],
      },
    ];
  };

  test('a neck narrower than the ball splits the walkable area; a wide one does not', () => {
    const narrow = analyzeWalkable(dumbbell(13), 200, 100, 1.5, 7.75);
    expect(narrow.parts[0]).toBe(2);
    // only the main part counts: one square is main, the other is not
    expect(onMain(narrow, 1, [30, 30]) !== onMain(narrow, 1, [110, 30])).toBe(true);
    const wide = analyzeWalkable(dumbbell(20), 200, 100, 1.5, 7.75);
    expect(wide.parts[0]).toBe(1);
    expect(onMain(wide, 1, [30, 30]) && onMain(wide, 1, [110, 30])).toBe(true);
    // slack: a point near the edge is within reach of the main part
    expect(onMain(wide, 1, [2, 30])).toBe(false);
    expect(onMain(wide, 1, [2, 30], 9)).toBe(true);
  });

  test('splitAtNecks cuts two island-sized parts apart at the neck', () => {
    const { mask, cols, rows } = maskFrom([
      '..........................',
      '.##########....##########.',
      '.##########....##########.',
      '.##########....##########.',
      '.########################.',
      '.##########....##########.',
      '.##########....##########.',
      '.##########....##########.',
      '..........................',
    ]);
    expect(labelComponents(mask, cols, rows).count).toBe(1);
    // 3 px cells: parts are 30 × 21 px, the neck is 1 cell (3 px) thick
    const cuts = splitAtNecks(mask, cols, rows, 3, { clearancePx: 7.5, minThicknessPx: 18, minAreaPx2: 200 });
    expect(cuts).toBe(1);
    expect(labelComponents(mask, cols, rows).count).toBe(2);
  });
});

describe('raster fixes', () => {
  test('diagonal contact: two islands are separated, one island is filled', () => {
    const two = maskFrom(['##..', '##..', '..##', '..##']);
    removeDiagonalPinches(two.mask, two.cols, two.rows);
    expect(labelComponents(two.mask, two.cols, two.rows).count).toBe(2);
    const one = maskFrom(['###', '#.#', '##.', '...']);
    // the ring's own diagonal (cells (2,1) and (1,2)) belongs to one component: filled, not cut
    removeDiagonalPinches(one.mask, one.cols, one.rows);
    expect(labelComponents(one.mask, one.cols, one.rows).count).toBe(1);
  });

  test('fillInlets closes a narrow slit inside one island but never joins two', () => {
    const { mask, cols, rows } = maskFrom([
      '##############',
      '........##....',
      '##############',
      '..............',
      '##############',
    ]);
    const n = fillInlets(mask, cols, rows, 2);
    expect(n).toBeGreaterThan(0);
    const out = maskToRows(mask, cols, rows);
    expect(out[1]).toBe('##############'); // the slit between the two strips of one island is filled
    expect(out[3]).toBe('..............'); // the gap to the separate strip below stays water
  });
});

describe('rail gaps (hard)', () => {
  test('gaps cut ≈ gap/every of a long rail, away from the ends and the avoid points', () => {
    const line: Vec2[] = [
      [0, 0],
      [1000, 0],
    ];
    const out = cutRailGaps([line], {
      gapPx: 27,
      everyPx: 216,
      keepEndsPx: 27,
      avoid: [],
      avoidPx: 0,
      next: () => 0.5,
    });
    const kept = out.reduce((s, l) => s + polylineLength(l), 0);
    expect(out.length).toBe(5); // 4 gaps
    expect(kept).toBeCloseTo(1000 - 4 * 27, 5);
    expect((out[0] as Vec2[])[0]).toEqual([0, 0]);
    const avoided = cutRailGaps([line], {
      gapPx: 27,
      everyPx: 216,
      keepEndsPx: 27,
      avoid: [[500, 0]],
      avoidPx: 1000,
      next: () => 0.5,
    });
    expect(avoided).toEqual([line]);
  });
});

describe('difficulty levers (BI-5)', () => {
  test('resolveParams: difficulty levers, then caller overrides', () => {
    expect(resolveParams(undefined, 'hard').bridgeWidthMaxPx).toBe(DIFFICULTY_PARAMS.hard.bridgeWidthMaxPx);
    expect(resolveParams({ bridgeWidthMaxPx: 40 }, 'hard').bridgeWidthMaxPx).toBe(40);
    expect(resolveParams(undefined, 'normal')).toEqual(resolveParams());
  });

  test('easy, normal and hard build different stages from the same page', { timeout: 60_000 }, () => {
    const { capture, image } = loadCapture('govuk-card-grid');
    const build = (difficulty: StageData['difficulty']) =>
      buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty }).stage;
    const [easy, normal, hard] = [build('easy'), build('normal'), build('hard')];
    const strip = (s: StageData) => JSON.stringify({ ...s, stageId: '', difficulty: '' });
    expect(strip(hard)).not.toBe(strip(normal));
    expect(strip(easy)).not.toBe(strip(normal));
    const [se, sn, sh] = [stageStats(easy), stageStats(normal), stageStats(hard)];
    // hard: the narrowest legal decks, open rails, fewer restart points; never loops
    expect(Math.max(...hard.bridges.map((b) => b.width))).toBeLessThanOrEqual(2.7 * D);
    expect(sh.bridgeWidthD.median).toBeLessThan(sn.bridgeWidthD.median);
    expect(sh.railCoverage).toBeLessThan(sn.railCoverage - 0.03);
    expect(sh.restartPoints).toBeLessThan(sn.restartPoints / 2);
    expect(sh.isTree).toBe(true);
    // easy: loops back in (alternative routes)
    expect(se.isTree).toBe(false);
  });
});
