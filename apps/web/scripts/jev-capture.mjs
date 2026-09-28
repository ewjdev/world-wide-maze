import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.goto('http://127.0.0.1:5176/dev/jev');
  await page.waitForFunction(() => !document.querySelector('.jev-primary')?.disabled, null, {
    timeout: 60000,
  });
  await page.getByRole('button', { name: /Run history/ }).click();
  await page.locator('.jev-run').first().waitFor();
  await page.screenshot({ path: 'docs/build-log/assets/jev/history-list.png' });
  await page.locator('.jev-run').filter({ hasText: 'finished' }).first().click();
  await page.getByRole('button', { name: 'Play recording' }).waitFor();
  await page.locator('.jev-field select').selectOption('1');
  await page.getByRole('button', { name: 'Show this decision in the maze' }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'docs/build-log/assets/jev/history-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/build-log/assets/jev/mobile.png' });
  await page.getByRole('button', { name: 'Hide notebook' }).click();
  await page.screenshot({ path: 'docs/build-log/assets/jev/mobile-collapsed.png' });
  await page.getByRole('button', { name: /Run history/ }).click();
  console.log('mobile history visible', await page.locator('.jev-notebook').isVisible());
  await page.screenshot({ path: 'docs/build-log/assets/jev/mobile-history.png' });
  console.log('overflow', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log('errors', await page.locator('.jev-error').allTextContents());
} finally {
  await browser.close();
}
