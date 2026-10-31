import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.WWM_PLAYTIME_E2E_BASE ?? 'http://127.0.0.1:4188';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('wwm.howtoSeen', '1');
    localStorage.setItem('wwm.tutorialDone', '1');
    window.__WWM_TEST__ = { noAutoPause: true, skipIntro: true };
  });
  await page.goto(`${base}/play/practice?offline=1&backend=webgl`);
  await page.waitForFunction(() => window.__wwmGame?.getView().engineReady);
  await page.evaluate(() => {
    window.__wwmGame.start();
    window.__wwmGame.playKeyboard();
  });
  await page.waitForFunction(() => ['play', 'intro', 'countdown'].includes(window.__wwmGame?.phase));
  console.log('Maze entered:', await page.evaluate(() => window.__wwmGame.phase));
  await page.waitForFunction(() => window.__wwmGame?.phase === 'play');
  await page.getByRole('button', { name: 'Grown-ups: playtime', exact: true }).click();
  await page.getByLabel('Create a caregiver PIN').fill('4286');
  await page.getByLabel('Repeat your PIN').fill('4286');
  await page.getByRole('button', { name: 'Start a new session' }).click();
  await page.clock.install();
  await page.clock.fastForward(301000);
  await page.getByRole('heading', { name: 'Your adventure can rest' }).waitFor();
  const before = await page.evaluate(() => ({
    time: window.__wwmGame.getView().timeInt,
    state: window.__wwmGame.debugState(),
  }));
  await page.clock.fastForward(10000);
  const after = await page.evaluate(() => ({
    time: window.__wwmGame.getView().timeInt,
    state: window.__wwmGame.debugState(),
  }));
  assert.equal(after.time, before.time);
  assert.equal(after.state.tick, before.state.tick);
  await page.evaluate(() => window.__wwmGame.resume());
  await page.clock.fastForward(3000);
  assert.equal(await page.evaluate(() => window.__wwmGame.getView().timeInt), before.time);
  console.log('PASS active maze: expiry freezes timer/simulation and direct resume cannot bypass it');
} finally {
  await browser.close();
}
