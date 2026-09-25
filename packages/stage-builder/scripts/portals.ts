/**
 * Phase 13 debug CLI: the portals the builder places on each fixture slice (normal, seed 1 unless given).
 *
 *   node packages/stage-builder/scripts/portals.ts [slug …] [--seed N] [--difficulty easy|normal|hard]
 */
import { type Difficulty, sliceCount, validateStage } from '@wwm/schema';
import { buildStage } from '../src/index.ts';
import { listCaptureSlugs, loadCapture } from '../src/node/index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const seed = Number(flag('--seed') ?? 1);
const difficulty = (flag('--difficulty') ?? 'normal') as Difficulty;
const slugs = args.length ? args : listCaptureSlugs().filter((s) => !s.startsWith('eval-'));

for (const slug of slugs) {
  const { capture, image } = loadCapture(slug);
  const linked = capture.elements.filter((e) => e.href).length;
  for (let i = 0; i < sliceCount(capture); i++) {
    const t0 = performance.now();
    const { stage } = buildStage({ capture, image, sliceIndex: i, seed, difficulty });
    const ms = Math.round(performance.now() - t0);
    const v = validateStage(stage);
    const list = (stage.portals ?? []).map((p) => `${p.label.slice(0, 32)} → ${new URL(p.href).host}`);
    console.log(
      `${slug} ${i + 1}/${sliceCount(capture)} ${ms} ms ${v.ok ? 'valid' : 'INVALID'} · ${linked} linked · ${list.length} portal(s)`,
    );
    for (const l of list) console.log(`    ${l}`);
  }
}
