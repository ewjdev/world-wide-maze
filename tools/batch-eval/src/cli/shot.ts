/**
 * Screenshot the dashboard (Playwright Chromium) into docs/build-log/assets/phase-09/.
 *   node tools/batch-eval/src/cli/shot.ts [--dir fixtures/eval] [--out docs/build-log/assets/phase-09]
 */
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { EVAL_DIR, REPO_ROOT } from '../paths.ts';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: EVAL_DIR },
    out: { type: 'string', default: `${REPO_ROOT}/docs/build-log/assets/phase-09` },
  },
});
mkdirSync(values.out as string, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
const errors: string[] = [];
const loaded = async () => {
  await page.evaluate(() => {
    for (const i of document.images) i.loading = 'eager';
  });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
};
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`file://${values.dir}/index.html`);
await page.waitForSelector('.card');
await loaded();
await page.screenshot({ path: `${values.out}/dashboard.png`, fullPage: false });
await page.selectOption('#fShow', 'fail');
await loaded();
await page.screenshot({ path: `${values.out}/dashboard-failures.png`, fullPage: false });
await page.locator('#cards').scrollIntoViewIfNeeded();
await page.evaluate(() => document.getElementById('cards')?.scrollIntoView());
await page.screenshot({ path: `${values.out}/dashboard-cards.png`, fullPage: false });
await browser.close();
if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
console.log(`wrote ${values.out}/dashboard.png and dashboard-failures.png`);
