/**
 * Dev aid: deep-link a stage, drive the ball with the keyboard and log its position (worker physics).
 * `node apps/web/scripts/drive-probe.ts <baseUrl> [stageRef]`
 */
import { chromium } from 'playwright';

const [base = 'http://localhost:5173', ref = 'fixture-hn-front'] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  localStorage.setItem('wwm.howtoSeen', '1');
  localStorage.setItem('wwm.tutorialDone', '1');
  (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = { noAutoPause: true, skipIntro: true };
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text());
});
await page.goto(`${base}/play/${ref}`);
await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 60_000 });
const st = () =>
  page.evaluate(() => {
    const d = window.__wwmGame?.debugState();
    return JSON.stringify(d && { phase: d.phase, driver: d.driver, ball: d.ball.map((v) => +v.toFixed(2)), t: d.timer.int });
  });
console.log('start', await st());
for (const [key, n] of [
  ['ArrowUp', 4],
  ['ArrowRight', 3],
] as const) {
  await page.keyboard.down(key);
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(500);
    console.log(key, await st());
  }
  await page.keyboard.up(key);
}
await page.screenshot({ path: '/tmp/drive.png' });
await browser.close();
