/**
 * Captures every page in `tools/batch-eval/eval-captures.json` that isn't in `fixtures/captures/` yet, through
 * `pnpm fixture:capture` (the shared capture sequence). Run from the repo root:
 *   node tools/batch-eval/src/cli/capture-set.ts [--dpr 1] [--force]
 * DPR 1 by default: the builder's geometry is scale-invariant (Phase 03 test) and contracts §9 CCR-07-2 makes the
 * bundle screenshot a 1× analysis image anyway; 1× keeps the committed eval set small.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CAPTURES_DIR, loadEvalCaptures, REPO_ROOT } from '../paths.ts';

const { values } = parseArgs({
  options: { dpr: { type: 'string', default: '1' }, force: { type: 'boolean', default: false } },
});

const failed: string[] = [];
for (const c of loadEvalCaptures()) {
  if (!values.force && existsSync(`${CAPTURES_DIR}/${c.slug}/capture.json`)) {
    console.log(`skip ${c.slug}`);
    continue;
  }
  console.log(`=== ${c.slug} ← ${c.url}`);
  const args = ['fixture:capture', c.url, c.slug, '--dpr', values.dpr as string];
  if (c.dark) args.push('--dark');
  const r = spawnSync('pnpm', args, { cwd: REPO_ROOT, stdio: 'inherit' });
  if (r.status !== 0) failed.push(c.slug);
}
if (failed.length) console.log(`failed: ${failed.join(', ')}`);
