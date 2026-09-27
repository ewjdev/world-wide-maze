/**
 * Phase 20 M4b end-to-end: a lesson in the real game (Vite dev server + Chromium), `/api` mocked, Pip silent.
 *
 *  1. `/play/practice?learn=compare-groups`: the practice stage gets Pip gates. The ball rolls into gate 1 with the
 *     real physics → the gate card asks "Which island has more gems?" with the sim and the timer paused. A wrong
 *     answer by keyboard shows the first hint; the right one shows Pip's success line; "Roll on!" resumes play.
 *     Gate 2 asks round 2.
 *  2. A downloaded learning page picked in the site-select loader: its first playable lesson shows at gate 1.
 *  3. Phase 22 (`gated`, the default level): the ball rolls at a locked bridge → the lock banner and Pip's line
 *     (the physics' `locked` event, or the region guard sending the ball back on a build without barriers) → the
 *     gate's round is solved → the lock opens → the ball crosses. A letter-key round shows its key badges.
 *  4. Phase 22: the loader strip shows the level; the Grown-ups control (press and hold) switches to `mission`;
 *     a mission post starts "Bring Pip four gems" with the mission HUD.
 *
 * The session seed is pinned (`learningSeed: 0`: answer positions as written) so the answers are known.
 * `WWM_P22_SHOTS=1` writes screenshots to /tmp/wwm-p22-game/.
 *
 * Speech is removed (the voice player falls back to silent, estimated cue timing) and clip requests are aborted,
 * so the run is silent and deterministic. Needs Playwright Chromium; skipped locally without it, required in CI.
 */
import { existsSync, mkdirSync } from 'node:fs';
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
  island: number | null;
  spares: number;
  tick: number;
  timer: { running: boolean; remains: number };
  ball: [number, number, number];
  rollLevel: number;
  learning: {
    active: boolean;
    activityId: string | null;
    level: string | null;
    gate: {
      number: number;
      round: string;
      mode: string;
      solved: boolean;
      badges: boolean;
      invited: string[];
    } | null;
    binding: {
      steps: {
        index: number;
        kind: string;
        lock: string;
        island: number | null;
        portalId: number | null;
        lockIds: number[];
      }[];
      locks: { id: number; kind: string; targetId: number; islandId: number; open: boolean }[];
    } | null;
    said: string[];
    guards: number;
    banner: { kind: string; n: number } | null;
    port: { physics: boolean; engine: boolean };
    missions: { index: number; status: string; count: number; have: number }[];
  };
  learningRun: boolean;
};

const SHOTS = process.env.WWM_P22_SHOTS === '1' ? '/tmp/wwm-p22-game' : null;

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
        learningSeed: 0,
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
  const game = <T>(p: Page, fn: string, ...args: number[]) =>
    p.evaluate(
      ([f, a]) => {
        const g = (window as unknown as { __wwmGame: Record<string, (...x: number[]) => unknown> }).__wwmGame;
        return g[f as string]?.(...(a as number[])) as T;
      },
      [fn, args] as const,
    );
  const shot = async (p: Page, name: string) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await p.screenshot({ path: `${SHOTS}/${name}.png` });
  };

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
    // the ball rolled in with POWER, but the rolling/wind sound doesn't carry on behind the card
    expect(s1.rollLevel).toBe(0);
    expect((await state(page)).rollLevel).toBe(0);
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
    // the only step: the same card goes on to Pip's finale, then rolls on
    expect(await page.getAttribute('[data-testid="lgate-rollon"]', 'data-next')).toBe('more');
    await page.click('[data-testid="lgate-rollon"]');
    await page.waitForSelector('[data-testid="learning-gate"][data-mode="done"]');
    await page.click('[data-testid="lgate-rollon"]');
    await page.waitForSelector('[data-testid="learning-gate"]', { state: 'detached' });
    await ctx.close();
    expect(problems).toEqual([]);
  }, 180_000);

  test('gated: a locked bridge explains itself; solving its gate opens it and the ball crosses', async () => {
    const { page, ctx } = await open('/play/practice?learn=compare-groups');
    await waitPhase(page, 'play');
    let s = await state(page);
    expect(s.learning.level).toBe('gated');
    expect(s.learningRun).toBe(true);
    const step0 = s.learning.binding?.steps[0];
    expect(step0).toMatchObject({ kind: 'round', lock: 'path', island: 0 });
    const lockId = step0?.lockIds[0] as number;
    expect(s.learning.binding?.locks.find((l) => l.id === lockId)).toMatchObject({
      kind: 'bridge',
      open: false,
    });

    expect(s.learning.port).toEqual({ physics: true, engine: true });

    // roll at the bridge with POWER for 3 s: the real gate stops the ball and the physics reports `locked`
    expect(await game<boolean>(page, 'debugRollIntoLock', lockId, 4)).toBe(true);
    await page.waitForSelector('[data-testid="learning-banner"]', { timeout: 15_000 });
    await page.waitForTimeout(700);
    expect(await text(page, 'learning-banner')).toBe('🔒 Solve Pip gate 1 first');
    s = await state(page);
    expect(s.learning.said).toContain('pip.locked.gate.1');
    await shot(page, '2-lock-banner');
    // the ball didn't cross: still on the start island, the guard never needed, nothing lost
    await page.waitForTimeout(2500);
    s = await state(page);
    expect(s.island).toBe(0);
    expect(s.learning.guards).toBe(0);
    expect(s.phase).toBe('play');
    expect(s.spares).toBe(3);

    // a hop onto an island past the lock (what a ball can do between close page blocks): the region guard
    // sends it back to the start island, and Pip says so
    await game(page, 'debugIsland', 2);
    await expect.poll(async () => (await state(page)).learning.guards, { timeout: 5_000 }).toBe(1);
    s = await state(page);
    expect(s.learning.said).toContain('pip.oops.gate.1');
    expect(s.phase).toBe('play');

    // solve gate 1 → the lock opens
    expect(await roll(page, step0?.portalId as number)).toBe(true);
    await page.waitForSelector('[data-testid="learning-gate"]', { timeout: 15_000 });
    expect(await text(page, 'lgate-prompt')).toBe('Which island has more gems?');
    expect(await text(page, 'lgate-skip')).toBe('Later');
    await page.click('[data-testid="lgate-choice-b"]');
    await expect.poll(async () => (await state(page)).learning.gate?.solved, { timeout: 5_000 }).toBe(true);
    s = await state(page);
    for (const id of step0?.lockIds ?? [])
      expect(s.learning.binding?.locks.find((l) => l.id === id)?.open).toBe(true);
    expect(s.learning.said).toContain('pip.unlocked.bridge');
    await page.click('[data-testid="lgate-rollon"]');
    await page.waitForSelector('[data-testid="learning-gate"]', { state: 'detached' });
    await page.waitForTimeout(1500); // the bars drop (the opening animation)
    await shot(page, '2b-lock-opened');

    // cross: the same bridge now takes the ball to island 1
    expect(await game<boolean>(page, 'debugRollIntoLock', lockId, 4)).toBe(true);
    await expect.poll(async () => (await state(page)).island, { timeout: 15_000 }).toBe(1);
    const guards = (await state(page)).learning.guards;
    expect(guards).toBe(1);
    const step1 = (await state(page)).learning.binding?.steps[1];
    expect(step1?.island).toBe(1);
    expect(await roll(page, step1?.portalId as number)).toBe(true);
    await page.waitForSelector('[data-testid="learning-gate"]', { timeout: 15_000 });
    expect((await state(page)).learning.guards).toBe(guards);
    // r2 invites letter keys: badges on the choices, the invite voiced after the callout
    const gate = (await state(page)).learning.gate;
    expect(gate).toMatchObject({ round: 'r2', badges: true });
    expect(await page.locator('svg.wwm-scene.show-keys').count()).toBe(1);
    expect(await text(page, 'lgate-invite')).toBe('Press the letter');
    await expect
      .poll(() => page.locator('[data-choice-mark].is-callout').count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await shot(page, '5-gate-card-badges-callout');
    await expect
      .poll(async () => (await state(page)).learning.said, { timeout: 10_000 })
      .toContain('pip.input.letter-key');
    await page.keyboard.press('KeyA');
    await expect.poll(async () => (await state(page)).learning.gate?.solved, { timeout: 5_000 }).toBe(true);
    await ctx.close();
    expect(problems).toEqual([]);
  }, 180_000);

  test('the loader shows the level; Grown-ups switches to missions; a mission post starts its mission', async () => {
    const { page, ctx } = await open('/');
    await page.waitForSelector('[data-testid="start"]:not([disabled])', { timeout: 60_000 });
    await page.click('[data-testid="start"]');
    await waitPhase(page, 'pairing');
    await page.click('[data-testid="play-keyboard"]');
    await waitPhase(page, 'select');
    await page.click('[data-testid="learning-builtin"]');
    await page.waitForSelector('[data-testid="learning-level"]');
    expect(await text(page, 'learning-level')).toContain('Gated');
    expect(await text(page, 'learning-level')).toContain('Bridges and lifts stay locked');
    await page.locator('[data-testid="learning-panel"]').scrollIntoViewIfNeeded();
    await shot(page, '1-loader-level');

    // a quick tap does nothing; a 2 s hold opens the level picker
    await page.click('[data-testid="learning-grownups"]');
    expect(await page.locator('[data-testid="learning-levels"]').count()).toBe(0);
    const box = await page.locator('[data-testid="learning-grownups"]').boundingBox();
    if (!box) throw new Error('no grown-ups control');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(2300);
    await page.mouse.up();
    await page.waitForSelector('[data-testid="learning-levels"]');
    await page.check('[data-testid="learning-level-mission"]');
    expect(await text(page, 'learning-level')).toContain('Missions');
    expect(await text(page, 'learning-level')).toContain('collect 4 gems');
    await shot(page, '1b-loader-levels');
    await page.click('[data-testid="learning-levels-close"]');

    await page.click('[data-testid="site-practice"]');
    await waitPhase(page, 'play');
    let s = await state(page);
    expect(s.learning.level).toBe('mission');
    const collect = s.learning.binding?.steps.find((x) => x.kind === 'mission');
    expect(collect).toBeTruthy();
    // the collect post stands behind r1's bridge: solve gate 1 first
    const first = s.learning.binding?.steps[0];
    expect(await roll(page, first?.portalId as number)).toBe(true);
    await page.waitForSelector('[data-testid="learning-gate"]', { timeout: 15_000 });
    await page.click('[data-testid="lgate-choice-b"]');
    await page.click('[data-testid="lgate-rollon"]');
    await page.waitForSelector('[data-testid="learning-gate"]', { state: 'detached' });

    // near the post, then into it: the mission starts without stopping the ball
    expect(await game<boolean>(page, 'debugRollIntoPortal', collect?.portalId as number, 3)).toBe(true);
    await page.waitForTimeout(250);
    await shot(page, '3-mission-post');
    await page.waitForSelector('[data-testid="learning-mission"]', { timeout: 15_000 });
    expect(await text(page, 'learning-mission')).toContain('Bring Pip 4 gems');
    s = await state(page);
    expect(s.phase).toBe('play');
    expect(s.learning.said).toEqual(expect.arrayContaining(['pip.mission.post', 'pip.mission.collect.4']));
    expect(s.learning.missions).toContainEqual(
      expect.objectContaining({ index: 2, status: 'active', count: 4 }),
    );
    // roll away from the post (the mission goes on) for a clear view of the HUD
    expect(await roll(page, first?.portalId as number)).toBe(true);
    await page.waitForTimeout(1200);
    expect((await state(page)).learning.missions).toContainEqual(
      expect.objectContaining({ status: 'active' }),
    );
    await shot(page, '4-mission-hud');

    // the pause menu offers the grown-up override (this level allows it)
    await page.keyboard.press('Escape');
    await waitPhase(page, 'paused');
    await page.waitForSelector('[data-testid="learning-override"]');
    await page.waitForTimeout(900);
    await shot(page, '6-pause-override');
    await ctx.close();
    expect(problems).toEqual([]);
  }, 180_000);
});
