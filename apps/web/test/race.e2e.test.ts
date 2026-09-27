/** Real browser / Rapier / IndexedDB acceptance. Opt in against a running Vite development server:
 * WWM_RACE_E2E_BASE=http://localhost:5173 WWM_RACE_SHOTS=/tmp/wwm-race-review pnpm vitest run apps/web/test/race.e2e.test.ts
 * Synthetic solver input proves deterministic browser operation, not human flow or physical phone feel.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InputSample } from '@wwm/schema';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const BASE = process.env.WWM_RACE_E2E_BASE;
const SHOTS = process.env.WWM_RACE_SHOTS;
const { inputs } = JSON.parse(
  readFileSync(new URL('../../../fixtures/race/flow-sprint/solver-inputs.json', import.meta.url), 'utf8'),
) as { inputs: InputSample[] };
const expected = JSON.parse(
  readFileSync(new URL('../../../fixtures/race/flow-sprint/race-validation.json', import.meta.url), 'utf8'),
).progress;
const run = BASE ? describe : describe.skip;

run('Race browser acceptance (synthetic inputs)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const errors: string[] = [];
  const watch = (p: Page) => p.on('pageerror', (error) => errors.push(error.message));
  const shot = async (p: Page, name: string) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  };
  const debug = () => page.evaluate(() => window.__wwmRace?.debugState());

  beforeAll(async () => {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
    await context.addInitScript((stream: InputSample[]) => {
      Object.assign(window, {
        __WWM_RACE_TEST__: {
          inputs: stream,
          countdownSec: 0.1,
          timeScale: 4,
          noAutoPause: true,
          quality: 'low',
        },
      });
    }, inputs);
    await context.routeWebSocket(
      (url) => url.host === new URL(BASE ?? 'http://localhost').host && url.pathname === '/',
      () => {},
    );
    page = await context.newPage();
    watch(page);
  });
  afterAll(async () => {
    await context?.close();
    await browser?.close();
  });

  test('catalog, real finish, persistent personal best after reload, and non-colliding replay', async () => {
    await page.goto(`${BASE}/race`);
    await page.getByRole('heading', { name: 'Race your own shadow.' }).waitFor();
    await page.getByRole('button', { name: /Flow Sprint/ }).click();
    await page.getByRole('img', { name: 'Course map' }).waitFor();
    await shot(page, '01-catalog-desktop');
    await page.getByRole('link', { name: 'Race this course' }).click();
    await page.getByTestId('race-ready').waitFor({ timeout: 30000 });
    await shot(page, '02-ready');
    expect((await debug())?.best).toBeNull();
    await page.getByTestId('race-start').click();
    await page.waitForFunction(() => (window.__wwmRace?.debugState().tick ?? 0) > 700, null, {
      timeout: 30000,
    });
    await shot(page, '03-racing');
    await page.getByTestId('race-finished').waitFor({ timeout: 120000 });
    const first = await debug();
    expect(first?.progress).toEqual(expected);
    expect(first?.ghostCount).toBe(0);
    expect(first?.newBest).toBe(true);
    expect(first?.comparisonBest).toBeNull();
    expect(await page.locator('.race-splits small').count()).toBe(0);
    expect(await page.getByTestId('race-result-time').textContent()).toBe(
      `${Math.floor(expected.finishTick / 7200)}:${String(Math.floor(expected.finishTick / 120) % 60).padStart(2, '0')}.${String(Math.floor((expected.finishTick * 1000) / 120) % 1000).padStart(3, '0')}`,
    );
    await expect.poll(async () => (await debug())?.recent.length, { timeout: 10000 }).toBe(1);
    const firstId = first?.result?.id;
    expect(firstId).toBeTruthy();
    const persisted = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wwm-race-history', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<number>((resolve, reject) => {
          const request = db.transaction('attempts').objectStore('attempts').count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
    expect(persisted).toBe(1);
    await shot(page, '04-finished');
    await page.reload();
    await page.getByTestId('race-ready').waitFor({ timeout: 30000 });
    expect((await debug())?.best?.id).toBe(firstId);
    expect((await debug())?.persistent).toBe(true);
    await shot(page, '05-reloaded-best');
    await page.getByTestId('race-start').click();
    await expect.poll(async () => (await debug())?.ghostCount, { timeout: 30000 }).toBe(1);
    await page.waitForFunction(() => (window.__wwmRace?.debugState().tick ?? 0) > 700, null, {
      timeout: 30000,
    });
    await shot(page, '06-personal-ghost');
    await page.getByTestId('race-finished').waitFor({ timeout: 120000 });
    const second = await debug();
    expect(second?.progress).toEqual(first?.progress);
    expect(second?.ball).toEqual(first?.ball);
    expect(second?.ghostError).toBe(false);
    expect(second?.newBest).toBe(false);
    await expect.poll(async () => (await debug())?.recent.length, { timeout: 10000 }).toBe(2);
    expect((await debug())?.best?.id).toBe(firstId); // Equal-time replay preserves the incumbent best.
    expect((await debug())?.comparisonBest?.id).toBe(firstId);
    expect(await page.locator('.race-splits small').count()).toBe(expected.sectorTicks.length);
    expect(errors).toEqual([]);
  }, 240000);

  test('pause freezes ticks and retry starts a clean attempt while retaining the best', async () => {
    await page.getByTestId('race-retry').click();
    await page.waitForFunction(() => window.__wwmRace?.debugState().phase === 'racing', null, {
      timeout: 30000,
    });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByTestId('race-paused').waitFor();
    const paused = await debug();
    expect(paused?.progress.reasons).toContain('pause');
    await page.waitForTimeout(350);
    expect((await debug())?.tick).toBe(paused?.tick);
    await shot(page, '07-paused');
    await page.getByRole('button', { name: 'Race again', exact: true }).click();
    await page.waitForFunction(() => window.__wwmRace?.debugState().phase === 'racing', null, {
      timeout: 30000,
    });
    const fresh = await debug();
    expect(fresh?.progress.reasons).toEqual([]);
    expect(fresh?.result).toBeNull();
    expect(fresh?.best?.progress.finishTick).toBe(expected.finishTick);
    await page.getByRole('link', { name: 'Courses', exact: true }).click();
    await page.getByRole('heading', { name: 'Race your own shadow.' }).waitFor();
    expect(await page.evaluate(() => window.__wwmRace === undefined)).toBe(true);
    expect(errors).toEqual([]);
  }, 60000);

  test('narrow catalog and ready screen stay within the viewport; Race rejects learning overlap', async () => {
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
    });
    const narrow = await mobile.newPage();
    watch(narrow);
    try {
      await narrow.goto(`${BASE}/race`);
      await narrow.getByRole('img', { name: 'Course map' }).waitFor();
      expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
        true,
      );
      await shot(narrow, '08-catalog-mobile');
      await narrow.getByRole('link', { name: 'Race this course' }).click();
      await narrow.getByTestId('race-ready').waitFor({ timeout: 30000 });
      expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
        true,
      );
      await shot(narrow, '09-ready-mobile');
      await narrow.goto(`${BASE}/race/flow-sprint?learn=example`);
      await narrow.getByText('Race and Education cannot be played at the same time.').waitFor();
      expect(await narrow.evaluate(() => window.__wwmRace === undefined)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await mobile.close();
    }
  }, 60000);

  test('normal keyboard controls roll the ball and Escape pauses without injected inputs', async () => {
    const keyboardContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
    });
    const keyboardPage = await keyboardContext.newPage();
    watch(keyboardPage);
    try {
      await keyboardPage.goto(`${BASE}/race/flow-sprint`);
      await keyboardPage.getByTestId('race-ready').waitFor({ timeout: 30000 });
      expect(await keyboardPage.evaluate(() => window.__WWM_RACE_TEST__)).toBeUndefined();
      await keyboardPage.getByTestId('race-start').click();
      await keyboardPage.waitForFunction(() => window.__wwmRace?.debugState().phase === 'racing');
      const before = await keyboardPage.evaluate(() => window.__wwmRace?.debugState().ball?.pos);
      await keyboardPage.keyboard.down('ArrowRight');
      await keyboardPage.waitForTimeout(800);
      await keyboardPage.keyboard.up('ArrowRight');
      const after = await keyboardPage.evaluate(() => window.__wwmRace?.debugState().ball?.pos);
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(
        Math.hypot((after?.[0] ?? 0) - (before?.[0] ?? 0), (after?.[2] ?? 0) - (before?.[2] ?? 0)),
      ).toBeGreaterThan(0.05);
      await keyboardPage.keyboard.press('Escape');
      await keyboardPage.getByTestId('race-paused').waitFor();
      expect(await keyboardPage.evaluate(() => window.__wwmRace?.debugState().progress.reasons)).toContain(
        'pause',
      );
      await shot(keyboardPage, '10-keyboard-pause');
      expect(errors).toEqual([]);
    } finally {
      await keyboardContext.close();
    }
  }, 45000);
});

const ENABLED_PREVIEW = process.env.WWM_RACE_PREVIEW_ENABLED_BASE;
const DISABLED_PREVIEW = process.env.WWM_RACE_PREVIEW_DISABLED_BASE;
const previewRun = ENABLED_PREVIEW && DISABLED_PREVIEW ? describe : describe.skip;
previewRun('Race production preview and flag rollback', () => {
  test('built routes, real controls, original/education entry, and disabled bundle retain same-origin history', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const countStored = () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('wwm-race-history', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<number>((resolve, reject) => {
            const request = db.transaction('attempts').objectStore('attempts').count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      });
    try {
      await page.goto(`${ENABLED_PREVIEW}/race`);
      await page.getByRole('heading', { name: 'Race your own shadow.' }).waitFor();
      await page.getByRole('img', { name: 'Course map' }).waitFor();
      await page.getByRole('link', { name: 'Race this course' }).click();
      await page.getByTestId('race-ready').waitFor({ timeout: 30000 });
      await page.getByTestId('race-start').click();
      await page.waitForFunction(() => window.__wwmRace?.debugState().phase === 'racing');
      const before = await page.evaluate(() => window.__wwmRace?.debugState().ball?.pos);
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(800);
      await page.keyboard.up('ArrowRight');
      const after = await page.evaluate(() => window.__wwmRace?.debugState().ball?.pos);
      expect(
        Math.hypot((after?.[0] ?? 0) - (before?.[0] ?? 0), (after?.[2] ?? 0) - (before?.[2] ?? 0)),
      ).toBeGreaterThan(0.05);
      await page.keyboard.press('Escape');
      await page.getByTestId('race-paused').waitFor();
      await page.getByRole('link', { name: 'Courses', exact: true }).click();
      await page.getByRole('heading', { name: 'Race your own shadow.' }).waitFor();
      await expect.poll(countStored, { timeout: 10000 }).toBe(1);
      await page.getByRole('link', { name: 'Original', exact: true }).click();
      await page.getByRole('navigation', { name: 'Game mode' }).waitFor({ timeout: 30000 });
      expect(
        await page.getByRole('link', { name: 'Original', exact: true }).getAttribute('aria-current'),
      ).toBe('page');
      await page.getByRole('link', { name: 'Education', exact: true }).click();
      await page.getByRole('navigation', { name: 'Game mode' }).waitFor({ timeout: 30000 });
      expect(
        await page.getByRole('link', { name: 'Education', exact: true }).getAttribute('aria-current'),
      ).toBe('page');
      expect(new URL(page.url()).searchParams.get('learn')).toBe('compare-groups');
      // Serve the disabled production bundle at the SAME browser origin. This models a rollback while
      // retaining the actual history just written by the enabled build (different ports alone would not).
      await page.route(`${ENABLED_PREVIEW}/**`, async (route) => {
        const response = await route.fetch({
          url: route
            .request()
            .url()
            .replace(ENABLED_PREVIEW ?? '', DISABLED_PREVIEW ?? ''),
        });
        await route.fulfill({ response });
      });
      await page.goto(`${ENABLED_PREVIEW}/`);
      await page.getByRole('navigation', { name: 'Game mode' }).waitFor({ timeout: 30000 });
      expect(await page.getByRole('link', { name: 'Race', exact: true }).count()).toBe(0);
      await page.goto(`${ENABLED_PREVIEW}/race/flow-sprint`);
      await page.getByText('Race is not enabled in this build.').waitFor();
      expect(await page.evaluate(() => window.__wwmRace === undefined)).toBe(true);
      expect(await countStored()).toBe(1);
      await page.unroute(`${ENABLED_PREVIEW}/**`);
      await page.goto(`${ENABLED_PREVIEW}/race/flow-sprint`);
      await page.getByTestId('race-ready').waitFor({ timeout: 30000 });
      expect(await page.evaluate(() => window.__wwmRace?.debugState().recent.length)).toBe(1);
      expect(errors).toEqual([]);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, '11-production-restored-history.png'), fullPage: true });
      }
    } finally {
      await context.close();
      await browser.close();
    }
  }, 90000);
});
