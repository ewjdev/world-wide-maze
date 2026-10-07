/** Browser/UI evidence with synthetic motion and real CDP touch. Physical sensors remain unqualified. */
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { browserEnv, CHROMIUM_ARGS, SOFTWARE_GL_NOISE } from './browser-env.ts';

const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHOTS = process.env.WWM_TILT_SHOTS;
describe.skipIf(!existsSync(chromium.executablePath()) && !process.env.CI)(
  'tilt preview browser flows',
  () => {
    let server: ViteDevServer;
    let browser: Browser;
    let base = '';
    const problems: string[] = [];
    beforeAll(async () => {
      server = await createServer({
        root: WEB_ROOT,
        configFile: `${WEB_ROOT}vite.config.ts`,
        logLevel: 'error',
        define: { 'import.meta.env.VITE_MOBILE_TILT_ENABLED': JSON.stringify('true') },
        server: { host: '127.0.0.1', port: 5296, strictPort: false },
      });
      await server.listen();
      base = (server.resolvedUrls?.local[0] ?? '').replace(/\/$/, '');
      browser = await chromium.launch({ args: CHROMIUM_ARGS });
      if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    }, 120_000);
    afterAll(async () => {
      await browser?.close();
      await server?.close();
      expect(problems).toEqual([]);
    });
    async function phone(
      options: {
        denied?: boolean;
        keyboard?: boolean;
        slow?: boolean;
        delayedPermission?: boolean;
        viewport?: { width: number; height: number };
      } = {},
    ) {
      const context = await browser.newContext({
        viewport: options.viewport ?? { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      await browserEnv(context);
      await context.addInitScript((settings) => {
        localStorage.setItem('wwm.tutorialDone', '1');
        if (settings.keyboard) localStorage.setItem('wwm.input.v1', 'keyboard');
        window.__WWM_TEST__ = {
          skipIntro: true,
          quality: 'low',
          noAutoPause: true,
          ...(settings.slow ? { timeScale: 0.2 } : {}),
          ...(settings.keyboard ? { forceWorker: true } : {}),
        };
        window.__WWM_RACE_TEST__ = { countdownSec: 1, quality: 'low', noAutoPause: true };
        const permission = () =>
          new Promise<string>((resolve) =>
            setTimeout(
              () => resolve(settings.denied ? 'denied' : 'granted'),
              settings.delayedPermission ? 400 : 0,
            ),
          );
        Object.defineProperty(DeviceOrientationEvent, 'requestPermission', {
          value: permission,
          configurable: true,
        });
        Object.defineProperty(DeviceMotionEvent, 'requestPermission', {
          value: permission,
          configurable: true,
        });
        const state = { beta: 0, gamma: 0, running: true };
        Object.assign(window, { __motion: state });
        setInterval(() => {
          if (!state.running) return;
          const beta = (state.beta * Math.PI) / 180;
          const gamma = (state.gamma * Math.PI) / 180;
          window.dispatchEvent(
            new DeviceOrientationEvent('deviceorientation', {
              beta: state.beta,
              gamma: state.gamma,
              alpha: null,
            }),
          );
          window.dispatchEvent(
            new DeviceMotionEvent('devicemotion', {
              accelerationIncludingGravity: {
                x: -Math.cos(beta) * Math.sin(gamma) * 9.8,
                y: Math.sin(beta) * 9.8,
                z: Math.cos(beta) * Math.cos(gamma) * 9.8,
              },
              rotationRate: { alpha: 0, beta: 0, gamma: 0 },
              interval: 50,
            }),
          );
        }, 50);
      }, options);
      const page = await context.newPage();
      page.on('pageerror', (error) => problems.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' && !SOFTWARE_GL_NOISE.test(message.text()))
          problems.push(message.text());
      });
      const traffic: string[] = [];
      page.on('request', (request) => {
        if (/\/(api|rooms?|ws)(\/|$)/.test(new URL(request.url()).pathname)) traffic.push(request.url());
      });
      return { page, context, traffic };
    }
    const phase = (page: Page, want: string) =>
      page.waitForFunction((value) => window.__wwmGame?.getView().phase === value, want, { timeout: 45_000 });
    const motion = (page: Page, beta: number, gamma: number, running = true) =>
      page.evaluate(
        (reading) => {
          Object.assign((window as unknown as { __motion: object }).__motion, reading);
        },
        { beta, gamma, running },
      );
    async function setup(page: Page) {
      await page.getByTestId('motion-enable').click();
      await page.getByTestId('motion-setup').getAttribute('data-state');
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="motion-setup"]')?.getAttribute('data-state') === 'probing',
      );
      await page.waitForTimeout(120);
      await motion(page, 8, 0);
      await page.getByTestId('motion-setup').waitFor({ state: 'hidden', timeout: 10_000 });
    }
    const shot = async (page: Page, name: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
    };
    test('Original waits for setup, fills the viewport, retains a released tap at zero ticks and pauses on lost data', async () => {
      const { page, context, traffic } = await phone();
      await page.goto(`${base}/play/practice?offline=1`);
      await page.getByTestId('motion-setup').waitFor();
      await shot(page, 'original-setup-portrait');
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => window.__wwmGame?.debugState().tick)).toBe(0);
      expect(await page.evaluate(() => window.__wwmGame?.debugState().timer.running)).toBe(false);
      await setup(page);
      await phase(page, 'play');
      const host = await page.locator('.wwm-stage-host').boundingBox();
      expect(host?.height).toBe(844);
      await shot(page, 'original-tilt-portrait');
      await page.evaluate(() => {
        if (window.__WWM_TEST__) window.__WWM_TEST__.timeScale = 0;
      });
      const before = await page.evaluate(
        () => window.__wwmGame?.debugRecording().filter((sample) => sample.jump).length,
      );
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 190, y: 440, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(80);
      expect(await page.evaluate(() => window.__wwmGame?.tiltSource?.peek(performance.now()).jump)).toBe(
        true,
      );
      await page.evaluate(() => {
        if (window.__WWM_TEST__) window.__WWM_TEST__.timeScale = 1;
      });
      await page.waitForTimeout(150);
      expect(
        await page.evaluate(() => window.__wwmGame?.debugRecording().filter((sample) => sample.jump).length),
      ).toBe((before ?? 0) + 1);
      await motion(page, 8, 12);
      await page.waitForFunction(() => window.__wwmGame?.tilt().power === true);
      await motion(page, 8, 12, false);
      await phase(page, 'paused');
      const tick = await page.evaluate(() => window.__wwmGame?.debugState().tick);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => window.__wwmGame?.debugState().tick)).toBe(tick);
      await motion(page, 0, 0);
      await setup(page);
      expect(await page.evaluate(() => window.__wwmGame?.getView().phase)).toBe('paused');
      await page.getByTestId('map-back').click();
      await phase(page, 'play');
      expect(traffic).toEqual([]);
      await context.close();
    }, 80_000);
    test('denied motion offers joystick and remembers the explicit fallback across reload', async () => {
      const { page, context } = await phone({ denied: true });
      await page.goto(`${base}/play/practice?offline=1`);
      await page.getByTestId('motion-enable').click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="motion-setup"]')?.getAttribute('data-state') === 'denied',
      );
      await shot(page, 'motion-denied-portrait');
      await page.getByTestId('motion-joystick').click();
      await phase(page, 'play');
      expect((await page.locator('.wwm-stage-host').boundingBox())?.height).toBeLessThan(640);
      await page.reload();
      await phase(page, 'play');
      expect(await page.getByTestId('motion-setup').count()).toBe(0);
      expect(await page.evaluate(() => window.__wwmGame?.getView().inputMode)).toBe('touch');
      await context.close();
    }, 80_000);
    test('setup protects keyboard focus, sensitivity finishes before recheck, and new buttons show focus', async () => {
      const { page, context } = await phone({ delayedPermission: true });
      await page.goto(`${base}/play/practice?offline=1`);
      await page.getByTestId('motion-setup').waitFor();
      await page.getByTestId('motion-enable').click();
      expect(await page.getByTestId('motion-setup').getAttribute('data-state')).toBe('requesting');
      const focusedInside = () =>
        page.evaluate(() =>
          document.querySelector('[data-testid="motion-setup"]')?.contains(document.activeElement),
        );
      expect(await focusedInside()).toBe(true);
      await page.keyboard.press('Shift+Tab');
      expect(await focusedInside()).toBe(true);
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="motion-setup"]')?.getAttribute('data-state') === 'probing',
      );
      expect(await focusedInside()).toBe(true);
      await shot(page, 'tilt-probing-focus-portrait');
      await page.waitForTimeout(120);
      await motion(page, 8, 0);
      await page.getByTestId('motion-setup').waitFor({ state: 'hidden' });
      await phase(page, 'play');
      await page.keyboard.press('Shift');
      await page.getByTestId('tilt-pause').focus();
      expect(
        await page.getByTestId('tilt-pause').evaluate((element) => getComputedStyle(element).clipPath),
      ).toBe('none');
      await shot(page, 'tilt-pause-focus-portrait');
      await page.getByTestId('tilt-pause').click();
      await page.waitForTimeout(450); // Let the incumbent 420 ms map entrance finish before its evidence capture.
      await shot(page, 'tilt-settings-portrait');
      const sensitivity = page.getByTestId('motion-sensitivity');
      await sensitivity.focus();
      await page.keyboard.down('ArrowRight');
      expect(await page.getByTestId('motion-setup').count()).toBe(0);
      await page.keyboard.up('ArrowRight');
      await page.getByTestId('motion-setup').waitFor();
      expect(await focusedInside()).toBe(true);
      await shot(page, 'tilt-recenter-portrait');
      await context.close();
    }, 80_000);
    test('Original restores the interrupted countdown beat and fraction, and clears old delays on retry', async () => {
      const { page, context } = await phone({ slow: true });
      await page.goto(`${base}/play/practice?offline=1`);
      await page.getByTestId('motion-setup').waitFor();
      await setup(page);
      await phase(page, 'countdown');
      await page.waitForFunction(() => (window.__wwmGame?.debugState().countdown?.remaining ?? 1) < 0.45);
      await page.evaluate(() => window.__wwmGame?.menu());
      const countdown = await page.evaluate(() => window.__wwmGame?.debugState().countdown);
      const tick = await page.evaluate(() => window.__wwmGame?.debugState().tick);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.__wwmGame?.debugState().countdown)).toEqual(countdown);
      expect(await page.evaluate(() => window.__wwmGame?.debugState().tick)).toBe(tick);
      await page.getByTestId('map-back').click();
      expect(await page.evaluate(() => window.__wwmGame?.getView().phase)).toBe('countdown');
      const resumed = await page.evaluate(() => window.__wwmGame?.debugState().countdown);
      expect(resumed?.beat).toBe(countdown?.beat);
      expect(resumed?.remaining).toBeGreaterThan((countdown?.remaining ?? 0) - 0.08);
      await phase(page, 'play');
      await page.evaluate(() => {
        window.__wwmGame?.menu();
        window.__wwmGame?.retryStage();
      });
      await phase(page, 'intro');
      await page.getByTestId('motion-setup').waitFor();
      expect(await page.evaluate(() => window.__wwmGame?.debugState().tick)).toBe(0);
      expect(await page.evaluate(() => window.__wwmGame?.debugState().timer.running)).toBe(false);
      await motion(page, 0, 0);
      await setup(page);
      await phase(page, 'countdown');
      expect(await page.evaluate(() => window.__wwmGame?.getView().countdown)).toBe(3);
      await page.waitForTimeout(800);
      // The preceding attempt's delayed GO hide must not erase the new countdown.
      expect(await page.evaluate(() => window.__wwmGame?.getView().countdown)).toBe(3);
      await context.close();
    }, 80_000);
    test('a loaded worker attempt keeps its controls until the confirmed tilt restart installs lockstep', async () => {
      const { page, context } = await phone({ keyboard: true, viewport: { width: 844, height: 390 } });
      await page.goto(`${base}/play/practice?offline=1&physics=worker`);
      await phase(page, 'play');
      expect(await page.evaluate(() => window.__wwmGame?.debugState().driver)).toBe('worker');
      await page.getByTestId('hud-menu').click();
      await page.getByTestId('controls-tilt').click();
      expect(await page.evaluate(() => window.__wwmGame?.getView().inputMode)).toBe('keyboard');
      await page.getByTestId('motion-joystick').click();
      expect(await page.evaluate(() => window.__wwmGame?.getView().phase)).toBe('paused');
      expect(await page.evaluate(() => window.__wwmGame?.debugState().driver)).toBe('worker');
      await page.getByTestId('controls-tilt').click();
      await setup(page);
      await page.evaluate(() => window.__wwmGame?.resume());
      expect(await page.evaluate(() => window.__wwmGame?.getView().phase)).toBe('paused');
      await page.getByTestId('motion-restart').click();
      await phase(page, 'play');
      expect(await page.evaluate(() => window.__wwmGame?.debugState().driver)).toBe('lockstep');
      expect(await page.evaluate(() => window.__wwmGame?.getView().inputMode)).toBe('tilt');
      await shot(page, 'original-tilt-landscape');
      await page.setViewportSize({ width: 1280, height: 900 });
      await shot(page, 'original-tilt-desktop');
      await context.close();
    }, 80_000);
    test('Race waits for tilt, preserves its paused countdown and never auto-resumes after recheck', async () => {
      const { page, context, traffic } = await phone({ viewport: { width: 844, height: 390 } });
      await page.goto(`${base}/race/island-leap`);
      await page.getByTestId('motion-setup').waitFor();
      await page.evaluate(() => void window.__wwmRace?.start());
      expect(await page.evaluate(() => window.__wwmRace?.getView().phase)).toBe('ready');
      await setup(page);
      await page.getByTestId('race-start').click();
      await page.waitForFunction(() => window.__wwmRace?.getView().phase === 'countdown');
      await page.evaluate(() => window.__wwmRace?.pause());
      const countdown = await page.evaluate(() => window.__wwmRace?.getView().countdown);
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__wwmRace?.resume());
      expect(await page.evaluate(() => window.__wwmRace?.getView().countdown)).toBe(countdown);
      await page.waitForFunction(() => window.__wwmRace?.getView().phase === 'racing');
      expect(await page.evaluate(() => window.__wwmRace?.getView().progress.reasons)).toContain('pause');
      await shot(page, 'race-tilt-landscape');
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, 'race-recovery-portrait');
      await motion(page, 8, 0, false);
      await page.getByTestId('motion-setup').waitFor();
      expect(await page.evaluate(() => window.__wwmRace?.getView().phase)).toBe('paused');
      await motion(page, 0, 0);
      await setup(page);
      expect(await page.evaluate(() => window.__wwmRace?.getView().phase)).toBe('paused');
      await page.evaluate(() => window.__wwmRace?.resume());
      expect(await page.evaluate(() => window.__wwmRace?.getView().phase)).toBe('racing');
      await shot(page, 'race-tilt-portrait');
      expect(traffic).toEqual([]);
      await context.close();
    }, 80_000);
  },
);
