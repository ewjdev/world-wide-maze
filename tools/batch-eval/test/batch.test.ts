import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCapture } from '@wwm/schema';
import { listCaptureSlugs } from '@wwm/stage-builder/node';
import { describe, expect, test } from 'vitest';
import { renderDashboard } from '../src/html.ts';
import { CAPTURES_DIR, EVAL_DIR, loadEvalCaptures } from '../src/paths.ts';
import { Raster } from '../src/raster.ts';
import { dist, type EvalReport, group, runStats } from '../src/report.ts';
import { type EvalRecord, runJob } from '../src/run.ts';

function rec(p: Partial<EvalRecord>): EvalRecord {
  return {
    slug: 'a',
    slice: 0,
    sliceCount: 1,
    difficulty: 'normal',
    seed: 1,
    stageSeed: 1,
    stageId: 'x',
    size: { width: 1280, height: 800 },
    buildOk: true,
    valid: true,
    validationErrors: [],
    islands: 3,
    bridges: 2,
    ramps: 0,
    elevators: 0,
    smallItems: 0,
    largeItems: 1,
    buildMs: 10,
    audit: { split: 0, noGround: 0, issues: [] },
    solved: true,
    playable: true,
    parSec: 30,
    falls: 0,
    jumps: 0,
    stars: 1,
    variant: 'normal',
    attempts: [],
    routeM: 50,
    items: 1,
    solveCpuMs: 100,
    speedup: 300,
    ...p,
  };
}

describe('eval set', () => {
  test('≥ 25 captures; every eval-* source is captured and valid', () => {
    const slugs = listCaptureSlugs();
    expect(slugs.length).toBeGreaterThanOrEqual(25);
    const sources = loadEvalCaptures();
    expect(sources.some((s) => s.lang === 'ja')).toBe(true);
    expect(sources.some((s) => s.dark)).toBe(true);
    for (const s of sources) {
      expect(s.slug).toMatch(/^eval-/);
      const bundle = parseCapture(
        JSON.parse(readFileSync(join(CAPTURES_DIR, s.slug, 'capture.json'), 'utf8')),
      );
      expect(bundle.page.width).toBe(1280);
    }
  });
});

describe('report aggregation', () => {
  test('dist', () => {
    expect(dist([])).toMatchObject({ n: 0 });
    const d = dist([5, 1, 3, 2, 4]);
    expect(d).toMatchObject({ n: 5, min: 1, max: 5, p50: 3, mean: 3 });
  });

  test('group counts rates, failures and over-par', () => {
    const g = group([
      rec({}),
      rec({ solved: true, playable: false, parSec: 200 }),
      rec({
        solved: false,
        playable: false,
        parSec: 0,
        failure: { kind: 'narrow-neck', at: [0, 0], islandId: 1 },
      }),
      rec({ buildOk: false, solved: false, playable: false }),
    ]);
    expect(g.stages).toBe(4);
    expect(g.solved).toBe(2);
    expect(g.playable).toBe(1);
    expect(g.overPar).toBe(1);
    expect(g.failures['narrow-neck']).toBe(1);
    expect(g.failures['build-failed']).toBe(1);
  });

  test('runStats: a run is playable only if every slice is; prefix = slices publishable in order', () => {
    const r = runStats([
      rec({ slug: 'p', slice: 0, sliceCount: 3 }),
      rec({ slug: 'p', slice: 1, sliceCount: 3, playable: false }),
      rec({ slug: 'p', slice: 2, sliceCount: 3 }),
      rec({ slug: 'q', slice: 0 }),
    ]);
    expect(r.overall).toMatchObject({ runs: 2, playable: 1 });
    expect(r.list.find((x) => x.slug === 'p')).toMatchObject({
      prefix: 1,
      playableSlices: 2,
      playable: false,
    });
  });
});

describe('dashboard', () => {
  test('embeds the data and the rating UI', () => {
    const records = [rec({ thumb: 'thumbs/a.png' }), rec({ seed: 2, playable: false, solved: false })];
    const report: EvalReport = {
      schema: 'wwm.eval/1',
      generatedAt: '2026-09-25T00:00:00.000Z',
      builderVersion: 'b',
      physicsVersion: 'p',
      host: { node: 'v', platform: 'x', cpu: 'c', workers: 1 },
      parRejectSec: 150,
      wallMs: 1,
      overall: group(records),
      byDifficulty: { normal: group(records) },
      bySet: {},
      runs: runStats(records),
      records,
    };
    const html = renderDashboard(report);
    expect(html).toContain('recognizable?');
    expect(html).toContain('fun?');
    expect(html).toContain('api/ratings');
    const json = html.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)?.[1];
    expect(JSON.parse(json ?? 'null').records).toHaveLength(2);
  });

  test('the committed dashboard and report exist', () => {
    expect(existsSync(join(EVAL_DIR, 'index.html'))).toBe(true);
    const r = JSON.parse(readFileSync(join(EVAL_DIR, 'report.json'), 'utf8')) as EvalReport;
    expect(r.schema).toBe('wwm.eval/1');
    expect(r.records.length).toBeGreaterThan(0);
  });
});

describe('runJob', () => {
  test('example-sparse slice 0: builds, validates, solves, renders a thumbnail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wwm-eval-'));
    const r = await runJob({
      slug: 'example-sparse',
      slice: 0,
      difficulty: 'normal',
      seed: 1,
      thumbPath: join(dir, 't.png'),
    });
    expect(r.buildOk && r.valid && r.solved && r.playable).toBe(true);
    expect(r.parSec).toBeGreaterThan(0);
    expect(r.stars).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(dir, 't.png'))).toBe(true);
  }, 60_000);

  test('raster primitives stay inside the image', () => {
    const r = new Raster(10, 10);
    r.line(-5, -5, 20, 20, 3, [255, 0, 0, 255]);
    r.disc(5, 5, 20, [0, 255, 0, 128]);
    expect(r.data.length).toBe(400);
    expect(r.data[3]).toBe(255);
  });
});
