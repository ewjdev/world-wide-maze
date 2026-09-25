/**
 * Batch eval: every capture fixture × slice × difficulty × seed → build → validate → solve, in a worker pool.
 * Writes fixtures/eval/report.json and fixtures/eval/index.html (+ thumbs/, gitignored).
 *   node tools/batch-eval/src/cli/batch.ts [--slugs a,b] [--difficulties easy,normal,hard] [--seeds 1-3]
 *        [--workers N] [--out fixtures/eval] [--no-html]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';
import { PHYSICS_VERSION } from '@wwm/physics';
import type { Difficulty } from '@wwm/schema';
import { PAR_REJECT_SEC } from '@wwm/solver';
import { BUILDER_VERSION } from '@wwm/stage-builder';
import { listCaptureSlugs } from '@wwm/stage-builder/node';
import { renderDashboard } from '../html.ts';
import { EVAL_DIR } from '../paths.ts';
import { type EvalReport, group, runStats } from '../report.ts';
import { type EvalJob, type EvalRecord, slicesOf } from '../run.ts';

const { values } = parseArgs({
  options: {
    slugs: { type: 'string' },
    difficulties: { type: 'string', default: 'easy,normal,hard' },
    seeds: { type: 'string', default: '1-3' },
    workers: { type: 'string' },
    out: { type: 'string', default: EVAL_DIR },
    'no-html': { type: 'boolean', default: false },
  },
});

function range(s: string): number[] {
  return s.split(',').flatMap((p) => {
    const [a, b] = p.split('-').map(Number) as [number, number | undefined];
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
}

const out = values.out as string;
const slugs = values.slugs ? values.slugs.split(',') : listCaptureSlugs();
const diffs = (values.difficulties as string).split(',') as Difficulty[];
const seeds = range(values.seeds as string);
const thumbsDir = `${out}/thumbs`;
rmSync(thumbsDir, { recursive: true, force: true });
mkdirSync(thumbsDir, { recursive: true });

const jobs: EvalJob[] = [];
for (const slug of slugs) {
  const n = slicesOf(slug);
  for (let slice = 0; slice < n; slice++)
    for (const difficulty of diffs)
      for (const seed of seeds) {
        const name = `${slug}.s${slice}.${difficulty}.${seed}.png`;
        const job: EvalJob = { slug, slice, difficulty, seed };
        if (difficulty === 'normal' && seed === seeds[0]) job.thumbPath = `${thumbsDir}/${name}`;
        else job.thumbOnFail = `${thumbsDir}/${name}`;
        jobs.push(job);
      }
}
// Largest pages first for better packing.
const nWorkers = Number(values.workers ?? Math.max(1, Math.min(availableParallelism() - 1, 12)));
console.log(`${jobs.length} jobs (${slugs.length} captures), ${nWorkers} workers`);

const t0 = performance.now();
const records: EvalRecord[] = [];
let next = 0;
let done = 0;
await new Promise<void>((resolve, reject) => {
  let live = 0;
  const start = () => {
    const w = new Worker(new URL('../worker.ts', import.meta.url));
    live++;
    const feed = () => {
      if (next >= jobs.length) {
        void w.terminate();
        if (--live === 0) resolve();
        return;
      }
      const id = next++;
      w.postMessage({ id, job: jobs[id] });
    };
    w.on('message', (m: { id: number; rec?: EvalRecord; error?: string }) => {
      done++;
      if (m.rec) {
        records.push(m.rec);
        const r = m.rec;
        const tag = r.playable ? 'ok  ' : r.solved ? 'SLOW' : 'FAIL';
        console.log(
          `[${done}/${jobs.length}] ${tag} ${r.slug} s${r.slice} ${r.difficulty} seed ${r.seed}: par ${r.parSec.toFixed(1)} s, ` +
            `cpu ${r.solveCpuMs.toFixed(0)} ms${r.failure ? `, ${r.failure.kind} (island ${r.failure.islandId})` : ''}`,
        );
      } else console.error(`job ${m.id} crashed: ${m.error}`);
      feed();
    });
    w.on('error', reject);
    feed();
  };
  for (let i = 0; i < Math.min(nWorkers, jobs.length); i++) start();
});
records.sort(
  (a, b) =>
    a.slug.localeCompare(b.slug) ||
    a.slice - b.slice ||
    diffs.indexOf(a.difficulty) - diffs.indexOf(b.difficulty) ||
    a.seed - b.seed,
);
for (const r of records) if (r.thumb) r.thumb = r.thumb.replace(`${out}/`, '');

const byDifficulty: Record<string, ReturnType<typeof group>> = {};
for (const d of diffs) byDifficulty[d] = group(records.filter((r) => r.difficulty === d));
const report: EvalReport = {
  schema: 'wwm.eval/1',
  generatedAt: new Date().toISOString(),
  builderVersion: BUILDER_VERSION,
  physicsVersion: PHYSICS_VERSION,
  host: {
    node: process.version,
    platform: process.platform,
    cpu: cpus()[0]?.model ?? '?',
    workers: nWorkers,
  },
  parRejectSec: PAR_REJECT_SEC,
  wallMs: performance.now() - t0,
  overall: group(records),
  byDifficulty,
  bySet: {
    'fixtures (Phase 02)': group(records.filter((r) => !r.slug.startsWith('eval-'))),
    'eval-*': group(records.filter((r) => r.slug.startsWith('eval-'))),
  },
  runs: runStats(records),
  records,
};
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 1)}\n`);
if (!values['no-html']) writeFileSync(`${out}/index.html`, renderDashboard(report));
const o = report.overall;
console.log(
  `\nstages ${o.stages}: solved ${o.solved} (${(o.solvedRate * 100).toFixed(1)} %), playable ${o.playable} (${(o.playableRate * 100).toFixed(1)} %)`,
);
for (const [d, g] of Object.entries(byDifficulty))
  console.log(
    `  ${d}: solved ${(g.solvedRate * 100).toFixed(1)} %, playable ${(g.playableRate * 100).toFixed(1)} %, par p50 ${g.parSec.p50.toFixed(1)} s p90 ${g.parSec.p90.toFixed(1)} s max ${g.parSec.max.toFixed(1)} s, cpu p50 ${g.cpuMs.p50.toFixed(0)} ms p90 ${g.cpuMs.p90.toFixed(0)} ms`,
  );
console.log('  failures:', JSON.stringify(o.failures));
console.log(`  runs: ${report.runs.overall.playable}/${report.runs.overall.runs} fully playable`);
console.log(`wall ${(report.wallMs / 1000).toFixed(1)} s → ${out}/report.json`);
