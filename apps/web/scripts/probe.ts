/**
 * Dev aid: open a game URL in headless Chromium (real GPU), run optional JS steps, save a screenshot and print
 * console output. `node apps/web/scripts/probe.ts <url> <out.png> [waitMs] [js]`
 */
import { chromium } from 'playwright';

const [url = 'http://localhost:5173/', out = '/tmp/probe.png', wait = '6000', js] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(Number(wait));
if (js) console.log(JSON.stringify(await page.evaluate(js), null, 1));
await page.screenshot({ path: out });
await browser.close();
