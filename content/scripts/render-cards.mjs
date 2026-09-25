#!/usr/bin/env node
/**
 * Render Open Graph / Twitter share cards (1200×630 PNG) of finished stages with the real engine, through the
 * web app's `/making/<id>?card=1` view. Prints the R2 upload commands; uploads nothing itself.
 *
 *   node content/scripts/render-cards.mjs <webBase> <curated-runs.json | id,id,…> [outDir=content/out/cards]
 *
 * <id> is a stored stage id (the web dev server proxies /api to the Worker) or a fixture slug.
 * The Worker serves `share/<stageId>.png` from R2 at /api/share/<stageId>/card (apps/worker/src/routes/share.ts).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = createRequire(resolve(root, 'apps/web/package.json'))('playwright');

const [base, what, outDir = 'content/out/cards'] = process.argv.slice(2);
if (!base || !what) {
  console.error('usage: render-cards.mjs <webBase> <curated-runs.json | id,id,…> [outDir]');
  process.exit(2);
}
const ids = existsSync(what)
  ? JSON.parse(readFileSync(what, 'utf8')).map((r) => r.stageIds[0])
  : what.split(',').filter(Boolean);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.emulateMedia({ reducedMotion: 'reduce' }); // fast intro, no camera lean
  await page.goto(`${base}/making/${id}?card=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.mk-3d[data-ready="1"]', { timeout: 90_000 });
  await page.waitForTimeout(2500);
  const file = resolve(outDir, `${id}.png`);
  await page.screenshot({ path: file });
  console.log(file);
  if (/^[0-9a-f]{64}$/.test(id))
    console.log(
      `  wrangler r2 object put wwm-stages/share/${id}.png --file ${file} --content-type image/png --remote`,
    );
  await page.close();
}
await browser.close();
