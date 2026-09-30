/**
 * Same-device touch play in a real (emulated) mobile Chromium: the real UI path from a fresh visit to a played
 * stage, with real multi-touch injected through the DevTools protocol (`Input.dispatchTouchEvent`), not synthetic
 * DOM events. Layout is emulation evidence only: this is not iOS Safari or Android Chrome certification
 * (plans/mobile-browser-game-execution.md M4). Physical-device receipts live under docs/launch/evidence/.
 *
 * Needs Playwright Chromium; skipped locally without it, required in CI. Starts its own Vite dev server (no
 * worker): local play must not need one, and any room/API traffic it makes is asserted absent.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContext, type CDPSession, chromium, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS, SOFTWARE_GL_NOISE } from './browser-env.ts';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHOTS = process.env.WWM_MOBILE_SHOTS;
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

interface Point {
  x: number;
  y: number;
  id: number;
}

describe.skipIf(!HAS_CHROMIUM)('mobile play e2e (touch Chromium)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base = '';
  const problems: string[] = [];
  const traffic: string[] = [];

  async function phone(viewport = PORTRAIT, hooks: Record<string, unknown> = {}) {
    const ctx: BrowserContext = await browser.newContext({
      viewport,
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    await browserEnv(ctx);
    await ctx.addInitScript(
      (h) => {
        (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = h;
        (window as unknown as { __WWM_RACE_TEST__: unknown }).__WWM_RACE_TEST__ = { ...h, countdownSec: 0.2 };
      },
      { ...CI_HOOKS, noAutoPause: true, ...hooks },
    );
    const page = await ctx.newPage();
    // Failure diagnostics: every phase change and orientation event, dumped by the assertions that need them.
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __log: string[] }).__log = log;
      screen.orientation?.addEventListener('change', () =>
        log.push(`orientation ${screen.orientation.type}`),
      );
      let last = '';
      setInterval(() => {
        const now = document.body?.dataset.phase ?? '';
        if (now === last) return;
        last = now;
        log.push(`phase ${now}`);
      }, 40);
    });
    page.on('console', (m) => {
      const t = m.text();
      if ((m.type() === 'error' || m.type() === 'warning') && !SOFTWARE_GL_NOISE.test(t))
        problems.push(`[${m.type()}] ${t}`);
    });
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (/\/(api|rooms?|ws)(\/|$)/.test(u.pathname)) traffic.push(`${r.method()} ${u.pathname}`);
    });
    // Vite's own HMR socket (`?token=`) is the dev server, not game traffic
    page.on('websocket', (ws) => {
      if (!new URL(ws.url()).searchParams.has('token')) traffic.push(`WS ${ws.url()}`);
    });
    const cdp = await ctx.newCDPSession(page);
    return { ctx, page, cdp };
  }

  const dispatch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })),
    });
  const centre = async (page: Page, testId: string) => {
    const box = await page.getByTestId(testId).boundingBox();
    if (!box) throw new Error(`${testId} not visible`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const shot = async (p: Page, name: string) => {
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  const phaseOf = (p: Page) => p.evaluate(() => document.body.dataset.phase ?? '');
  const waitPhase = (p: Page, want: string, timeout = 60_000) =>
    p.waitForFunction((w) => document.body.dataset.phase === w, want, { timeout });
  const ball = (p: Page) => p.evaluate(() => window.__wwmGame?.debugState().ball as number[] | undefined);

  beforeAll(async () => {
    server = await createServer({
      root: WEB_ROOT,
      configFile: `${WEB_ROOT}vite.config.ts`,
      logLevel: 'error',
      server: { port: 5291, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    base = (server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5291/').replace(/\/$/, '');
    browser = await chromium.launch({ args: CHROMIUM_ARGS });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    expect(problems).toEqual([]);
  });

  test('fresh visit → how-to → stage select with no pairing, no room traffic → touch steer and jump', async () => {
    const { ctx, page, cdp } = await phone(PORTRAIT, {});
    await page.addInitScript(() => localStorage.setItem('wwm.tutorialDone', '1')); // Jump is tutorial-locked otherwise
    await page.goto(`${base}/?offline=1`);
    await page.getByTestId('start').click();
    await waitPhase(page, 'howto');
    expect(await page.locator('.wwm-howto').textContent()).toContain('no pairing needed');
    await page.getByTestId('howto-go').click();
    await waitPhase(page, 'select'); // never 'pairing'
    expect(await phaseOf(page)).toBe('select');
    await page.getByTestId('site-practice').click();
    await waitPhase(page, 'intro');
    await page.waitForFunction(() => !!document.querySelector('.wwm-intro__skip'), null, { timeout: 15_000 });
    await page.getByTestId('intro-skip').click();
    await waitPhase(page, 'countdown', 8_000).then(
      () => shot(page, 'original-portrait-countdown'),
      () => {},
    );
    await waitPhase(page, 'play', 30_000);

    await page.getByTestId('touch-controls').waitFor();
    expect(await page.evaluate(() => window.__wwmGame?.debugState().driver)).toBe('lockstep');

    // Portrait: the game view fits above the reserved control deck rather than sitting under the controls.
    const host = await page.locator('.wwm-stage-host').boundingBox();
    expect(host?.height).toBeLessThan(PORTRAIT.height - 200);

    await shot(page, 'original-portrait-play');
    // Two fingers at once: the left thumb steers, the right thumb jumps.
    const stick = await centre(page, 'touch-stick');
    const jump = await centre(page, 'touch-jump');
    const before = await ball(page);
    const left: Point = { x: stick.x, y: stick.y, id: 1 };
    await dispatch(cdp, 'touchStart', [left]);
    await dispatch(cdp, 'touchMove', [{ ...left, x: stick.x + 40 }]);
    await page.waitForFunction(() => window.__wwmGame?.tilt().power === true, null, { timeout: 5_000 });
    const right: Point = { x: jump.x, y: jump.y, id: 2 };
    let peak = before?.[1] ?? 0;
    await dispatch(cdp, 'touchStart', [{ ...left, x: stick.x + 40 }, right]);
    await page.waitForTimeout(120);
    await shot(page, 'original-portrait-active');
    // Sample briefly (a long hold can roll off the practice island on a slow runner)
    for (let i = 0; i < 12 && peak <= (before?.[1] ?? 0) + 0.02; i++) {
      peak = Math.max(peak, (await ball(page))?.[1] ?? 0);
      await page.waitForTimeout(30);
    }
    await dispatch(cdp, 'touchEnd', [right]); // CDP ends exactly the listed points: lift the jump finger first
    const still = await page.evaluate(() => ({
      power: window.__wwmGame?.tilt().power,
      phase: document.body.dataset.phase,
      log: (window as unknown as { __log: string[] }).__log.slice(-12),
    }));
    // Contacts survive a fall (phase 'falling'): only the Jump finger left, so the stick is still steering.
    expect(
      still.power,
      `still steering after the jump finger lifted (phase ${still.phase}): ${JSON.stringify(still.log)}`,
    ).toBe(true);
    await dispatch(cdp, 'touchEnd', [{ ...left, x: stick.x + 40 }]);
    await page.waitForFunction(() => window.__wwmGame?.tilt().power === false, null, { timeout: 5_000 });
    const after = await ball(page);
    expect(
      Math.hypot((after?.[0] ?? 0) - (before?.[0] ?? 0), (after?.[2] ?? 0) - (before?.[2] ?? 0)),
    ).toBeGreaterThan(0.05);
    expect(peak).toBeGreaterThan(before?.[1] ?? 0);

    // Pause from the top-of-screen button: contacts release, and resume needs fresh gestures.
    await page.getByTestId('touch-pause').tap();
    await waitPhase(page, 'paused');
    expect(traffic).toEqual([]);
    await ctx.close();
  }, 180_000);

  test('landscape keeps the full-height stage; container-only size changes resize the engine without a window event', async () => {
    const { ctx, page } = await phone(LANDSCAPE, {});
    await page.addInitScript(() => {
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
    });
    await page.goto(`${base}/?offline=1`);
    await page.getByTestId('start').click();
    await waitPhase(page, 'select');
    await page.getByTestId('site-practice').click();
    await waitPhase(page, 'intro');
    await page.waitForFunction(() => !!document.querySelector('.wwm-intro__skip'), null, { timeout: 15_000 });
    await page.getByTestId('intro-skip').click();
    await waitPhase(page, 'play', 30_000).catch(async (e) => {
      throw new Error(`stuck in ${await phaseOf(page)}: ${e}`);
    });
    await shot(page, 'original-landscape-play');
    const host = await page.locator('.wwm-stage-host').boundingBox();
    expect(host?.height).toBeCloseTo(LANDSCAPE.height, 0);
    const aspectOf = () =>
      page.evaluate(() => {
        const c = document.querySelector('canvas.wwm-canvas') as HTMLCanvasElement;
        return c.width / c.height;
      });
    const a0 = await aspectOf();
    // Change only the gameplay container (no window resize event): the observer must resize the engine.
    await page.evaluate(() => {
      const h = document.querySelector('.wwm-stage-host') as HTMLElement;
      h.style.width = '644px';
    });
    await page.waitForFunction(
      (a) => {
        const c = document.querySelector('canvas.wwm-canvas') as HTMLCanvasElement;
        return Math.abs(c.width / c.height - a) > 0.2;
      },
      a0,
      { timeout: 5_000 },
    );
    await ctx.close();
  }, 180_000);

  test('a cancelled touch (system gesture) releases steering; hiding the page pauses and requires fresh contacts', async () => {
    const { ctx, page, cdp } = await phone(PORTRAIT, {});
    await page.addInitScript(() => {
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
    });
    await page.goto(`${base}/?offline=1`);
    await page.getByTestId('start').click();
    await waitPhase(page, 'select');
    await page.getByTestId('site-practice').click();
    await waitPhase(page, 'intro');
    await page.waitForFunction(() => !!document.querySelector('.wwm-intro__skip'), null, { timeout: 15_000 });
    await page.getByTestId('intro-skip').click();
    await waitPhase(page, 'play', 30_000);
    const stick = await centre(page, 'touch-stick');
    const finger: Point = { x: stick.x, y: stick.y, id: 1 };
    await dispatch(cdp, 'touchStart', [finger]);
    await dispatch(cdp, 'touchMove', [{ ...finger, x: stick.x + 70 }]);
    await page.waitForFunction(() => window.__wwmGame?.tilt().power === true, null, { timeout: 5_000 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForFunction(() => window.__wwmGame?.tilt().power === false, null, { timeout: 5_000 });
    await ctx.close();
  }, 180_000);

  test.each([
    ['portrait', PORTRAIT],
    ['landscape', LANDSCAPE],
  ])(
    'Race stunt course, %s: stick under the right thumb, Jump/Turbo/Pause one width, nothing overlaps',
    async (name, viewport) => {
      const { ctx, page } = await phone(viewport, {});
      await page.goto(`${base}/race/island-leap`);
      await page.getByTestId('race-ready').waitFor({ timeout: 60_000 });
      await page.getByTestId('race-start').tap();
      await page.waitForFunction(() => window.__wwmRace?.getView().phase === 'racing', null, {
        timeout: 30_000,
      });
      await page.getByTestId('touch-turbo').waitFor();
      await shot(page, `race-stunts-${name}`);
      const box = async (id: string) => {
        const b = await page.getByTestId(id).boundingBox();
        if (!b) throw new Error(`${id} not visible`);
        return b;
      };
      const [stick, jump, turbo, pause] = await Promise.all(
        ['touch-stick', 'touch-jump', 'touch-turbo', 'touch-pause'].map(box),
      );
      if (!stick || !jump || !turbo || !pause) throw new Error('control missing');
      // dominant (right) thumb steers; the action column is on the other side
      expect(stick.x + stick.width / 2).toBeGreaterThan(viewport.width / 2);
      expect(jump.x + jump.width / 2).toBeLessThan(viewport.width / 2);
      expect(turbo.x + turbo.width / 2).toBeLessThan(viewport.width / 2);
      // one width
      expect(Math.abs(jump.width - turbo.width)).toBeLessThan(1.5);
      if (name === 'portrait') expect(Math.abs(jump.width - pause.width)).toBeLessThan(1.5);
      // no two controls overlap (the stick's activation zone is invisible, so compare visible plates only)
      const plates = [jump, turbo, pause];
      for (let i = 0; i < plates.length; i++)
        for (let j = i + 1; j < plates.length; j++) {
          const a = plates[i];
          const b = plates[j];
          if (!a || !b) continue;
          const overlap =
            a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
          expect(overlap, `${i} overlaps ${j}`).toBe(false);
        }
      await ctx.close();
    },
    180_000,
  );

  test('Race: touch entry, steer, Turbo course controls, pause shows the practice consequence, no room traffic', async () => {
    const { ctx, page, cdp } = await phone(PORTRAIT, {});
    await page.goto(`${base}/race/flow-sprint`);
    await page.getByTestId('race-ready').waitFor({ timeout: 60_000 });
    expect(await page.locator('.race-panel').textContent()).toContain('Landscape gives you more room');
    await page.getByTestId('race-start').tap();
    await page.waitForFunction(() => window.__wwmRace?.getView().phase === 'racing', null, {
      timeout: 30_000,
    });
    await page.getByTestId('touch-controls').waitFor();
    await shot(page, 'race-portrait-play');
    const stick = await centre(page, 'touch-stick');
    const finger: Point = { x: stick.x, y: stick.y, id: 1 };
    const t0 = await page.evaluate(() => window.__wwmRace?.debugState().tick ?? 0);
    await dispatch(cdp, 'touchStart', [finger]);
    await dispatch(cdp, 'touchMove', [{ ...finger, y: stick.y - 70 }]);
    await page.waitForTimeout(600);
    const t1 = await page.evaluate(() => window.__wwmRace?.debugState().tick ?? 0);
    expect(t1).toBeGreaterThan(t0);
    await dispatch(cdp, 'touchEnd', []);
    await page.getByTestId('touch-pause').tap();
    await page.getByTestId('race-paused').waitFor();
    expect(await page.locator('.race-panel').textContent()).toContain(
      'This run is now practice. Restart to set a personal best.',
    );
    expect(traffic).toEqual([]);
    await ctx.close();
  }, 180_000);
});
