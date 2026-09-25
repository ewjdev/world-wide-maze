/**
 * Acceptance tests on the real capture fixtures (plans/phase-03 "Acceptance criteria"):
 * - every fixture × slice × difficulty × seeds 1–5 builds and passes validateStage
 * - golden snapshots (slice 0, normal, seed 1) in fixtures/builder/
 * - count summary within expected ranges
 * - every full page builds in < 1.5 s in Node (timings logged)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CaptureBundle, type Difficulty, type RGBAImage, sliceCount, validateStage } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { buildStage } from '../src/index.ts';
import { BUILDER_FIXTURES_DIR, listCaptureSlugs, loadCapture } from '../src/node/index.ts';
import { stageStats } from '../src/stats.ts';

const slugs = listCaptureSlugs();
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
          const { stage } = buildStage({ capture, image, sliceIndex, seed, difficulty });
          const v = validateStage(stage);
          expect(v.errors, `${slug} slice ${sliceIndex} ${difficulty} seed ${seed}`).toEqual([]);
        }
  });

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
