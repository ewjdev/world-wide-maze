import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://127.0.0.1:5176/dev/jev');
await page.waitForFunction(() =>
  document.querySelector('.jev-stage-title h2')?.textContent.includes('Hacker News'),
);
await page.locator('.jev-setup select').first().selectOption('fixture-mdn-dark-docs');
await page.waitForFunction(() => document.querySelector('.jev-stage-title h2')?.textContent.includes('MDN'));
await page.getByLabel('Section', { exact: true }).selectOption('1');
await page.waitForFunction(() =>
  document.querySelector('.jev-stage-title h2')?.textContent.includes('section 2'),
);
await page.screenshot({ path: 'docs/build-log/assets/jev/library-mdn-mobile.png' });
console.log(
  await page.locator('.jev-stage-title').innerText(),
  await page.locator('.jev-error').allTextContents(),
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
);
await browser.close();
