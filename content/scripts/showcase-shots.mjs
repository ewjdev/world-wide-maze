#!/usr/bin/env node
/**
 * Screenshots of the Phase 10 showcase pages for the build log.
 *   node content/scripts/showcase-shots.mjs <baseUrl> <outDir> [--only name,name]
 * Needs a running web dev server (`pnpm --filter @wwm/web dev`) and Playwright Chromium.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = createRequire(resolve(root, 'apps/web/package.json'))('playwright');

const [base = 'http://localhost:5173', out = 'docs/build-log/assets/phase-10', ...rest] =
  process.argv.slice(2);
const only = rest[0] === '--only' ? new Set((rest[1] ?? '').split(',')) : null;
mkdirSync(out, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** name, path, viewport, full page?, wait (selector or ms) */
const SHOTS = [
  ['about', '/about', DESKTOP, false, 1600],
  ['about-full', '/about', DESKTOP, true, 1600],
  ['about-mobile', '/about', MOBILE, false, 1600],
  ['making-capture', '/making/govuk-card-grid?step=0', DESKTOP, false, 'canvas[data-ready="1"]'],
  ['making-background', '/making/govuk-card-grid?step=1', DESKTOP, false, 'canvas[data-ready="1"]'],
  ['making-islands', '/making/govuk-card-grid?step=2', DESKTOP, false, 'canvas[data-ready="1"]'],
  ['making-bridges', '/making/govuk-card-grid?step=3', DESKTOP, false, 'canvas[data-ready="1"]'],
  ['making-maze', '/making/govuk-card-grid?step=4', DESKTOP, false, 'canvas[data-ready="1"]'],
  ['making-items', '/making/hn-front?step=5', DESKTOP, false, 'canvas[data-ready="1"]'],
  ['making-3d', '/making/govuk-card-grid?step=6', DESKTOP, false, '.mk-3d[data-ready="1"]'],
  ['making-ghost', '/making/handmade-simple?step=3', DESKTOP, false, '.mk-3d[data-ready="1"]'],
  ['making-mobile', '/making/wikipedia-article?step=2&slice=1', MOBILE, false, 'canvas[data-ready="1"]'],
  ['log', '/log', DESKTOP, false, 1200],
  ['log-table', '/log#ledger', DESKTOP, false, 1200],
  ['log-doc', '/log#phase-03', DESKTOP, false, 1200],
  ['log-mobile', '/log', MOBILE, false, 1200],
  ['ranking', '/dev/ranking', DESKTOP, true, 1200],
  ['ranking-mobile', '/dev/ranking', MOBILE, false, 1200],
];

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
for (const [name, path, viewport, fullPage, wait] of SHOTS) {
  if (only && !only.has(name)) continue;
  const page = await browser.newPage({ viewport, deviceScaleFactor: viewport === MOBILE ? 2 : 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + path, { waitUntil: 'networkidle' });
  if (typeof wait === 'number') await page.waitForTimeout(wait);
  else {
    await page.waitForSelector(wait, { timeout: 60_000 });
    await page.waitForTimeout(name.includes('3d') || name.includes('ghost') ? 4000 : 600);
  }
  await page.screenshot({ path: `${out}/${name}.png`, fullPage });
  console.log(
    `${name}.png${errors.length ? `  (${errors.length} console errors: ${errors[0]?.slice(0, 160)})` : ''}`,
  );
  await page.close();
}
await browser.close();
