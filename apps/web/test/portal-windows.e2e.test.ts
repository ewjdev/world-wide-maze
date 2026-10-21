/**
 * Portal windows end-to-end (N; plans/portal-windows-execution.md M1): the real game with
 * `VITE_PORTAL_WINDOWS_ENABLED=true` (its own Vite server, so the flag-off coverage in portal.e2e.test.ts stays as
 * it is). Offline (`?offline=1`), nothing reaches /api.
 *  1. `portal-hub`: the three portals to bundled fixtures show their pictures; the w3.org one shows the postcard.
 *  2. Hacker News: every link leads to a real site, so every portal shows the postcard.
 *  3. M2 travel (portal-hub → example.com, both bundled): the window grows from the gate, the build happens inside
 *     it (no veil), the next world loads only once it covers the screen, and it cuts into the intro and unmounts;
 *     score, spares and the trail carry over. Cancel mid-travel and a failed build leave cleanly; reduced motion
 *     completes the same journey with crossfades.
 *  4. M3: with the service answering (mocked), a link to a site already built there shows that site's texture.
 *  All stay inside the draw-call budget with no page errors.
 *
 * Needs Playwright Chromium; skipped locally without it, required in CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS, EXPECTED_BACKEND, SOFTWARE_GL_NOISE } from './browser-env.ts';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));

type Dbg = {
  phase: string;
  total: number;
  spares: number;
  stageId: string | null;
  portalPreviews: Record<string, string>;
  travelTiming: { coveredAt: number | null; loadAt: number | null };
  journey: { host: string; via: string }[];
  engine: { backend: string; drawCalls: number } | null;
};

/**
 * Pre-existing on origin/main (found while building M2, docs/build-log/portal-windows.md): Phase 13 travel on
 * WebGPU logs one uncaptured "Invalid Texture" validation error with the flag off too. Tracked separately.
 */
const KNOWN_TRAVEL_NOISE =
  /Uncaptured WebGPU GPUValidationError: \[Invalid Texture\] is invalid due to a previous error/;
/** portal-hub's portal to example.com (a one-slice fixture, so travel is quick). */
const TO_EXAMPLE = 3;

describe.skipIf(!HAS_CHROMIUM)('portal windows e2e (Chromium, offline, flag on)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base = '';
  const problems: string[] = [];
  const previousFlag = process.env.VITE_PORTAL_WINDOWS_ENABLED;

  beforeAll(async () => {
    // Vite reads VITE_* from process.env when the server is created.
    process.env.VITE_PORTAL_WINDOWS_ENABLED = 'true';
    // tilt as in the preview and production builds (it only applies on touch devices: the phone test below)
    process.env.VITE_MOBILE_TILT_ENABLED = 'true';
    process.env.WWM_API_URL = 'http://127.0.0.1:9';
    server = await createServer({
      root: WEB_ROOT,
      configFile: `${WEB_ROOT}vite.config.ts`,
      logLevel: 'error',
      server: { port: 5296, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    base = (server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5296/').replace(/\/$/, '');
    browser = await chromium.launch({ args: CHROMIUM_ARGS });
  }, 120_000);

  beforeEach(() => {
    problems.length = 0;
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (previousFlag === undefined) delete process.env.VITE_PORTAL_WINDOWS_ENABLED;
    else process.env.VITE_PORTAL_WINDOWS_ENABLED = previousFlag;
  });

  /**
   * Open `stage` and reach play. `intros: 'skip'` skips every intro through the test hook; `'first'` skips only
   * this first one by hand, so a travel's arrival plays its real intro (the window cuts into it).
   */
  async function play(
    stage: string,
    o: {
      intros?: 'skip' | 'first';
      reducedMotion?: boolean;
      online?: (page: Page) => Promise<void>;
    } = {},
  ) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: o.reducedMotion ? 'reduce' : 'no-preference',
    });
    await browserEnv(ctx);
    await ctx.addInitScript(
      ({ ci, skip }) => {
        localStorage.setItem('wwm.howtoSeen', '1');
        localStorage.setItem('wwm.tutorialDone', '1');
        (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = {
          ...ci,
          skipIntro: skip,
          noAutoPause: true,
        };
      },
      { ci: CI_HOOKS, skip: (o.intros ?? 'skip') === 'skip' },
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    page.on('console', (m) => {
      const text = m.text();
      if (m.type() === 'error' && !SOFTWARE_GL_NOISE.test(text) && !KNOWN_TRAVEL_NOISE.test(text))
        problems.push(`[console] ${text}`);
    });
    if (o.online) await o.online(page);
    await page.goto(`${base}/play/${stage}${o.online ? '' : '?offline=1'}`);
    if (o.intros === 'first') {
      await page.waitForFunction(() => document.body.dataset.phase === 'intro', null, { timeout: 90_000 });
      await page.waitForFunction(
        () => {
          (window as unknown as { __wwmGame: { skipIntro(): void } }).__wwmGame.skipIntro();
          return document.body.dataset.phase !== 'intro';
        },
        null,
        { timeout: 30_000, polling: 200 },
      );
    }
    await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 90_000 });
    return { page, ctx };
  }

  const waitPhase = (p: Page, want: string, timeout = 60_000) =>
    p.waitForFunction((w) => document.body.dataset.phase === w, want, { timeout });

  /** Roll into portal-hub's example.com portal and press Travel; resolves once the window exists. */
  async function travel(page: Page, o: { stallClock?: boolean } = {}) {
    await expect
      .poll(async () => (await state(page)).portalPreviews[TO_EXAMPLE], { timeout: 30_000 })
      .toBe('ready');
    const rolled = await page.evaluate(
      (id) =>
        (
          window as unknown as { __wwmGame: { debugRollIntoPortal(id: number, m: number): boolean } }
        ).__wwmGame.debugRollIntoPortal(id, 5),
      TO_EXAMPLE,
    );
    expect(rolled).toBe(true);
    await page.waitForSelector('[data-testid="portal-travel"]', { timeout: 20_000 });
    // stop the clock the gate animation runs on, the way tilt did before the 2026-10-21 fix
    if (o.stallClock)
      await page.evaluate(() => {
        (window as unknown as { __WWM_TEST__: { timeScale?: number } }).__WWM_TEST__.timeScale = 0;
      });
    await page.click('[data-testid="portal-travel"]', { timeout: 20_000 });
    await page.waitForSelector('[data-testid="travel-window"]', { timeout: 15_000 });
  }

  const state = (p: Page) =>
    p.evaluate(
      () => (window as unknown as { __wwmGame: { debugState(): unknown } }).__wwmGame.debugState() as Dbg,
    );

  test('portal-hub: fixture targets show their pictures, the real site shows the postcard', async () => {
    const { page, ctx } = await play('fixture-portal-hub');
    await expect
      .poll(async () => (await state(page)).portalPreviews, { timeout: 30_000 })
      .toEqual({ 0: 'postcard', 1: 'ready', 2: 'ready', 3: 'ready' });
    const s = await state(page);
    expect(s.engine?.backend).toBe(EXPECTED_BACKEND);
    expect(s.engine?.drawCalls ?? 0).toBeLessThan(50);
    expect(problems).toEqual([]);
    await ctx.close();
  }, 120_000);

  test('Hacker News: real-site links all show the postcard', async () => {
    const { page, ctx } = await play('fixture-hn-front');
    const s = await state(page);
    const states = Object.values(s.portalPreviews);
    expect(states.length).toBeGreaterThan(0);
    expect(new Set(states)).toEqual(new Set(['postcard']));
    expect(s.engine?.drawCalls ?? 0).toBeLessThan(50);
    expect(problems).toEqual([]);
    await ctx.close();
  }, 120_000);

  test('travel: the window grows from the gate, covers the build, loads under it and cuts into the intro', async () => {
    const { page, ctx } = await play('fixture-portal-hub', { intros: 'first' });
    const before = await state(page);
    await travel(page);
    // the window replaces the veil for the whole travel, and the building panel sits on it
    await waitPhase(page, 'building');
    expect(await page.$('.wwm-veil')).toBeNull();
    expect(await page.isVisible('[data-testid="building"]')).toBe(true);
    // the next world loads only once the window covers the screen, then the intro starts under the window
    await waitPhase(page, 'intro');
    const s = await state(page);
    expect(s.stageId).not.toBe(before.stageId);
    expect(s.travelTiming.coveredAt).not.toBeNull();
    expect(s.travelTiming.loadAt ?? 0).toBeGreaterThanOrEqual(
      s.travelTiming.coveredAt ?? Number.POSITIVE_INFINITY,
    );
    // it fades into the intro and hands back while the intro is still playing
    await page.waitForSelector('[data-testid="travel-window"]', { state: 'detached', timeout: 10_000 });
    expect((await state(page)).phase).toBe('intro');
    // score, spares and the trail carried over
    const after = await state(page);
    expect(after.spares).toBe(before.spares);
    expect(after.total).toBeGreaterThanOrEqual(before.total);
    expect(after.journey.map((j) => [j.host, j.via])).toEqual([
      [before.journey[0]?.host, 'start'],
      ['example.com', 'portal'],
    ]);
    expect(problems).toEqual([]);
    await ctx.close();
  }, 180_000);

  test('travel: Cancel while building closes the window', async () => {
    const { page, ctx } = await play('fixture-portal-hub');
    await travel(page);
    await waitPhase(page, 'building');
    await page.click('[data-testid="building"] button');
    await waitPhase(page, 'select');
    await page.waitForSelector('[data-testid="travel-window"]', { state: 'detached', timeout: 5_000 });
    expect(problems).toEqual([]);
    await ctx.close();
  }, 180_000);

  test('travel: a failed build closes the window and the trail drops the stop', async () => {
    const { page, ctx } = await play('fixture-portal-hub');
    await expect
      .poll(async () => (await state(page)).portalPreviews[TO_EXAMPLE], { timeout: 30_000 })
      .toBe('ready');
    // the destination's capture can no longer be fetched (its preview was decoded already)
    await page.route('**/example-sparse/**', (r) => r.abort());
    await travel(page);
    await waitPhase(page, 'error');
    await page.waitForSelector('[data-testid="travel-window"]', { state: 'detached', timeout: 5_000 });
    expect((await state(page)).journey.map((j) => j.via)).toEqual(['start']);
    // only the requests this test aborted on purpose
    expect(problems.filter((p) => !/net::ERR_FAILED|example-sparse|Failed to fetch/.test(p))).toEqual([]);
    await ctx.close();
  }, 180_000);

  test('travel with reduced motion: crossfades, and still arrives', async () => {
    const { page, ctx } = await play('fixture-portal-hub', { intros: 'first', reducedMotion: true });
    await travel(page);
    expect(await page.getAttribute('[data-testid="travel-window"]', 'data-motion')).toBe('reduced');
    await waitPhase(page, 'intro');
    await page.waitForSelector('[data-testid="travel-window"]', { state: 'detached', timeout: 10_000 });
    expect((await state(page)).journey.map((j) => j.via)).toEqual(['start', 'portal']);
    expect(problems).toEqual([]);
    await ctx.close();
  }, 180_000);

  test('M3: a site already built on the service shows its texture (mocked lookup + texture)', async () => {
    const W3 = 'https://www.w3.org/';
    const STAGE = 'c3'.repeat(32);
    const lookups: unknown[] = [];
    const png = readFileSync(
      new URL('../../../fixtures/captures/portal-hub/screenshot.png', import.meta.url),
    );
    const { page, ctx } = await play('fixture-portal-hub', {
      online: async (p) => {
        await p.route('**/api/health', (r) => r.fulfill({ json: { ok: true } }));
        await p.route('**/api/portals/previews', async (r) => {
          const body = r.request().postDataJSON() as { urls: string[] };
          lookups.push(body);
          await r.fulfill({
            json: { items: body.urls.map((url) => ({ url, stageId: url === W3 ? STAGE : null })) },
          });
        });
        await p.route(`**/api/stages/${STAGE}/texture`, (r) =>
          r.fulfill({ status: 200, contentType: 'image/png', body: png }),
        );
        await p.route('**/api/scores/**', (r) => r.fulfill({ json: { entries: [] } }));
      },
    });
    await expect
      .poll(async () => (await state(page)).portalPreviews, { timeout: 30_000 })
      .toEqual({ 0: 'ready', 1: 'ready', 2: 'ready', 3: 'ready' });
    // one batched lookup, for the one link that isn't a bundled fixture
    expect(lookups).toEqual([{ urls: [W3] }]);
    expect(problems).toEqual([]);
    await ctx.close();
  }, 120_000);

  test('tilt controls on a phone: travel through a portal never hangs (the 2026-10-21 iPhone report)', async () => {
    // A phone with synthetic orientation readings, as in mobile-tilt.e2e.test.ts. During travel the game owns no
    // input, so tilt can't "advance"; that must not freeze the clock the portal animation and the build run on.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await browserEnv(ctx);
    await ctx.addInitScript((ci) => {
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = {
        ...ci,
        skipIntro: true,
        noAutoPause: true,
      };
      const granted = () => Promise.resolve('granted');
      Object.defineProperty(DeviceOrientationEvent, 'requestPermission', {
        value: granted,
        configurable: true,
      });
      Object.defineProperty(DeviceMotionEvent, 'requestPermission', { value: granted, configurable: true });
      const state = { beta: 0, gamma: 0 };
      Object.assign(window, { __motion: state });
      setInterval(() => {
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
    }, CI_HOOKS);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    page.on('console', (m) => {
      const text = m.text();
      if (m.type() === 'error' && !SOFTWARE_GL_NOISE.test(text) && !KNOWN_TRAVEL_NOISE.test(text))
        problems.push(`[console] ${text}`);
    });
    await page.goto(`${base}/play/fixture-portal-hub?offline=1`);
    // the motion setup, as a player does it
    await page.getByTestId('motion-enable').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="motion-setup"]')?.getAttribute('data-state') === 'probing',
    );
    await page.waitForTimeout(120);
    await page.evaluate(() =>
      Object.assign((window as unknown as { __motion: object }).__motion, { beta: 8 }),
    );
    await page.getByTestId('motion-setup').waitFor({ state: 'hidden', timeout: 10_000 });
    await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 90_000 });
    expect((await page.evaluate(() => window.__wwmGame?.getView().inputMode)) ?? null).toBe('tilt');
    await travel(page);
    // the window covers, the build runs (the building panel shows), and the next maze's intro starts
    await waitPhase(page, 'building', 15_000);
    expect(await page.isVisible('[data-testid="building"]')).toBe(true);
    await waitPhase(page, 'intro', 60_000);
    expect((await state(page)).journey.map((j) => j.via)).toEqual(['start', 'portal']);
    expect(problems).toEqual([]);
    await ctx.close();
  }, 180_000);

  /** Hold travel in its "opening" state: the watchdog won't start the build for this test's lifetime. */
  const holdWatchdog = (page: Page) =>
    page.evaluate(() => {
      (window as unknown as { __WWM_TEST__: { travelWatchdogMs?: number } }).__WWM_TEST__.travelWatchdogMs =
        600_000;
    });

  test('a stalled game clock: the window opens anyway and says what is happening', async () => {
    const { page, ctx } = await play('fixture-portal-hub');
    await holdWatchdog(page);
    await travel(page, { stallClock: true });
    const status = page.getByTestId('travel-status');
    await expect
      .poll(async () => (await status.textContent({ timeout: 10_000 })) ?? '')
      .toContain('Opening the portal to example.com');
    expect((await state(page)).phase).toBe('play');
    await ctx.close();
  }, 180_000);

  test('a stalled game clock: the watchdog still starts the build', async () => {
    const { page, ctx } = await play('fixture-portal-hub');
    await travel(page, { stallClock: true });
    await waitPhase(page, 'building', 30_000);
    expect(await page.isVisible('[data-testid="building"]')).toBe(true);
    await ctx.close();
  }, 180_000);

  test('the way out of a portal that never opens: back to this maze, paused, the trail unchanged', async () => {
    const { page, ctx } = await play('fixture-portal-hub');
    await holdWatchdog(page);
    await travel(page, { stallClock: true });
    await page.getByTestId('travel-status').waitFor({ timeout: 10_000 });
    await page.evaluate(() =>
      (window as unknown as { __wwmGame: { leaveTravel(): void } }).__wwmGame.leaveTravel(),
    );
    await waitPhase(page, 'paused', 10_000);
    await page.waitForSelector('[data-testid="travel-window"]', { state: 'detached', timeout: 10_000 });
    expect((await state(page)).journey.map((j) => j.via)).toEqual(['start']);
    expect(problems).toEqual([]);
    await ctx.close();
  }, 180_000);
});
