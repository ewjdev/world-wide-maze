/**
 * Phase 20 M4b end-to-end: a lesson in the real game (Vite dev server + Chromium), `/api` mocked, Pip silent.
 *
 *  1. `/play/practice?learn=compare-groups`: the practice stage gets Pip gates. The ball rolls into gate 1 with the
 *     real physics → the gate card asks "Which island has more gems?" with the sim and the timer paused. A wrong
 *     answer by keyboard shows the first hint; the right one shows Pip's success line; "Roll on!" resumes play.
 *     Gate 2 asks round 2.
 *  2. A downloaded learning page picked in the site-select loader: its first playable lesson shows at gate 1.
 *
 * Speech is removed (the voice player falls back to silent, estimated cue timing) and clip requests are aborted,
 * so the run is silent and deterministic. Needs Playwright Chromium; skipped locally without it, required in CI.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { baselinePath, learningScript } from '@wwm/learning';
import { type Browser, chromium, type Page, type Route } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS } from './browser-env.ts';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));

type Dbg = {
  phase: string;
  tick: number;
  timer: { running: boolean; remains: number };
  learning: {
    active: boolean;
    activityId: string | null;
    gate: { number: number; round: string; mode: string; solved: boolean } | null;
  };
};

describe.skipIf(!HAS_CHROMIUM)('Pip gates e2e (Chromium, mocked /api)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base = '';
  const problems: string[] = [];

  beforeAll(async () => {
    process.env.WWM_API_URL = 'http://127.0.0.1:9'; // nothing listens: every /api call is routed below
    server = await createServer({
      root: WEB_ROOT,
      configFile: `${WEB_ROOT}vite.config.ts`,
      logLevel: 'error',
      server: { port: 5297, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    base = (server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5297/').replace(/\/$/, '');
    browser = await chromium.launch({ args: CHROMIUM_ARGS });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function open(path: string) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await browserEnv(ctx);
    await ctx.addInitScript((ci) => {
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      // silent Pip: no browser speech (the player falls back to estimated cue timing)
      Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
      (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = {
        ...ci,
        skipIntro: true,
        noAutoPause: true,
        timeScale: 2,
      };
    }, CI_HOOKS);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    await page.route('**/*.mp3', (route) => route.abort());
    // the capture service is offline for these tests: boards stay on the device, no ghosts, no rooms
    await page.route('**/api/**', (route: Route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"UNAVAILABLE"}' }),
    );
    await page.goto(`${base}${path}`);
    return { page, ctx };
  }

  const waitPhase = (p: Page, want: string, timeout = 60_000) =>
    p.waitForFunction((w) => document.body.dataset.phase === w, want, { timeout });
  const state = (p: Page) =>
    p.evaluate(() => {
      const d = (window as unknown as { __wwmGame: { debugState(): unknown } }).__wwmGame.debugState();
      return { ...(d as object), engine: null } as unknown as Dbg;
    });
  const roll = (p: Page, id: number) =>
    p.evaluate(
      (i) =>
        (
          window as unknown as { __wwmGame: { debugRollIntoPortal(id: number, m: number): boolean } }
        ).__wwmGame.debugRollIntoPortal(i, 4),
      id,
    );
  const text = async (p: Page, testId: string) => (await p.textContent(`[data-testid="${testId}"]`)) ?? '';

  test('roll into a Pip gate, answer the round, roll on; the next gate asks the next round', async () => {
    const { page, ctx } = await open('/play/practice?learn=compare-groups');
    await waitPhase(page, 'play');
    expect((await state(page)).learning).toMatchObject({ active: true, activityId: 'compare-groups' });
    await page.waitForSelector('[data-testid="learning-hud"]');

    expect(await roll(page, 0)).toBe(true);
    await page.waitForSelector('[data-testid="learning-gate"]', { timeout: 15_000 });
    expect(await text(page, 'lgate-prompt')).toBe('Which island has more gems?');
    const s1 = await state(page);
    expect(s1.phase).toBe('play');
    expect(s1.learning.gate).toMatchObject({ number: 1, round: 'r1', mode: 'round', solved: false });
    expect(s1.timer.running).toBe(false);
    // paused: the sim doesn't step while the card shows
    await page.waitForTimeout(400);
    expect((await state(page)).tick).toBe(s1.tick);
    // the scene: two islands to tap, drawn by the shared renderer
    expect(await page.locator('[data-testid="lgate-scene"] svg.wwm-scene').count()).toBe(1);
    expect(await page.getAttribute('[data-testid="lgate-choice-a"]', 'aria-label')).toBe('Island A: 2 gems');

    // wrong (island A) by keyboard → the first hint
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() => page.locator('[data-choice-mark="a"].is-focus').count(), { timeout: 5_000 })
      .toBe(1);
    await page.keyboard.press('Enter');
    await expect
      .poll(() => text(page, 'lgate-feedback'), { timeout: 5_000 })
      .toBe('Look at both islands. Take your time.');
    expect(await page.locator('[data-choice-mark="a"].is-retry').count()).toBe(1);

    // the match tool
    await page.click('[data-testid="lgate-match"]');
    await expect.poll(() => page.locator('[data-pair].is-shown').count(), { timeout: 10_000 }).toBe(2);

    // right (island B) → Pip's success line; the round locks
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => text(page, 'lgate-feedback'), { timeout: 5_000 })
      .toBe('Yes! Four is more than two. Bridge, go!');
    expect((await state(page)).learning.gate?.solved).toBe(true);
    expect(await page.locator('[data-choice-mark="b"].is-correct').count()).toBe(1);
    expect((await state(page)).tick).toBe(s1.tick);

    // "Roll on!" → play resumes with the timer running
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="learning-gate"]', { state: 'detached' });
    await expect.poll(async () => (await state(page)).timer.running, { timeout: 5_000 }).toBe(true);
    await expect.poll(async () => (await state(page)).tick, { timeout: 5_000 }).toBeGreaterThan(s1.tick);

    // gate 2 → round 2
    expect(await roll(page, 1)).toBe(true);
    await page.waitForSelector('[data-testid="learning-gate"]', { timeout: 15_000 });
    expect(await text(page, 'lgate-prompt')).toBe('Ooh, these are close. Which island has more gems?');
    expect((await state(page)).learning.gate).toMatchObject({ number: 2, round: 'r2' });

    // "Skip gate" never costs anything: play resumes, the lesson waits at round 2
    await page.click('[data-testid="lgate-skip"]');
    await page.waitForSelector('[data-testid="learning-gate"]', { state: 'detached' });
    expect((await state(page)).phase).toBe('play');
    await ctx.close();
    expect(problems).toEqual([]);
  }, 180_000);

  test('a downloaded learning page loads through the file input and plays at the first gate', async () => {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Little discoveries</title></head><body><main><h1>Little discoveries</h1><p>A learning page.</p></main>${learningScript(baselinePath)}</body></html>`;
    const { page, ctx } = await open('/');
    await page.waitForSelector('[data-testid="start"]:not([disabled])', { timeout: 60_000 });
    await page.click('[data-testid="start"]');
    await waitPhase(page, 'pairing');
    await page.click('[data-testid="play-keyboard"]');
    await waitPhase(page, 'select');

    await page.setInputFiles('[data-testid="learning-file"]', {
      name: 'little-discoveries.html',
      mimeType: 'text/html',
      buffer: Buffer.from(html, 'utf8'),
    });
    await page.waitForSelector('[data-testid="learning-lesson"]');
    expect(await text(page, 'learning-lesson')).toContain('One, two, three');
    expect(await text(page, 'learning-lesson')).toContain('little-discoveries.html');

    // a file that isn't a learning page is refused kindly (the loaded lesson stays)
    await page.setInputFiles('[data-testid="learning-file"]', {
      name: 'notes.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<html><body><script>alert(1)</script></body></html>', 'utf8'),
    });
    await page.waitForSelector('[data-testid="learning-error"]');
    expect(await text(page, 'learning-lesson')).toContain('One, two, three');

    await page.click('[data-testid="site-practice"]');
    await waitPhase(page, 'play');
    expect(await roll(page, 0)).toBe(true);
    await page.waitForSelector('[data-testid="learning-gate"]', { timeout: 15_000 });
    expect(await text(page, 'lgate-prompt')).toBe('Which group has three gems?');
    // a tap answers directly
    await page.click('[data-testid="lgate-choice-three"]');
    await expect
      .poll(() => text(page, 'lgate-feedback'), { timeout: 5_000 })
      .toBe('One, two, three. This group has three gems!');
    await page.click('[data-testid="lgate-rollon"]');
    await page.waitForSelector('[data-testid="learning-gate"]', { state: 'detached' });
    await ctx.close();
    expect(problems).toEqual([]);
  }, 180_000);
});
