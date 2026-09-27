import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5176/dev/jev');
await page.getByRole('button', { name: 'Start watching' }).waitFor({ state: 'visible' });
await page.waitForFunction(() => !document.querySelector('.jev-primary')?.disabled);
await page.locator('.jev-setup select').nth(1).selectOption('baseline');
await page.getByRole('button', { name: 'Start watching' }).click();
await page.waitForTimeout(3500);
console.log(
  'CURRENT',
  await page.locator('.jev-stage-footer').innerText(),
  await page.locator('.jev-error').allTextContents(),
  errors,
);
await page.screenshot({ path: 'docs/build-log/assets/jev/desktop.png' });
await page.getByRole('button', { name: 'Pause', exact: true }).click();
await page.waitForTimeout(800);
console.log(
  'PAUSED',
  await page.locator('.jev-stage-footer').innerText(),
  await page.locator('.jev-error').allTextContents(),
);
await page.getByRole('button', { name: 'Next decision', exact: true }).click();
await page.waitForFunction(() => document.querySelector('.jev-status')?.textContent !== 'paused');
await page.waitForFunction(() => document.querySelector('.jev-status')?.textContent === 'paused', null, {
  timeout: 45000,
});
console.log(
  'STEPPED',
  await page.locator('.jev-stage-footer').innerText(),
  await page.locator('.jev-error').allTextContents(),
);
await page.getByRole('button', { name: 'Resume', exact: true }).click();
await page.waitForFunction(
  () => ['finished', 'error', 'failed'].includes(document.querySelector('.jev-status')?.textContent ?? ''),
  null,
  { timeout: 120000 },
);
console.log(
  'RESULT',
  await page.locator('.jev-stage-footer').innerText(),
  await page.locator('.jev-error').allTextContents(),
  errors,
);
await page.getByRole('button', { name: /Run history/ }).click();
await page.locator('.jev-run').first().waitFor();
await page.locator('.jev-run').first().click();
await page.getByRole('button', { name: 'Play recording' }).waitFor();
await page.getByRole('button', { name: 'Show this decision in the maze' }).click();
await page.waitForTimeout(500);
console.log('REPLAY', await page.locator('.jev-error').allTextContents());
await page.screenshot({ path: 'docs/build-log/assets/jev/history-desktop.png' });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: 'docs/build-log/assets/jev/mobile.png' });
console.log('OVERFLOW', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
await browser.close();
if (errors.length) process.exitCode = 1;
