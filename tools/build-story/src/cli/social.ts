/**
 * Render the share images and the /log evidence screenshots with Playwright Chromium, against a running web dev
 * server (any port; `pnpm --filter @wwm/web exec vite --port 5288`).
 *
 *   node tools/build-story/src/cli/social.ts --url http://localhost:5288 [--pages]
 *
 * Writes content/build-story/social/{build-clock,page-to-maze,bug-gallery}.png (1200×627, LinkedIn's link and
 * image size) and og-log.png (1200×630). With --pages, also desktop and mobile screenshots of /log into
 * docs/build-log/assets/phase-16/.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';

const repo = resolve(import.meta.dirname, '../../../..');
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5288' },
    pages: { type: 'boolean', default: false },
  },
});
const base = (values.url as string).replace(/\/$/, '');
const social = join(repo, 'content/build-story/social');
const shots = join(repo, 'docs/build-log/assets/phase-16');
mkdirSync(social, { recursive: true });
mkdirSync(shots, { recursive: true });

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  // let the build clock's sweep finish
  await page.waitForTimeout(4200);
}

const browser = await chromium.launch();
try {
  const cards: [string, string, number][] = [
    ['clock', 'build-clock.png', 627],
    ['maze', 'page-to-maze.png', 627],
    ['bugs', 'bug-gallery.png', 627],
    ['og', 'og-log.png', 630],
  ];
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [variant, file, height] of cards) {
    await page.goto(`${base}/log?card=${variant}`);
    await settle(page);
    await page.locator('.cd').screenshot({ path: join(social, file) });
    console.log(`wrote content/build-story/social/${file} (1200×${height})`);
  }
  await ctx.close();

  if (values.pages) {
    const views: [string, { width: number; height: number }, number, boolean][] = [
      ['desktop', { width: 1440, height: 900 }, 1, false],
      ['mobile', { width: 390, height: 844 }, 2, true],
    ];
    for (const [name, viewport, dpr, isMobile] of views) {
      const c = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile, hasTouch: isMobile });
      const p = await c.newPage();
      await p.goto(`${base}/log`);
      await settle(p);
      await p.screenshot({ path: join(shots, `log-${name}-clock.png`) });
      for (const id of ['night', 'bugs', 'caught', 'then-now', 'record']) {
        await p.locator(`#${id}`).scrollIntoViewIfNeeded();
        await p.evaluate((i) => {
          const el = document.getElementById(i);
          if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24);
        }, id);
        await p.waitForTimeout(400);
        await p.screenshot({ path: join(shots, `log-${name}-${id}.png`) });
      }
      const first = p.locator('.bg-case').first();
      await first.scrollIntoViewIfNeeded();
      await p.waitForTimeout(400);
      await first.screenshot({ path: join(shots, `log-${name}-case.png`) });
      console.log(`wrote docs/build-log/assets/phase-16/log-${name}-*.png`);
      await c.close();
    }
  }
} finally {
  await browser.close();
}
