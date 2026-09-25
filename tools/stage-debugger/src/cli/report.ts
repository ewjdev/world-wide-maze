/**
 * Build every capture fixture (all slices × difficulties × seeds) in Node, validate, time, and print a
 * statistics comparison against the 2013 AID-DCC stage.
 *
 *   node tools/stage-debugger/src/cli/report.ts [--seeds 1-5] [--difficulties easy,normal,hard] [--slug hn-front] [--md]
 */
import { validateStage } from '@wwm/schema';
import { buildStageUnchecked, type StageStats, sliceCount, stageStats, statsRows } from '@wwm/stage-builder';
import { listCaptureSlugs, loadCapture, loadReferenceStage } from '@wwm/stage-builder/node';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? dflt) : dflt;
};
const [s0, s1] = opt('seeds', '1-1').split('-').map(Number) as [number, number];
const difficulties = opt('difficulties', 'normal').split(',') as ('easy' | 'normal' | 'hard')[];
const only = opt('slug', '');
const md = args.includes('--md');

const slugs = listCaptureSlugs().filter((s) => !only || s === only);
let failures = 0;
const perSlug: { slug: string; stats: StageStats[] }[] = [];
for (const slug of slugs) {
  const { capture, image } = loadCapture(slug);
  const n = sliceCount(capture);
  const collected: StageStats[] = [];
  for (const difficulty of difficulties) {
    for (let seed = s0; seed <= (s1 ?? s0); seed++) {
      let pageMs = 0;
      const parts: string[] = [];
      for (let slice = 0; slice < n; slice++) {
        const t0 = performance.now();
        const r = buildStageUnchecked({ capture, image, sliceIndex: slice, seed, difficulty });
        pageMs += performance.now() - t0;
        const v = validateStage(r.stage);
        if (!v.ok) {
          failures++;
          console.log(
            `  FAIL ${slug} s${slice} ${difficulty} seed ${seed}:`,
            v.errors.slice(0, 6).map((e) => `${e.code} ${e.message}`),
          );
        }
        const st = stageStats(r.stage);
        if (difficulty === 'normal' || difficulties.length === 1) collected.push(st);
        parts.push(
          `s${slice}: ${st.islands}i ${st.bridges}b ${st.elevators}e ${st.smallItems}+${st.largeItems}it${r.debug.attempt ? ` reroll${r.debug.attempt}` : ''}`,
        );
      }
      console.log(
        `${slug.padEnd(18)} ${difficulty.padEnd(6)} seed ${seed}  ${pageMs.toFixed(0).padStart(5)} ms  ${parts.join(' | ')}`,
      );
    }
  }
  perSlug.push({ slug, stats: collected });
}

const ref = loadReferenceStage();
const cols: StageStats[] = [];
const heads: string[] = [];
if (ref) {
  cols.push(stageStats(ref));
  heads.push('2013 AID-DCC');
}
for (const { slug, stats } of perSlug) {
  if (stats[0]) {
    cols.push(stats[0]);
    heads.push(slug);
  }
}
const rows = statsRows(cols);
if (md) {
  console.log(`\n| metric | ${heads.join(' | ')} |`);
  console.log(`|---|${heads.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
} else {
  console.log(`\n${'metric'.padEnd(42)}${heads.map((h) => h.slice(0, 16).padEnd(18)).join('')}`);
  for (const [name, ...vals] of rows)
    console.log(`${name.padEnd(42)}${vals.map((v) => v.padEnd(18)).join('')}`);
}
console.log(failures === 0 ? '\nall stages valid' : `\n${failures} invalid stage(s)`);
process.exitCode = failures === 0 ? 0 : 1;
