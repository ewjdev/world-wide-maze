import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5176/dev/jev');
  await page.waitForFunction(() =>
    document.querySelector('.jev-stage-title h2')?.textContent.includes('Hacker News'),
  );
  await page.waitForFunction(() => !document.querySelector('.jev-primary')?.disabled);
  await page.getByLabel('Explorer', { exact: true }).selectOption('baseline');
  await page.getByRole('button', { name: 'Start watching' }).click();
  await page.locator('.jev-key[data-active="true"]').first().waitFor();
  console.log('LIVE', await page.locator('.jev-keyboard').getAttribute('aria-label'));
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.jev-key[data-active="true"]'));
  await page.getByRole('button', { name: 'End run', exact: true }).click();
  await page.getByRole('button', { name: /Run history/ }).click();
  await page.getByPlaceholder('Maze, model, status, date or run ID').fill('3d1c1c6c');
  await page.locator('.jev-run').filter({ hasText: '3d1c1c6c' }).click();
  await page.getByRole('button', { name: 'Play recording' }).click();
  await page.locator('.jev-key[data-active="true"]').first().waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'docs/build-log/assets/jev/inputs-desktop.png' });
  assert.match(await page.locator('.jev-input-target').innerText(), /Jev target/);
  assert.match(await page.locator('.jev-keyboard').getAttribute('aria-label'), /^Recorded/);
  await page.getByRole('button', { name: 'Follow ball', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'docs/build-log/assets/jev/inputs-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.jev-key[data-active="true"]').first().waitFor();
  const reduced = await page
    .locator('.jev-key[data-active="true"]')
    .first()
    .evaluate((el) => ({
      transition: getComputedStyle(el).transitionDuration,
      transform: getComputedStyle(el).transform,
    }));
  assert.deepEqual(reduced, { transition: '0s', transform: 'none' });
  await page.getByRole('button', { name: 'Pause recording' }).click();
  await page.waitForFunction(() => !document.querySelector('.jev-key[data-active="true"]'));
  assert.deepEqual(errors, []);
  console.log('PASS: live inputs, pause, recorded target/inputs, mobile overflow, reduced motion', reduced);
} finally {
  await browser.close();
}
