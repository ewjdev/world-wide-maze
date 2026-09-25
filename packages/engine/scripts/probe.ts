/** Ad-hoc probe: open the sandbox, run a JS snippet, print the result (dev aid for Phase 04). */
import { chromium } from 'playwright';

const [url = 'http://localhost:5174/dev/engine?clock=manual&ui=0&quality=high', js = '1', shot] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => (window as never as { __stageReady?: boolean }).__stageReady === true, null, {
  timeout: 60000,
});
console.log(JSON.stringify(await page.evaluate(js), null, 1));
if (shot) await page.screenshot({ path: shot });
await browser.close();
