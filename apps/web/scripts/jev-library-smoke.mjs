import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5176/dev/jev');
await page.waitForFunction(
  () => document.querySelector('.jev-stage-title h2')?.textContent.includes('Hacker News'),
  null,
  { timeout: 30000 },
);
await page.waitForFunction(() => !document.querySelector('.jev-primary')?.disabled);
await page.screenshot({ path: 'docs/build-log/assets/jev/library-desktop.png' });
console.log(
  'READY',
  await page.locator('.jev-stage-title').innerText(),
  await page.locator('.jev-score').innerText(),
  await page.locator('.jev-error').allTextContents(),
  errors,
);
await page.getByLabel('Explorer', { exact: true }).selectOption('jev');
await page.getByRole('button', { name: 'Start watching' }).click();
await page.waitForFunction(
  () =>
    document.querySelector('.jev-stage-footer')?.textContent.includes('decisions') &&
    !document.querySelector('.jev-stage-footer')?.textContent.includes('0 decisions'),
  null,
  { timeout: 30000 },
);
await page.waitForTimeout(15000);
console.log(
  'START',
  await page.locator('.jev-stage-footer').innerText(),
  await page.locator('.jev-error').allTextContents(),
);
await page.screenshot({ path: 'docs/build-log/assets/jev/library-live.png' });
await page.waitForFunction(
  () =>
    ['finished', 'failed', 'error'].includes(
      document.querySelector('.jev-status')?.textContent?.toLowerCase() ?? '',
    ),
  null,
  { timeout: 300000 },
);
console.log(
  'FINISH',
  await page.locator('.jev-stage-footer').innerText(),
  await page.locator('.jev-score').innerText(),
  await page.locator('.jev-error').allTextContents(),
);
await page.getByRole('button', { name: /Run history/ }).click();
await page.locator('.jev-run').first().click();
await page.getByRole('button', { name: 'Play recording' }).waitFor();
await page.screenshot({ path: 'docs/build-log/assets/jev/library-history.png' });
console.log('REPLAY', await page.locator('.jev-error').allTextContents());
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: 'docs/build-log/assets/jev/library-mobile.png' });
console.log('OVERFLOW', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), errors);
await browser.close();
