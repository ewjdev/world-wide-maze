/** Loading and cached-title correctness. Performance budgets use the headed production probes. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS } from './browser-env.ts';

declare global {
  interface Window {
    homeProbe: {
      frames: number;
      contexts: number;
      closed: number;
      dimensions: number[];
      padMenu: boolean;
      polls: number;
    };
  }
}
const available = existsSync(chromium.executablePath()) || !!process.env.CI;
let browser: Browser;
let server: ViteDevServer;
let base: string;
beforeAll(async () => {
  if (!available) return;
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  base = server.resolvedUrls?.local[0] ?? '';
  browser = await chromium.launch({ headless: !!process.env.CI, args: CHROMIUM_ARGS });
}, 60000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function setup() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await browserEnv(context);
  await context.addInitScript((hooks) => {
    localStorage.setItem('wwm.analytics.preference', 'off');
    localStorage.setItem('wwm.muted', '1');
    window.__WWM_TEST__ = { ...hooks, noAutoPause: true, titleMotion: 'cached' };
    const probe = { frames: 0, contexts: 0, closed: 0, dimensions: [] as number[], padMenu: false, polls: 0 };
    window.homeProbe = probe;
    const NativeAudio = window.AudioContext;
    window.AudioContext = class extends NativeAudio {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.contexts++;
      }
      override close() {
        probe.closed++;
        return super.close();
      }
    };
    for (const name of ['width', 'height']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name);
      if (!descriptor?.set) throw new Error('Canvas dimensions unavailable');
      const set = descriptor.set;
      Object.defineProperty(HTMLCanvasElement.prototype, name, {
        ...descriptor,
        set(value: number) {
          set.call(this, value);
          probe.dimensions.push(this.width * this.height);
        },
      });
    }
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => {
        probe.polls++;
        return [
          {
            connected: true,
            axes: [0, 0],
            buttons: Array.from({ length: 10 }, (_, i) => ({
              pressed: i === 9 && probe.padMenu,
              value: i === 9 && probe.padMenu ? 1 : 0,
            })),
          },
        ];
      },
    });
    let game: Window['__wwmGame'];
    Object.defineProperty(window, '__wwmGame', {
      configurable: true,
      get: () => game,
      set(g: Window['__wwmGame']) {
        game = g;
        if (!g) return;
        let wrapped = false;
        g.subscribe(() => {
          if (!g.engine || wrapped) return;
          wrapped = true;
          const frame = g.engine.frame;
          g.engine.frame = function (...args) {
            probe.frames++;
            return frame.apply(this, args);
          };
        });
      },
    });
  }, CI_HOOKS);
  await context.route('**/api/**', (r) => r.fulfill({ json: [] }));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page, errors };
}

async function beats(page: Page, count: number) {
  return page.evaluate(async (count) => {
    for (let i = 0; i < count; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, count);
}

describe.skipIf(!available)('progressive home', () => {
  test('Start responds while the runtime is blocked, then consumes exactly one intent with shared audio and preferences', async () => {
    const { context, page, errors } = await setup();
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route('**/src/ui/GameApp.tsx*', async (route) => {
      await hold;
      await route.continue();
    });
    await page.goto(`${base}?offline=1`);
    await page.getByTestId('start').waitFor();
    expect(await page.getByTestId('start').isEnabled()).toBe(true);
    expect(await page.evaluate(() => !!window.__wwmGame)).toBe(false);
    await page.getByTestId('lang-ja').click();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByTestId('graphics-setting').selectOption('low');
    await page.keyboard.press('Escape');
    await page.getByTestId('start').click();
    await page.getByTestId('home-preparing').waitFor();
    expect(await page.getByTestId('start').isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.homeProbe.contexts)).toBe(1);
    release();
    await page.waitForFunction(() => window.__wwmGame?.getView().phase === 'howto');
    expect(
      await page.evaluate(() => ({
        graphics: window.__wwmGame?.getView().graphics,
        tier: window.__wwmGame?.engine?.stats().tier,
        lang: document.documentElement.lang,
        contexts: window.homeProbe.contexts,
        closed: window.homeProbe.closed,
      })),
    ).toEqual({ graphics: 'low', tier: 3, lang: 'ja', contexts: 1, closed: 0 });
    expect(await page.locator('.wwm-canvas').count()).toBe(1);
    expect(errors).toEqual([]);
    await context.close();
  }, 60000);

  test('a settled title submits no frames, redraws changes, and keeps gamepad polling and Start alive', async () => {
    const { context, page, errors } = await setup();
    await page.goto(`${base}?offline=1`);
    await page.waitForFunction(
      () =>
        window.__wwmGame?.engine &&
        window.__wwmGame.engine.stats().drawCalls > 20 &&
        !window.__wwmGame.engine.needsFrame(),
    );
    await beats(page, 10);
    const frozen = await page.evaluate(() => window.homeProbe.frames);
    await beats(page, 90);
    expect(await page.evaluate(() => window.homeProbe.frames)).toBe(frozen);
    expect(await page.evaluate(() => Math.max(...window.homeProbe.dimensions))).toBeLessThanOrEqual(
      1920 * 1080,
    );
    await page.evaluate(() => window.__wwmGame?.setPixelLook(true));
    await beats(page, 5);
    expect(await page.evaluate(() => window.homeProbe.frames)).toBeGreaterThan(frozen);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForFunction(() => !window.__wwmGame?.engine?.needsFrame());
    await beats(page, 10);
    const resized = await page.evaluate(() => window.homeProbe.frames);
    await beats(page, 60);
    expect(await page.evaluate(() => window.homeProbe.frames)).toBe(resized);
    const polls = await page.evaluate(() => window.homeProbe.polls);
    await beats(page, 20);
    expect(await page.evaluate(() => window.homeProbe.polls)).toBeGreaterThan(polls);
    await page.getByTestId('start').click();
    await page.waitForFunction(() => window.__wwmGame?.getView().phase !== 'title');
    expect(await page.evaluate(() => window.homeProbe.frames)).toBeGreaterThan(resized);
    expect(errors).toEqual([]);
    await context.close();
  }, 60000);

  test('failed runtime loading gives an actionable retry and does not disable the title', async () => {
    const { context, page, errors } = await setup();
    let fail = true;
    await context.route('**/src/ui/GameApp.tsx*', (route) =>
      fail ? route.abort('failed') : route.continue(),
    );
    await page.goto(`${base}?offline=1`);
    await page.getByTestId('start').click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByTestId('start').isEnabled()).toBe(true);
    fail = false;
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      page.getByRole('button', { name: 'Reload game', exact: true }).click(),
    ]);
    await page.getByTestId('start').click();
    await page.waitForFunction(() => window.__wwmGame?.getView().phase === 'howto');
    expect(errors).toEqual([]);
    await context.close();
  }, 60000);
});
