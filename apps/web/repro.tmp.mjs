import { chromium, devices, webkit } from 'playwright';

const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem('wwm.howtoSeen', '1');
  localStorage.setItem('wwm.tutorialDone', '1');
  window.__WWM_TEST__ = { skipIntro: true, noAutoPause: true };
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 200));
});
await p.goto(process.argv[2] + '/play/fixture-portal-hub?offline=1&perf');
for (let i = 0; i < 60; i++) {
  const ph = await p.evaluate(() => document.body.dataset.phase);
  if (ph === 'play') break;
  const btn = await p.$('button:has-text("joystick"), button:has-text("Joystick")');
  if (btn) await btn.click().catch(() => {});
  await p.waitForTimeout(1000);
}
console.log(
  'phase',
  await p.evaluate(() => document.body.dataset.phase),
  'mode',
  await p.evaluate(() => window.__wwmGame?.debugState?.().phase),
);
await p.waitForTimeout(2000);
console.log('roll', await p.evaluate(() => window.__wwmGame.debugRollIntoPortal(2, 5)));
await p.waitForSelector('[data-testid="portal-travel"]', { timeout: 20000 });
await p.click('[data-testid="portal-travel"]');
const t0 = Date.now();
for (let k = 0; k < 40; k++) {
  const st = await p.evaluate(() => {
    const s = window.__wwmGame.debugState();
    const w = document.querySelector('[data-testid="travel-window"]');
    const b = document.querySelector('[data-testid="building"]');
    const r = b?.getBoundingClientRect();
    return {
      phase: s.phase,
      win: w?.dataset.stage ?? null,
      building: b
        ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} vis=${getComputedStyle(b).visibility} op=${getComputedStyle(b).opacity}`
        : null,
      stage: s.stageId?.slice(0, 6),
    };
  });
  if (k % 3 === 0) console.log(`${Date.now() - t0}ms`, JSON.stringify(st));
  if (k === 6) await p.screenshot({ path: '/tmp/pw-shots/repro-building.png' });
  if (st.phase === 'intro' || st.phase === 'error') {
    console.log('end', JSON.stringify(st));
    break;
  }
  await p.waitForTimeout(500);
}
console.log('errors', errs.slice(0, 8));
await b.close();
