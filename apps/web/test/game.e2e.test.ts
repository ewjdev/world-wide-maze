/**
 * Phase 08 end-to-end: the real game in Chromium (Vite dev server) against the real Worker + Room DO in
 * workerd (wrangler `unstable_startWorker`).
 *
 *  1. Keyboard full run on handmade-simple with the Phase 05 replay injected as the input source (lockstep
 *     sim) → result screen with exactly the score the Node replay + the rules predict.
 *  2. Pairing with a simulated controller (emulated iPhone context streaming synthetic tilt) → calibrate →
 *     play; POWER + tilt moves the ball; the phone receives `state`.
 *  3. Disconnect mid-play (phone page hidden → silence) → the world freezes with the reconnect overlay →
 *     phone visible again → resumes from the same state.
 *  4. Build failure: a forbidden URL (real worker 400) and a blocked capture (mocked SSE) show the fallback
 *     screen, and a curated alternative (client-side fixture build) plays.
 *
 * Needs Playwright Chromium; skipped locally without it, required in CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { replay } from '@wwm/physics';
import type { InputSample, StageData } from '@wwm/schema';
import { type Browser, type BrowserContext, chromium, devices, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { finishStage, SMALL_CREDIT_DELAY_SEC } from '../src/game/rules.ts';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORKER_CONFIG = fileURLToPath(new URL('../../worker/wrangler.jsonc', import.meta.url));
const HANDMADE = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;
const REPLAY = JSON.parse(
  readFileSync(new URL('../../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
) as InputSample[];
const GPU = ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'];

type Worker = Awaited<ReturnType<typeof import('wrangler').unstable_startWorker>>;

/** Known dev-only noise: React StrictMode mounts the phone controller twice, closing the first socket. */
const DEV_NOISE = /WebSocket is closed before the connection is established/;

describe.skipIf(!HAS_CHROMIUM)('game e2e (Chromium + workerd)', () => {
  let worker: Worker;
  let server: ViteDevServer;
  let browser: Browser;
  let base = '';
  const problems: string[] = [];

  function watch(page: Page, who: string) {
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && !DEV_NOISE.test(m.text()))
        problems.push(`${who} [${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${who} [pageerror] ${e.message}`));
  }

  const phaseOf = (p: Page) => p.evaluate(() => document.body.dataset.phase ?? '');
  const waitPhase = (p: Page, want: string, timeout = 60_000) =>
    p.waitForFunction((w) => document.body.dataset.phase === w, want, { timeout });
  const state = (p: Page) =>
    p.evaluate(() => {
      const d = window.__wwmGame?.debugState();
      return d ? { ...d, engine: null } : null;
    });

  async function desk(hooks: Record<string, unknown>, extra?: (ctx: BrowserContext) => Promise<void>) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((h) => {
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = h;
    }, hooks);
    await extra?.(ctx);
    const page = await ctx.newPage();
    watch(page, 'host');
    return page;
  }

  beforeAll(async () => {
    const { unstable_startWorker } = await import('wrangler');
    worker = await unstable_startWorker({
      config: WORKER_CONFIG,
      dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, persist: false, logLevel: 'error' },
    } as Parameters<typeof unstable_startWorker>[0]);
    await worker.ready;
    process.env.WWM_API_URL = (await worker.url).toString().replace(/\/$/, '');
    server = await createServer({
      root: WEB_ROOT,
      configFile: `${WEB_ROOT}vite.config.ts`,
      logLevel: 'error',
      server: { port: 5290, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    base = (server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5290/').replace(/\/$/, '');
    browser = await chromium.launch({ args: GPU });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await worker?.dispose();
  });

  test('keyboard full run with the Phase 05 replay → result with the expected score', async () => {
    // Expected score from the same replay in Node and the rules module.
    const node = await replay(HANDMADE, REPLAY);
    const goalTick = node.goalTick; // 1-based step index of the goal event
    expect(goalTick).toBeGreaterThan(0);
    let small = 0;
    let large = 0;
    for (const { event } of node.events) {
      if (event.type === 'item') event.kind === 'small' ? small++ : large++;
    }
    // Timer: 300 s minus the simulated time up to and including the goal tick; E: whole seconds = round.
    const remains = HANDMADE.timeLimitSec - goalTick / 120;
    const timeInt = Math.round(remains);
    const items = small + 100 * large;
    const expected = finishStage({ total: items, spares: 3 }, { timeInt, small, large, cleared: true });
    expect(SMALL_CREDIT_DELAY_SEC).toBe(0.3);

    const page = await desk({ replay: REPLAY, lockstep: true, timeScale: 3, noAutoPause: true });
    await page.goto(`${base}/`);
    await page.getByTestId('start').click();
    await waitPhase(page, 'pairing');
    await page.getByTestId('play-keyboard').click();
    await waitPhase(page, 'select');
    await page.getByTestId('site-practice').click();
    await waitPhase(page, 'intro');
    await page.waitForFunction(() => !!document.querySelector('.wwm-intro__skip'), null, { timeout: 10_000 });
    await page.keyboard.press('Space'); // skip the intro
    await waitPhase(page, 'play', 30_000);
    await waitPhase(page, 'goal', 90_000);
    const atGoal = await state(page);
    expect(atGoal?.driver).toBe('lockstep');
    expect(atGoal?.tick).toBe(goalTick);
    expect(atGoal?.timer.int).toBe(timeInt);
    await page.getByTestId('sign-goal').waitFor({ timeout: 20_000 });
    await waitPhase(page, 'result', 20_000);
    const total = page.locator('[data-testid=res-total][data-final]:not([data-final=""])');
    await total.waitFor({ timeout: 20_000 });
    expect(Number(await total.getAttribute('data-final'))).toBe(expected.score.total);
    expect(Number(await page.getByTestId('res-stage').textContent())).toBe(expected.stageScore);
    expect(Number(await page.getByTestId('res-time').textContent())).toBe(expected.bonus);
    expect(Number(await page.getByTestId('res-large').textContent())).toBe(large * 100);
    expect(Number(await page.getByTestId('res-small').textContent())).toBe(small);
    console.log(
      `[e2e] replay goal tick ${goalTick}, ${timeInt} s left, ${large} large + ${small} small → ${expected.score.total}`,
    );

    // Finish → ranking with the name entry, submit → ranked.
    await page.getByTestId('res-finish').click();
    await waitPhase(page, 'ranking');
    await page.getByTestId('name-input').fill('e2e_bot');
    await page.getByTestId('name-submit').click();
    await expect.poll(() => page.getByTestId('rank-value').textContent()).toBe('1st');
    expect(problems).toEqual([]);
    await page.context().close();
  }, 240_000);

  describe('phone', () => {
    let host: Page;
    let phone: Page;

    test('pairing with a simulated controller → calibrate → play with POWER + tilt', async () => {
      host = await desk({ noAutoPause: true, skipIntro: true });
      await host.goto(`${base}/`);
      await host.getByTestId('start').click();
      await waitPhase(host, 'pairing');
      const code = ((await host.getByTestId('pair-code').textContent()) ?? '').replace(/\s/g, '');
      expect(code).toMatch(/^\d{6}$/);
      expect(await host.getByTestId('pair-qr').getAttribute('data-text')).toBe(`${base}/c/${code}`);

      const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
      await ctx.addInitScript(() => {
        const w = window as unknown as Record<string, unknown>;
        const DOE = (w.DeviceOrientationEvent ?? function DeviceOrientationEvent() {}) as Record<string, unknown>;
        DOE.requestPermission = () => Promise.resolve('granted');
        w.__pose = { beta: 45, gamma: 0 };
        setInterval(() => {
          const p = w.__pose as { beta: number; gamma: number };
          const ev = new Event('deviceorientation') as Event & Record<string, number>;
          Object.assign(ev, {
            alpha: 0,
            beta: p.beta + (Math.random() - 0.5) * 0.2,
            gamma: p.gamma + (Math.random() - 0.5) * 0.2,
          });
          window.dispatchEvent(ev);
        }, 16);
      });
      phone = await ctx.newPage();
      watch(phone, 'phone');
      await phone.goto(`${base}/c/${code}`);
      await host.getByText('Connected!').waitFor({ timeout: 10_000 });
      await waitPhase(host, 'calibrate', 10_000);
      await phone.getByTestId('enable-tilt').tap();
      await waitPhase(host, 'select', 20_000); // the phone's `calibrated` advances the host
      expect((await host.evaluate(() => window.__wwmGame?.getView().inputMode)) ?? '').toBe('phone');

      await host.getByTestId('site-practice').click();
      await waitPhase(host, 'countdown', 60_000);
      await waitPhase(host, 'play', 10_000);
      const before = await state(host);
      await phone.evaluate(() => {
        (window as unknown as { __pose: unknown }).__pose = { beta: 30, gamma: 0 };
      });
      const power = phone.getByTestId('btn-power');
      await power.dispatchEvent('pointerdown', { pointerId: 5, isPrimary: true, pointerType: 'touch' });
      await host.waitForTimeout(1600);
      await power.dispatchEvent('pointerup', { pointerId: 5, isPrimary: true, pointerType: 'touch' });
      await phone.evaluate(() => {
        (window as unknown as { __pose: unknown }).__pose = { beta: 45, gamma: 0 };
      });
      const after = await state(host);
      const moved = Math.hypot(
        (after?.ball[0] ?? 0) - (before?.ball[0] ?? 0),
        (after?.ball[2] ?? 0) - (before?.ball[2] ?? 0),
      );
      console.log(`[e2e] phone POWER + 15° tilt for 1.6 s moved the ball ${moved.toFixed(2)} m`);
      expect(moved).toBeGreaterThan(0.5);
      expect(after?.timer.running).toBe(true);
      // host → controller `state`: the phone shows the host HUD values
      await expect.poll(async () => (await phone.textContent('body')) ?? '', { timeout: 5000 }).toMatch(/TIME/);
    }, 180_000);

    test('disconnect → freeze + reconnect overlay → reconnect → resume from the same state', async () => {
      expect(await phaseOf(host)).toBe('play');
      await phone.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await host.getByTestId('disconnect-overlay').waitFor({ timeout: 6000 });
      const frozen = await state(host);
      expect(frozen?.hold).toBe('disconnected');
      expect(await host.getByTestId('hold-code').textContent()).toMatch(/^\d{3} \d{3}$/);
      await host.waitForTimeout(2500);
      const still = await state(host);
      expect(still?.phase).toBe('play');
      expect(still?.timer.remains).toBe(frozen?.timer.remains); // timer frozen
      expect(still?.clock).toBe(frozen?.clock); // game clock frozen
      expect(still?.ball).toEqual(frozen?.ball); // world frozen

      await phone.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await host.getByTestId('disconnect-overlay').waitFor({ state: 'detached', timeout: 8000 });
      const resumed = await state(host);
      expect(resumed?.hold).toBeNull();
      expect(resumed?.phase).toBe('play');
      expect(Math.abs((resumed?.timer.remains ?? 0) - (frozen?.timer.remains ?? 0))).toBeLessThan(1.5);
      await expect.poll(async () => (await state(host))?.timer.remains ?? 0, { timeout: 5000 }).toBeLessThan(
        (frozen?.timer.remains ?? 0) - 0.3,
      ); // and it runs again
      expect(problems).toEqual([]);
      await phone.context().close();
      await host.context().close();
    }, 60_000);
  });

  test('build failure → fallback screen → curated alternative plays (offline fixture build)', async () => {
    // (a) real worker: a private address is refused by the SSRF policy (400 URL_FORBIDDEN)
    const page = await desk({ noAutoPause: true, skipIntro: true });
    await page.goto(`${base}/`);
    await page.getByTestId('start').click();
    await page.getByTestId('play-keyboard').click();
    await waitPhase(page, 'select');
    await page.getByTestId('url-input').fill('localhost:8080/admin');
    await page.getByTestId('url-go').click();
    await waitPhase(page, 'error', 20_000);
    expect(await page.getByTestId('error').getAttribute('data-code')).toBe('URL_FORBIDDEN');
    // The browser itself logs the refused request (400) as a console error; that is this test's subject.
    const i = problems.findIndex((p) => /Failed to load resource.*400/.test(p));
    if (i >= 0) problems.splice(i, 1);
    await page.getByTestId('error-back').click();
    await waitPhase(page, 'select');

    // (b) a capture the site blocks, reported over the job's SSE stream
    await page.route('**/api/stages', (r) =>
      r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'e2e-job' }) }),
    );
    await page.route('**/api/jobs/e2e-job', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'event: progress\ndata: {"step":"capturing","pct":20}\n\n' +
          'event: error\ndata: {"code":"CAPTURE_BLOCKED","message":"challenge page"}\n\n',
      }),
    );
    await page.getByTestId('url-input').fill('https://example.org/');
    await page.getByTestId('url-go').click();
    await waitPhase(page, 'error', 20_000);
    expect(await page.getByTestId('error').getAttribute('data-code')).toBe('CAPTURE_BLOCKED');
    await expect.poll(() => page.locator('[data-testid^=alt-]').count()).toBeGreaterThan(1);

    // the alternative: a fixture capture built client-side (no service needed)
    await page.getByTestId('alt-fixture-hn-front').click();
    await waitPhase(page, 'building');
    await waitPhase(page, 'countdown', 60_000);
    const s = await state(page);
    expect(s?.stageId).toMatch(/^[0-9a-f]{64}$/);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 120_000);
});
