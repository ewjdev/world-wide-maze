/**
 * Regenerate the builder golden snapshots: fixtures/builder/<slug>.normal.seed1.json (slice 0, compact JSON).
 * Run after an intentional builder change, review the debugger screenshots, then commit.
 *
 *   node tools/stage-debugger/src/cli/goldens.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStage } from '@wwm/stage-builder';
import { BUILDER_FIXTURES_DIR, listCaptureSlugs, loadCapture } from '@wwm/stage-builder/node';

mkdirSync(BUILDER_FIXTURES_DIR, { recursive: true });
for (const slug of listCaptureSlugs()) {
  const { capture, image } = loadCapture(slug);
  const { stage } = buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' });
  const file = join(BUILDER_FIXTURES_DIR, `${slug}.normal.seed1.json`);
  writeFileSync(file, `${JSON.stringify(stage)}\n`);
  console.log(
    `wrote ${file} (${stage.islands.length} islands, ${stage.bridges.length} bridges, ${stage.elevators.length} elevators, ${stage.items.length} items)`,
  );
}
