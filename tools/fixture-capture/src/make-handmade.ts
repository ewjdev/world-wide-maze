/**
 * pnpm --filter @wwm/fixture-capture handmade   → fixtures/stages/handmade-simple.json + .png
 * pnpm fixture:texture                          → only re-render the .png
 *
 * The stage is validated with `validateStage` before anything is written. The texture is rendered by
 * Playwright Chromium from generated HTML (so labels/grid are real text), 1280×1600, DPR 1.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateStage } from '@wwm/schema';
import { chromium } from 'playwright';
import { formatJson } from './format.ts';
import { buildHandmadeStage, HANDMADE_TEXTURE_SIZE, handmadeTextureHtml } from './handmade.ts';
import { STAGES_DIR } from './paths.ts';

async function main(): Promise<void> {
  const textureOnly = process.argv.includes('--texture-only');
  const stage = await buildHandmadeStage();
  const v = validateStage(stage);
  if (!v.ok)
    throw new Error(
      `handmade-simple fails validateStage:\n${v.errors.map((e) => `  ${e.code} ${e.path ?? ''}: ${e.message}`).join('\n')}`,
    );
  await mkdir(STAGES_DIR, { recursive: true });

  if (!textureOnly) {
    await writeFile(
      resolve(STAGES_DIR, 'handmade-simple.json'),
      formatJson(stage, ['items', 'bridges', 'elevators']),
    );
    console.log(`✔ wrote fixtures/stages/handmade-simple.json (stageId ${stage.stageId.slice(0, 12)}…)`);
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { ...HANDMADE_TEXTURE_SIZE }, deviceScaleFactor: 1 });
    await page.setContent(handmadeTextureHtml(stage), { waitUntil: 'load' });
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...HANDMADE_TEXTURE_SIZE } });
    await writeFile(resolve(STAGES_DIR, 'handmade-simple.png'), png);
    console.log(`✔ wrote fixtures/stages/handmade-simple.png (${(png.byteLength / 1024).toFixed(0)} KiB)`);
  } finally {
    await browser.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
