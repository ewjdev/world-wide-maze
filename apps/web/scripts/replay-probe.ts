/** Dev aid: run the practice stage with the fixture replay injected and log the game state each second. */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [base = 'http://localhost:5173', scale = '2', via = 'deeplink'] = process.argv.slice(2);
const replay = JSON.parse(
  readFileSync(new URL('../../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
);
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(
  ([r, s]) => {
    localStorage.setItem('wwm.howtoSeen', '1');
    localStorage.setItem('wwm.tutorialDone', '1');
    (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = {
      replay: r,
      lockstep: true,
      noAutoPause: true,
      timeScale: Number(s),
      skipIntro: true,
    };
  },
  [replay, scale] as const,
);
const page = await ctx.newPage();
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
if (via === 'title') {
  await page.goto(`${base}/`);
  await page.getByTestId('start').click();
  await page.getByTestId('play-keyboard').click();
  await page.getByTestId('site-practice').click();
} else await page.goto(`${base}/play/practice`);
const t0 = Date.now();
for (;;) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const d = window.__wwmGame?.debugState();
    return d && { phase: d.phase, tick: d.tick, timer: d.timer, total: d.total, small: d.small, large: d.large, ball: d.ball.map((v) => +v.toFixed(2)) };
  });
  console.log(((Date.now() - t0) / 1000).toFixed(0), JSON.stringify(s));
  if (!s || ['result', 'ranking', 'error', 'gameover'].includes(s.phase) || Date.now() - t0 > 120_000) break;
}
await browser.close();
