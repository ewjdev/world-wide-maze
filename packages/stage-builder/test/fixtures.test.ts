/**
 * Acceptance tests on the real capture fixtures (plans/phase-03 "Acceptance criteria"):
 * - every fixture × slice × difficulty × seeds 1–5 builds and passes validateStage, plus the 03b playability
 *   invariants (lift rises ≥ 3.7 D, deck rails ≤ a ball radius over their islands, no reachability issue)
 * - golden snapshots (slice 0, normal, seed 1) in fixtures/builder/, for every capture including the eval-* set
 * - count summary within expected ranges
 * - every full page builds in < 1.5 s in Node (timings logged)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BALL_RADIUS_PX,
  type CaptureBundle,
  type Difficulty,
  type RGBAImage,
  sliceCount,
  validateStage,
} from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { railDepthOnIslands } from '../src/bridges.ts';
import { buildStage, DEFAULT_PARAMS } from '../src/index.ts';
import { BUILDER_FIXTURES_DIR, listCaptureSlugs, loadCapture } from '../src/node/index.ts';
import { stageStats } from '../src/stats.ts';

// Phase 09's eval set (fixtures/captures/eval-*, 28 pages) gets golden snapshots only; its full seed/difficulty
// matrix (and the solver) runs in tools/batch-eval, which would add ~100 s here.
const allSlugs = listCaptureSlugs();
const slugs = allSlugs.filter((s) => !s.startsWith('eval-'));
const cache = new Map<string, { capture: CaptureBundle; image: RGBAImage }>();
const load = (slug: string) => {
  let v = cache.get(slug);
  if (!v) {
    v = loadCapture(slug);
    cache.set(slug, v);
  }
  return v;
};
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

test('there are capture fixtures', () => {
  expect(slugs.length).toBeGreaterThanOrEqual(5);
});

describe.each(slugs)('%s', (slug) => {
  test('all slices × difficulties × seeds 1–5 validate', { timeout: 180_000 }, () => {
    const { capture, image } = load(slug);
    const n = sliceCount(capture);
    for (const difficulty of DIFFICULTIES)
      for (let seed = 1; seed <= 5; seed++)
        for (let sliceIndex = 0; sliceIndex < n; sliceIndex++) {
          const { stage, debug } = buildStage({ capture, image, sliceIndex, seed, difficulty });
          const where = `${slug} slice ${sliceIndex} ${difficulty} seed ${seed}`;
          const v = validateStage(stage);
          expect(v.errors, where).toEqual([]);
          expect(debug.reachIssues, where).toEqual([]);
          for (const e of stage.elevators)
            expect(e.levelHigh - e.levelLow, `${where} elevator ${e.id}`).toBeGreaterThanOrEqual(
              DEFAULT_PARAMS.elevatorMinRiseD - 1e-9,
            );
          const byId = new Map(stage.islands.map((i) => [i.id, i]));
          for (const b of stage.bridges) {
            const box = (id: number) => ({
              contour: byId.get(id)?.contour ?? [],
              holes: [],
              bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
            });
            const d = railDepthOnIslands(b.a, b.b, b.width, box(b.from), box(b.to));
            expect(Math.max(d.a, d.b), `${where} bridge ${b.id} rail over island`).toBeLessThanOrEqual(
              BALL_RADIUS_PX,
            );
          }
        }
  });

  test('count summary within expected ranges (normal, seed 1)', { timeout: 60_000 }, () => {
    const { capture, image } = load(slug);
    for (let sliceIndex = 0; sliceIndex < sliceCount(capture); sliceIndex++) {
      const { stage } = buildStage({ capture, image, sliceIndex, seed: 1, difficulty: 'normal' });
      const s = stageStats(stage);
      const where = `${slug} slice ${sliceIndex}`;
      // sparse pages are allowed to be tiny; content pages should look like 2013's dozens of islands
      expect(s.islands, where).toBeGreaterThanOrEqual(slug === 'example-sparse' ? 2 : 6);
      expect(s.islands, where).toBeLessThanOrEqual(90);
      expect(s.isTree, `${where}: normal is a perfect maze`).toBe(true);
      expect(s.largeItems, where).toBeLessThanOrEqual(6);
      expect(s.smallPer10D2, where).toBeLessThanOrEqual(3);
      if (slug !== 'example-sparse') {
        expect(s.smallItems, where).toBeGreaterThan(20);
        expect(s.largeItems, where).toBeGreaterThanOrEqual(1);
      }
      expect(s.railCoverage, where).toBeGreaterThan(0.75);
      expect(s.railCoverage, where).toBeLessThanOrEqual(1.0001);
      expect(s.levels.min, where).toBeGreaterThanOrEqual(9);
      expect(s.levels.max, where).toBeLessThanOrEqual(23.5);
      expect(s.bridgeWidthD.min, where).toBeGreaterThanOrEqual(2.5);
      expect(s.landShare, where).toBeGreaterThan(slug === 'example-sparse' ? 0.01 : 0.1);
    }
  });

  test('builds the whole page in < 1.5 s (Node)', { timeout: 60_000 }, () => {
    const { capture, image } = load(slug);
    const n = sliceCount(capture);
    buildStage({ capture, image, sliceIndex: 0, seed: 9, difficulty: 'normal' }); // warm up JIT and the Lab LUT
    const t0 = performance.now();
    for (let sliceIndex = 0; sliceIndex < n; sliceIndex++)
      buildStage({ capture, image, sliceIndex, seed: 1, difficulty: 'normal' });
    const ms = performance.now() - t0;
    console.log(
      `[perf] ${slug}: ${n} slice(s) ${capture.page.width}×${capture.page.height} in ${ms.toFixed(0)} ms`,
    );
    expect(ms).toBeLessThan(1500);
  });
});

describe.each(allSlugs)('%s golden', (slug) => {
  test('golden snapshot (slice 0, normal, seed 1) and byte-identical rebuild', { timeout: 60_000 }, () => {
    const { capture, image } = load(slug);
    const input = { capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' as const };
    const a = JSON.stringify(buildStage(input).stage);
    const b = JSON.stringify(buildStage(input).stage);
    expect(a).toBe(b);
    const file = join(BUILDER_FIXTURES_DIR, `${slug}.normal.seed1.json`);
    expect(existsSync(file), `missing golden ${file}; run node tools/stage-debugger/src/cli/goldens.ts`).toBe(
      true,
    );
    expect(`${a}\n`).toBe(readFileSync(file, 'utf8'));
  });
});
