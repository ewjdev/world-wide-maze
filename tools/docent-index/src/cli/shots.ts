/**
 * Screenshots of the docent panel for the build record (docs/build-log/assets/phase-15/). Needs the web app and
 * the Worker running (mock provider is fine):
 *
 *   node tools/docent-index/src/cli/shots.ts http://127.0.0.1:5173
 *
 * Error states (rate limit, daily cap, network) are produced with Playwright route stubs, not by exhausting the
 * real limits. File names must not start with "b" (the /log page's asset glob skips b* files).
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = fileURLToPath(new URL('../../../../docs/build-log/assets/phase-15/', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const shot = async (page: Page, name: string, selector = '#ask') => {
  await page
    .locator(selector)
    .first()
    .screenshot({ path: resolve(out, `${name}.png`), animations: 'disabled' });
  console.log(`→ ${name}.png`);
};
const sse = (events: object[]) =>
  events
    .map((e) => {
      const { type, ...data } = e as { type: string };
      return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    })
    .join('');

async function open(width: number, lang: 'en' | 'ja' = 'en', path = '/about#ask') {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((l) => localStorage.setItem('wwm.lang', l), lang);
  const page = await ctx.newPage();
  await page.goto(base + path);
  await page.locator('#ask').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#ask').scrollIntoViewIfNeeded();
  return page;
}
const askVia = async (page: Page, q: string) => {
  await page.locator('#ask textarea').fill(q);
  await page.locator('#ask textarea').press('Enter');
};
const settle = (page: Page) =>
  page.locator('#ask [data-status="streaming"]').waitFor({ state: 'detached', timeout: 20_000 });

// 1. idle, desktop
let page = await open(1350);
await shot(page, 'docent-idle');
// 2. streaming (an uncached question, caught mid-answer), then the answer with sources
await page.locator('#ask .dc-suggest button').first().click();
await page.locator('#ask [data-status="streaming"] .dc-a p:not(.dc-thinking)').first().waitFor();
await page.waitForTimeout(250);
await shot(page, 'docent-streaming');
await settle(page);
await shot(page, 'docent-answer');
// 3. a follow-up the sources don't cover
await askVia(page, 'What was Saqoosha’s favourite food?');
await settle(page);
await shot(page, 'docent-dont-know');
// 4. off-topic
await askVia(page, 'Write a poem about cats.');
await settle(page);
await shot(page, 'docent-rejected');
await page.context().close();

// 5. error states via stubs
page = await open(1350);
await page.route('**/api/docent', (r) =>
  r.fulfill({
    status: 429,
    headers: { 'content-type': 'text/event-stream' },
    body: sse([
      {
        type: 'error',
        code: 'RATE_LIMITED',
        message: 'You’ve asked a lot of questions this hour. Try again in about 12 minutes.',
      },
    ]),
  }),
);
await askVia(page, 'How were points scored in the 2013 game?');
await settle(page);
await shot(page, 'docent-rate-limited', '#ask .dc-desk');
await page.unroute('**/api/docent');
await page.route('**/api/docent', (r) => r.abort('connectionrefused'));
await askVia(page, 'When did World Wide Maze launch?');
await settle(page);
await shot(page, 'docent-network-error', '#ask .dc-desk');
await page.context().close();

// 6. /log compact, 7. mobile, 8. Japanese UI
page = await open(1350, 'en', '/log');
await shot(page, 'docent-log-compact');
await page.context().close();
page = await open(390);
await page.locator('#ask .dc-suggest button').nth(1).click();
await settle(page);
await shot(page, 'docent-mobile');
await page.context().close();
page = await open(1350, 'ja');
await shot(page, 'docent-ja-idle');
await page.locator('#ask .dc-suggest button').first().click();
await settle(page);
await shot(page, 'docent-ja-answer');
await page.context().close();

await browser.close();
