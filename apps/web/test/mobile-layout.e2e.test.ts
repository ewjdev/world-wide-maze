/** Real layout regression for the Start flow and game panels. Emulation is not device certification. */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page, webkit } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS } from './browser-env.ts';

const browserType = process.env.WWM_LAYOUT_BROWSER === 'webkit' ? webkit : chromium;
const available = existsSync(browserType.executablePath()) || !!process.env.CI;
const shots = process.env.WWM_LAYOUT_SHOTS;
const sizes = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
];

async function fits(page: Page, selector: string) {
  // WebKit applies emulated viewport changes and entrance animations on the next paint.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const geometry = await page.locator(selector).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      viewport: innerWidth,
      width: el.clientWidth,
      scroll: el.scrollWidth,
    };
  });
  expect(geometry.left, selector).toBeGreaterThanOrEqual(-1);
  expect(geometry.right, selector).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.scroll, selector).toBeLessThanOrEqual(geometry.width + 1);
}

async function shot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png` });
}

describe.skipIf(!available)('mobile game layout', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base: string;
  let cache: string;
  beforeAll(async () => {
    cache = mkdtempSync(join(tmpdir(), 'wwm-mobile-layout-vite-'));
    server = await createServer({
      root: fileURLToPath(new URL('../', import.meta.url)),
      cacheDir: cache,
      logLevel: 'error',
      define: { 'import.meta.env.VITE_MOBILE_TILT_ENABLED': '"true"' },
      server: { port: 0, host: '127.0.0.1' },
    });
    await server.listen();
    base = server.resolvedUrls?.local[0] ?? '';
    browser = await browserType.launch({ args: browserType === chromium ? CHROMIUM_ARGS : [] });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (cache) rmSync(cache, { recursive: true, force: true });
  });

  async function phone() {
    const context = await browser.newContext({
      viewport: sizes[1],
      hasTouch: true,
      isMobile: true,
      reducedMotion: 'reduce',
    });
    await browserEnv(context);
    await context.addInitScript((hooks) => {
      // Desktop WebKit needs an explicit touch-point emulation as well as hasTouch.
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 });
      localStorage.setItem('wwm.muted', '1');
      localStorage.setItem('wwm.analytics.preference', 'off');
      localStorage.setItem('wwm.tutorialDone', '1');
      localStorage.setItem('wwm.motion.v1', JSON.stringify({ mode: 'joystick' }));
      window.__WWM_TEST__ = { ...hooks, noAutoPause: true, skipIntro: true };
      window.__WWM_RACE_TEST__ = { ...hooks, noAutoPause: true, countdownSec: 0.1 };
    }, CI_HOOKS);
    await context.route('**/api/**', (route) =>
      route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return { context, page, errors };
  }

  test('Start, instructions, chooser, lessons and settings fit narrow phones through desktop in both languages', async () => {
    const { context, page, errors } = await phone();
    try {
      await page.goto(base);
      await page.getByTestId('start').click();
      await page.getByTestId('howto-go').waitFor({ timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      for (const size of sizes.slice(0, 5)) {
        await page.setViewportSize(size);
        await fits(page, '[data-screen="howto"]');
        await fits(page, '.wwm-howto');
      }
      await page.getByTestId('howto-go').click();
      await page.getByTestId('url-input').waitFor();
      for (const lang of ['en', 'ja']) {
        await page.getByTestId(`lang-${lang}`).click();
        for (const size of sizes) {
          await page.setViewportSize(size);
          for (const selector of [
            '[data-screen="select"]',
            '.wwm-select',
            '.wwm-urlbar',
            '.wwm-lpanel',
            '.wwm-select__body',
          ])
            await fits(page, selector);
          await page.getByTestId('url-go').click();
          expect(await page.getByTestId('url-input').getAttribute('aria-invalid')).toBe('true');
          await fits(page, '#wwm-url-tip');
          await shot(page, `select-${lang}-${size.width}`);
          // The last stage is reachable by ordinary vertical scrolling, without horizontal panning.
          const last = page.locator('.wwm-grid .wwm-site').last();
          await last.scrollIntoViewIfNeeded();
          const box = await last.boundingBox();
          expect(box?.y).toBeGreaterThanOrEqual(0);
          expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height + 1);
          await page.locator('[data-screen="select"]').evaluate((el) => {
            el.scrollTop = 0;
          });
        }
      }
      await page.getByTestId('lang-en').click();
      await page.setViewportSize({ width: 320, height: 568 });
      await page.getByTestId('learning-builtin').click();
      await fits(page, '[data-screen="select"]');
      await fits(page, '.wwm-lpanel');
      await page.setViewportSize({ width: 568, height: 320 });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await fits(page, '.wwm-pop');
      await page.locator('.wwm-pop a').scrollIntoViewIfNeeded();
      const settings = await page.locator('.wwm-pop').boundingBox();
      expect(settings?.y).toBeGreaterThanOrEqual(0);
      expect((settings?.y ?? 0) + (settings?.height ?? 0)).toBeLessThanOrEqual(320);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }, 120_000);

  test('practice pause, results, rankings and Race panels stay inside a phone and short landscape viewport', async () => {
    const { context, page, errors } = await phone();
    try {
      await page.goto(`${base}play/practice`);
      await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 60_000 });
      await page.getByTestId('touch-pause').click();
      await page.getByTestId('map-menu').waitFor();
      for (const size of [sizes[0], sizes[1], sizes[4]]) {
        if (!size) continue;
        await page.setViewportSize(size);
        await fits(page, '.wwm-map');
        await page.getByTestId('map-back').scrollIntoViewIfNeeded();
        expect((await page.getByTestId('map-back').boundingBox())?.y).toBeGreaterThanOrEqual(0);
        const lastAction = page.locator('.wwm-map button').last();
        await lastAction.scrollIntoViewIfNeeded();
        const lastBox = await lastAction.boundingBox();
        expect((lastBox?.y ?? 0) + (lastBox?.height ?? 0)).toBeLessThanOrEqual(size.height + 1);
        expect(
          await lastAction.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          }),
        ).toBe(true);
        await page.locator('.wwm-map').evaluate((el) => {
          el.scrollTop = 0;
        });
        await shot(page, `pause-${size.width}`);
      }
      await page.getByTestId('map-back').click();
      await page.waitForFunction(() => document.body.dataset.phase === 'play');
      expect(await page.evaluate(() => window.__wwmGame?.debugRollIntoGoal())).toBe(true);
      await page.getByTestId('result').waitFor({ timeout: 30_000 });
      for (const size of [sizes[0], sizes[1], sizes[4]]) {
        if (!size) continue;
        await page.setViewportSize(size);
        await fits(page, '[data-screen="result"]');
        await fits(page, '.wwm-tally');
        await shot(page, `result-${size.width}`);
      }
      await page.getByTestId('res-finish').click();
      await page.locator('[data-screen="ranking"]').waitFor();
      await page.setViewportSize({ width: 320, height: 568 });
      await fits(page, '[data-screen="ranking"]');
      await fits(page, '.wwm-ranking__you');
      await fits(page, '[data-testid="name-entry"]');
      await fits(page, '.rk-field');
      await shot(page, 'ranking-320');
      await page.goto(`${base}race`);
      await page.locator('.race-catalog').waitFor();
      await fits(page, '.race-catalog');
      await page.goto(`${base}race/flow-sprint`);
      await page.getByTestId('race-ready').waitFor({ timeout: 60_000 });
      for (const size of [sizes[0], sizes[4]]) {
        if (!size) continue;
        await page.setViewportSize(size);
        await fits(page, '.race-panel');
        await fits(page, '.race-game-header');
        await page.getByTestId('race-start').scrollIntoViewIfNeeded();
        expect(
          await page.getByTestId('race-start').evaluate((el) => {
            const box = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          }),
        ).toBe(true);
        await shot(page, `race-ready-${size.width}`);
      }
      await page.getByTestId('race-start').click();
      await page.waitForFunction(() => window.__wwmRace?.getView().phase === 'racing');
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }, 120_000);
});
