import { chromium, devices } from 'playwright';

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem('wwm.howtoSeen', '1');
  localStorage.setItem('wwm.tutorialDone', '1');
  window.__WWM_TEST__ = { skipIntro: true, noAutoPause: true };
});
const p = await ctx.newPage();
const t0 = Date.now();
const phase = async () =>
  p
    .evaluate(() => {
      const s = window.__wwmGame?.debugState();
      return `${s?.phase}/${document.querySelector('[data-testid="travel-window"]')?.dataset.stage ?? '-'}`;
    })
    .catch(() => '?');
p.on('console', async (m) => {
  if (m.type() === 'error' || m.type() === 'warning')
    console.log(`${Date.now() - t0}ms [${await phase()}] ${m.text().slice(0, 110)}`);
});
await p.goto(process.argv[2] + '/play/fixture-portal-hub?offline=1');
await p.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 90000 });
await p.waitForTimeout(2000);
console.log(`${Date.now() - t0}ms roll`);
await p.evaluate(() => window.__wwmGame.debugRollIntoPortal(2, 5));
await p.waitForSelector('[data-testid="portal-travel"]', { timeout: 20000 });
console.log(`${Date.now() - t0}ms travel`);
await p.click('[data-testid="portal-travel"]');
await p
  .waitForFunction(
    () =>
      document.body.dataset.phase === 'countdown' ||
      (document.body.dataset.phase === 'play' && window.__wwmGame.debugState().journey.length > 1),
    null,
    { timeout: 60000 },
  )
  .catch(() => {});
console.log(`${Date.now() - t0}ms done ${await phase()}`);
await b.close();
