import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.WWM_PLAYTIME_E2E_BASE ?? 'http://127.0.0.1:4188';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const shots = '/tmp/wwm-playtime-review';
await mkdir(shots, { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install();
    await page.goto(`${base}/learn/lessons/count-three/`);
    await page.getByRole('button', { name: 'Grown-ups: playtime', exact: true }).click();
    await page.getByLabel('Create a caregiver PIN').fill('4286');
    await page.clock.runFor(2000);
    assert.equal(await page.getByLabel('Create a caregiver PIN').inputValue(), '4286');
    await page.getByLabel('Repeat your PIN').fill('4286');
    await page.screenshot({ path: `${shots}/setup-${width}.png` });
    await page.getByRole('button', { name: 'Start a new session' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.playtime === 'playing');
    const deadline = await page.evaluate(() => JSON.parse(localStorage.getItem('wwm.playtime.v1')).endsAt);
    await page.locator('#pip-start').click();
    const answer = await page.evaluate(
      () =>
        JSON.parse(document.getElementById('wwm-learning').textContent).activities.find(
          (a) => a.id === 'count-three',
        ).rounds[0].answer,
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await page.locator('#next').isVisible()) break;
      await page.locator(`[data-answer="${answer}"]`).click();
    }
    await page.locator('#next').waitFor({ state: 'visible' });
    await page.clock.fastForward(240000);
    await page.waitForFunction(() => document.documentElement.dataset.playtime === 'closing');
    await page.screenshot({ path: `${shots}/closing-${width}.png` });
    await page.reload();
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem('wwm.playtime.v1')).endsAt),
      deadline,
    );
    await page.goto(`${base}/play/practice?offline=1&backend=webgl`);
    await page.waitForSelector('[data-testid="game-root"]');
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem('wwm.playtime.v1')).endsAt),
      deadline,
    );
    await page.clock.fastForward(61000);
    await page.getByRole('heading', { name: 'Your adventure can rest' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.pt-dialog').evaluate((el) => el.open), true);
    await page.getByText('Practised: One, two, three', { exact: true }).waitFor();
    await page.screenshot({ path: `${shots}/accomplishment-${width}.png` });
    await page.reload();
    await page.getByRole('heading', { name: 'Your adventure can rest' }).waitFor();
    const tab = await context.newPage();
    await tab.goto(`${base}/learn/lessons/count-five/`);
    await tab.getByRole('heading', { name: 'Your adventure can rest' }).waitFor();
    await tab.getByRole('button', { name: 'Grown-ups: new session' }).click();
    await tab.getByLabel('Caregiver PIN').fill('0000');
    await tab.getByRole('button', { name: 'Start a new session' }).click();
    await tab.getByRole('alert').filter({ hasText: 'PIN did not match' }).waitFor();
    await tab.getByLabel('Caregiver PIN').fill('4286');
    await tab.getByRole('button', { name: 'Start a new session' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.playtime === 'playing');
    await tab.getByRole('button', { name: 'All done', exact: true }).click();
    await tab.getByRole('heading', { name: 'Your adventure can rest' }).waitFor();
    await page.getByRole('heading', { name: 'Your adventure can rest' }).waitFor();
    assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS ${width}px: shared deadline, closing, refresh, lesson → maze, expiry, PIN, cross-tab authorization and stopping`,
    );
  }
} finally {
  await browser.close();
}
