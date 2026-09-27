import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5176/dev/jev');
await page.waitForFunction(() =>
  document.querySelector('.jev-stage-title h2')?.textContent.includes('Hacker News'),
);
await page.waitForFunction(() => document.querySelector('.jev-score')?.textContent.includes('1,312'));
await page.screenshot({ path: 'docs/build-log/assets/jev/library-desktop.png' });
await page.getByRole('button', { name: /Run history/ }).click();
await page.locator('.jev-run').first().waitFor();
await page.locator('.jev-run').first().click();
await page.getByRole('button', { name: 'Play recording' }).waitFor();
await page.locator('.jev-field select').selectOption('2');
await page.getByRole('button', { name: 'Show this decision in the maze' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/build-log/assets/jev/library-history.png' });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: 'docs/build-log/assets/jev/library-mobile.png' });
console.log(
  'REPLAY SEEK',
  await page.locator('.jev-score').innerText(),
  await page.locator('.jev-error').allTextContents(),
);
console.log('OVERFLOW', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), errors);
await page.getByRole('button', { name: /Run history/ }).click();
await page.screenshot({ path: 'docs/build-log/assets/jev/library-mobile-history.png' });
await browser.close();
if (errors.length) process.exitCode = 1;
