/**
 * Phase 08 end-to-end: the real game in Chromium (Vite dev server) against the real Worker + Room DO + local
 * D1/R2 in workerd (wrangler `createTestHarness`).
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
 * CI hardening (phase-12 build log): the engine runs on WebGPU locally and on WebGL2 in CI (browser-env.ts);
 * a local-only test loses the WebGPU device mid-run and checks the engine carries on quietly on WebGL2.
 *
 * Phase 08b (leaderboards, Phase 10 components, ghosts). `handmade-simple` is also seeded into the Worker's R2/D1
 * as a service-built stage, so `/play/<its stageId>` is a stage the scores API knows:
 *  5. Replay run on the service stage → the stage board on the result → the recorded replay equals the stream
 *     the sim consumed → name → ranked on the server's run board and stage board, replay verified.
 *  6. "Race the #1 run" on a challenge link → the #1 replay (from 5) is a ghost ball that moves; toggles off.
 *  7. Challenge link with the replay → the result answers the friend's score; the #1 shows on the stage board.
 *  8. Offline at the ranking → the score is saved and ranked on this device; nothing reaches the server.
 *
 * `WWM_SHOTS=1` also writes the 08b screenshots (docs/build-log/assets/phase-08/b-*.jpg).
 *
 * Needs Playwright Chromium; skipped locally without it, required in CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { replay } from '@wwm/physics';
import { computeRunId, type InputSample, type StageData } from '@wwm/schema';
import { type Browser, type BrowserContext, chromium, devices, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { finishStage, SMALL_CREDIT_DELAY_SEC } from '../src/game/rules.ts';
import {
  browserEnv,
  CHROMIUM_ARGS,
  CI_HOOKS,
  EXPECTED_BACKEND,
  IN_CI,
  SOFTWARE_GL_NOISE,
} from './browser-env.ts';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORKER_CONFIG = fileURLToPath(new URL('../../worker/wrangler.jsonc', import.meta.url));
const HANDMADE = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;
const HANDMADE_PNG = readFileSync(new URL('../../../fixtures/stages/handmade-simple.png', import.meta.url));
/** The practice stage seeded as a service stage: its id is a `/play/:stageId` link the scores API knows. */
const SERVICE_ID = HANDMADE.stageId;
const REPLAY = JSON.parse(
  readFileSync(new URL('../../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
) as InputSample[];

type Harness = ReturnType<typeof import('wrangler').createTestHarness>;

/** 08b screenshots: `WWM_SHOTS=1` writes them to docs/build-log/assets/phase-08/ (reviewed by hand). */
const SHOTS = process.env.WWM_SHOTS
  ? fileURLToPath(new URL('../../../docs/build-log/assets/phase-08/', import.meta.url))
  : null;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}${name}.jpg`, type: 'jpeg', quality: 85 });
}

/** Known dev-only noise: React StrictMode mounts the phone controller twice, closing the first socket. */
const DEV_NOISE = /WebSocket is closed before the connection is established/;

describe.skipIf(!HAS_CHROMIUM)('game e2e (Chromium + workerd)', () => {
  let harness: Harness;
  let api = '';
  let server: ViteDevServer;
  let browser: Browser;
  let base = '';
  const problems: string[] = [];

  function watch(page: Page, who: string) {
    page.on('console', (m) => {
      const t = m.text();
      if (
        (m.type() === 'error' || m.type() === 'warning') &&
        !DEV_NOISE.test(t) &&
        !SOFTWARE_GL_NOISE.test(t)
      )
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

  const engineStats = (p: Page) => p.evaluate(() => window.__wwmGame?.debugState().engine ?? null);

  async function desk(hooks: Record<string, unknown>, extra?: (ctx: BrowserContext) => Promise<void>) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await browserEnv(ctx);
    await ctx.addInitScript(
      (h) => {
        localStorage.setItem('wwm.howtoSeen', '1');
        localStorage.setItem('wwm.tutorialDone', '1');
        (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = h;
      },
      { ...CI_HOOKS, ...hooks },
    );
    await extra?.(ctx);
    const page = await ctx.newPage();
    watch(page, 'host');
    return page;
  }

  beforeAll(async () => {
    // wrangler's test harness (as the worker's own integration tests): real Worker + Room DO + local D1/R2, and
    // access to the bindings, so the practice stage can be seeded into R2 like a stage the service built (08b).
    const { createTestHarness } = await import('wrangler');
    harness = createTestHarness();
    await harness.update({ workers: [{ configPath: WORKER_CONFIG }] });
    const { url } = await harness.listen();
    const w = harness.getWorker<{
      STAGES: { put(key: string, value: unknown, opts?: unknown): Promise<unknown> };
      DB: { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } };
    }>();
    await w.applyD1Migrations('DB' as never);
    const env = await w.getEnv();
    // As the build pipeline stores it (apps/worker/src/store.ts): stage JSON + texture in R2, run + stage rows.
    const cap = HANDMADE.source.captureId;
    const textureKey = `textures/${cap}/0.webp`;
    const stage = { ...HANDMADE, texture: { ...HANDMADE.texture, path: `${SERVICE_ID}/texture` } };
    await env.STAGES.put(`stages/${SERVICE_ID}.json`, JSON.stringify(stage));
    await env.STAGES.put(textureKey, new Uint8Array(HANDMADE_PNG), {
      httpMetadata: { contentType: 'image/png' },
    });
    const runId = await computeRunId(cap, HANDMADE.seed, HANDMADE.builderVersion, HANDMADE.difficulty);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO runs (run_id, url, title, capture_id, slice_count, difficulty, seed, builder_version, status, created_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, 'complete', ?8)`,
    )
      .bind(
        runId,
        'https://practice.example/',
        'Handmade practice',
        cap,
        HANDMADE.difficulty,
        HANDMADE.seed,
        HANDMADE.builderVersion,
        now,
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO stages (stage_id, run_id, slice_index, url, title, capture_id, builder_version, texture_key,
         islands, bridges, elevators, items, created_at)
       VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
      .bind(
        SERVICE_ID,
        runId,
        'https://practice.example/',
        'Handmade practice',
        cap,
        HANDMADE.builderVersion,
        textureKey,
        HANDMADE.islands.length,
        HANDMADE.bridges.length,
        HANDMADE.elevators.length,
        HANDMADE.items.length,
        now,
      )
      .run();
    api = url.toString().replace(/\/$/, '');
    process.env.WWM_API_URL = api;
    server = await createServer({
      root: WEB_ROOT,
      configFile: `${WEB_ROOT}vite.config.ts`,
      logLevel: 'error',
      server: { port: 5290, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    base = (server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5290/').replace(/\/$/, '');
    browser = await chromium.launch({ args: CHROMIUM_ARGS });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await harness?.close();
  });

  /** Expected score of the fixture replay, from the same replay in Node and the rules module. */
  async function expectation() {
    const node = await replay(HANDMADE, REPLAY);
    const goalTick = node.goalTick;
    let small = 0;
    let large = 0;
    for (const { event } of node.events) {
      if (event.type === 'item') event.kind === 'small' ? small++ : large++;
    }
    const timeInt = Math.round(HANDMADE.timeLimitSec - goalTick / 120);
    const expected = finishStage(
      { total: small + 100 * large, spares: 3 },
      { timeInt, small, large, cleared: true },
    );
    return { goalTick, small, large, timeInt, expected };
  }

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
    // WebGPU on a real GPU (locally); WebGL2 in CI, where the pages have no WebGPU (browser-env.ts).
    expect((await engineStats(page))?.backend).toBe(EXPECTED_BACKEND);
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

    // Finish → ranking (Phase 10 NameEntry). The practice stage is built in the browser: device boards.
    await page.getByTestId('res-finish').click();
    await waitPhase(page, 'ranking');
    await page.getByTestId('name-input').fill('e2e_bot');
    await page.getByTestId('name-submit').click();
    await expect.poll(() => page.getByTestId('rank-value').textContent()).toBe('1st');
    expect(await page.getByTestId('rank-value').getAttribute('data-source')).toBe('device');
    expect(problems).toEqual([]);
    await page.context().close();
  }, 240_000);

  test('08b: replay run on a service stage → stage board → name → server run + stage boards, replay verified', async () => {
    const { goalTick, small, large, expected } = await expectation();
    const page = await desk({
      replay: REPLAY,
      lockstep: true,
      timeScale: 3,
      noAutoPause: true,
      skipIntro: true,
    });
    await page.goto(`${base}/play/${SERVICE_ID}`);
    await waitPhase(page, 'result', 150_000);
    const total = page.locator('[data-testid=res-total][data-final]:not([data-final=""])');
    await total.waitFor({ timeout: 20_000 });
    expect(Number(await total.getAttribute('data-final'))).toBe(expected.score.total);

    // The stage board sits next to the tally; the service stage has no scores yet.
    await page.getByTestId('res-board').waitFor();
    await expect
      .poll(() => page.getByTestId('result').textContent())
      .toContain('No scores on this stage yet');

    // 08b: the replay the game recorded is exactly the stream the lockstep sim consumed.
    const recorded = await page.evaluate(() => window.__wwmGame?.debugReplays() ?? []);
    expect(recorded).toHaveLength(1);
    const rec = recorded[0]?.replay;
    expect(rec?.inputs.length).toBe(goalTick);
    expect(rec?.inputs).toEqual(REPLAY.slice(0, goalTick));
    const again = await replay(HANDMADE, rec?.inputs ?? [], { stopAtGoal: true });
    expect(again.goalTick).toBe(goalTick);
    expect(again.events.filter((e) => e.event.type === 'item')).toHaveLength(small + large);

    // Finish → ranking with the name entry (Phase 10 NameEntry), submit → ranked on the server's boards.
    await page.getByTestId('res-finish').click();
    await waitPhase(page, 'ranking');
    await page.getByTestId('name-input').fill('e2e_bot');
    await page.getByTestId('name-submit').click();
    await expect.poll(() => page.getByTestId('rank-value').textContent()).toBe('1st');
    expect(await page.getByTestId('rank-value').getAttribute('data-source')).toBe('server');
    await page.getByTestId('stage-verified').waitFor(); // the Worker re-simulated the replay and accepted it
    await expect.poll(() => page.getByTestId('rank-board').textContent()).toContain('e2e_bot');
    await page.getByTestId('tab-stage-0').click();
    await expect.poll(() => page.getByTestId('rank-board').textContent()).toContain('e2e_bot');
    expect(await page.getByTestId('rank-board').textContent()).toContain(
      expected.stageScore.toLocaleString('en-US'),
    );
    const stageBoard = (await (await fetch(`${api}/api/scores/stage/${HANDMADE.stageId}`)).json()) as {
      entries: { name: string; score: number; timeMs: number }[];
    };
    expect(stageBoard.entries[0]).toMatchObject({ name: 'e2e_bot', score: expected.stageScore });
    expect(stageBoard.entries[0]?.timeMs).toBe(Math.round((goalTick * 1000) / 120));
    const runBoard = (await (await fetch(`${api}/api/scores/run`)).json()) as {
      entries: { name: string; score: number }[];
    };
    expect(runBoard.entries[0]).toMatchObject({ name: 'e2e_bot', score: expected.stageScore });
    const ghost = (await (await fetch(`${api}/api/scores/stage/${HANDMADE.stageId}/ghost`)).json()) as {
      name: string;
      inputs: unknown[];
    };
    expect(ghost.name).toBe('e2e_bot');
    expect(ghost.inputs).toHaveLength(goalTick);
    await shot(page, 'b-05-ranking-submitted-stage-tab');
    await page.getByTestId('tab-run').click();
    await expect.poll(() => page.getByTestId('rank-board').textContent()).toContain('e2e_bot');
    await shot(page, 'b-04-ranking-submitted');
    expect(problems).toEqual([]);
    await page.context().close();
  }, 240_000);

  test('ghost race: "Race the #1 run" on a challenge link renders the #1 replay as a ghost ball', async () => {
    // Runs after the first test, whose verified replay is now the stage's #1. The player stays idle, so the
    // ghost rolls away from the start.
    const page = await desk({ noAutoPause: true, timeScale: 1 });
    await page.goto(`${base}/play/${SERVICE_ID}?beat=1500&by=mika`);
    await waitPhase(page, 'intro', 60_000);
    await page.getByTestId('challenge-banner').waitFor();
    expect(await page.getByTestId('challenge-banner').textContent()).toContain('mika');
    const toggle = page.getByTestId('ghost-toggle');
    await toggle.waitFor({ timeout: 30_000 }); // the ghost is fetched and its track re-simulated
    expect(await toggle.textContent()).toContain('e2e_bot');
    expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    await toggle.click();
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');
    await page.waitForTimeout(1200);
    await shot(page, 'b-01-intro-ghost-challenge');
    await page.getByTestId('intro-skip').click(); // skip the intro (Space would toggle the focused ghost button)
    await waitPhase(page, 'countdown', 30_000);
    await shot(page, 'b-02-countdown-ghost');
    await waitPhase(page, 'play', 30_000);
    await page.getByTestId('ghost-racing').waitFor();
    await page.waitForTimeout(700);
    await shot(page, 'b-03-play-ghost');
    const ghostPos = () =>
      page.evaluate(() => {
        const m = window.__wwmGame?.engine?.debug().scene.getObjectByName('wwm-ghost');
        return m ? { visible: m.visible, p: m.position.toArray() } : null;
      });
    const a = await ghostPos();
    await page.waitForTimeout(2500);
    const b = await ghostPos();
    expect(a?.visible).toBe(true);
    const moved = Math.hypot((b?.p[0] ?? 0) - (a?.p[0] ?? 0), (b?.p[2] ?? 0) - (a?.p[2] ?? 0));
    console.log(`[e2e] ghost moved ${moved.toFixed(2)} m in 2.5 s`);
    expect(moved).toBeGreaterThan(0.5);
    // Toggling off removes it.
    await page.keyboard.press('KeyM');
    await waitPhase(page, 'paused');
    await page.waitForTimeout(1200);
    await shot(page, 'b-03b-map-ghost');
    await page.getByTestId('ghost-toggle').click();
    await expect.poll(ghostPos).toBeNull();
    expect(problems).toEqual([]);
    await page.context().close();
  }, 180_000);

  test("challenge link: the result answers the friend's score; the stage board shows the #1", async () => {
    const page = await desk({
      replay: REPLAY,
      lockstep: true,
      timeScale: 3,
      noAutoPause: true,
      skipIntro: true,
    });
    await page.goto(`${base}/play/${SERVICE_ID}?beat=1500&by=mika`);
    await waitPhase(page, 'goal', 120_000);
    await waitPhase(page, 'result', 30_000);
    const verdict = page.getByTestId('challenge-verdict');
    await verdict.waitFor({ timeout: 20_000 });
    expect(await verdict.textContent()).toBe('17 points short of mika’s 1,500.'); // 1484 vs 1500
    await expect.poll(() => page.getByTestId('res-board').textContent()).toContain('e2e_bot');
    await page.waitForTimeout(400);
    await shot(page, 'b-06-result-board-challenge');
    await page.setViewportSize({ width: 820, height: 1100 });
    await page.waitForTimeout(300);
    await shot(page, 'b-09-result-narrow');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('res-finish').click();
    await waitPhase(page, 'ranking');
    await page.getByTestId('name-input').waitFor();
    await expect.poll(() => page.getByTestId('rank-value').textContent()).toBe('2nd'); // ties rank behind e2e_bot
    await page.waitForTimeout(700);
    await shot(page, 'b-07-ranking-entry');
    expect(problems).toEqual([]);
    await page.context().close();
  }, 180_000);

  test('offline fallback: connection lost → the score is ranked and kept on this device', async () => {
    const page = await desk({
      replay: REPLAY,
      lockstep: true,
      timeScale: 3,
      noAutoPause: true,
      skipIntro: true,
    });
    await page.goto(`${base}/play/${SERVICE_ID}`);
    await waitPhase(page, 'result', 150_000);
    await expect.poll(() => page.getByTestId('res-board').textContent()).toContain('e2e_bot'); // online: server board
    await page.context().setOffline(true); // the connection drops before the name is entered
    await page.getByTestId('res-finish').click();
    await waitPhase(page, 'ranking');
    await page.getByTestId('name-input').fill('offline_ana');
    await page.getByTestId('name-submit').click();
    await expect.poll(() => page.getByTestId('rank-value').textContent()).toBe('1st');
    expect(await page.getByTestId('rank-value').getAttribute('data-source')).toBe('device');
    await expect.poll(() => page.getByTestId('rank-board').textContent()).toContain('offline_ana');
    expect(await page.getByTestId('ranking').textContent()).toContain('can’t be reached');
    await shot(page, 'b-08-ranking-offline');
    // Nothing reached the server.
    const board = (await (await fetch(`${api}/api/scores/run`)).json()) as { entries: { name: string }[] };
    expect(board.entries.map((e) => e.name)).not.toContain('offline_ana');
    // Vite's dev client notices the lost connection (dev server only); that is this test's subject.
    for (let i = problems.length - 1; i >= 0; i--)
      if (/Failed to load resource|ERR_INTERNET_DISCONNECTED|\[vite\]/.test(problems[i] ?? ''))
        problems.splice(i, 1);
    expect(problems).toEqual([]);
    await page.context().close();
  }, 180_000);

  // Local only: CI has no WebGPU to lose (browser-env.ts). The engine must switch to WebGL2 by itself, log one
  // warning and no error, and the run must go on from where it was.
  test.skipIf(IN_CI)(
    'WebGPU device lost mid-run → WebGL2, quietly, and the run goes on',
    async () => {
      const page = await desk({ replay: REPLAY, lockstep: true, noAutoPause: true, skipIntro: true });
      await page.goto(`${base}/`);
      await page.getByTestId('start').click();
      await waitPhase(page, 'pairing');
      await page.getByTestId('play-keyboard').click();
      await waitPhase(page, 'select');
      await page.getByTestId('site-practice').click();
      await waitPhase(page, 'play', 60_000);
      expect((await engineStats(page))?.backend).toBe('webgpu');
      const tick0 = (await state(page))?.tick ?? 0;
      const canvases0 = await page.locator('canvas.wwm-canvas').count();
      // What a GPU reset looks like to three.js: the device is gone and `device.lost` resolves with a reason
      // other than "destroyed" (three ignores that one, so it is delivered here by hand).
      await page.evaluate(() => {
        const r = window.__wwmGame?.engine?.debug().renderer as unknown as {
          backend: { device: GPUDevice };
          onDeviceLost(info: { api: string; message: string; reason: string | null }): void;
        };
        r.backend.device.destroy();
        r.onDeviceLost({ api: 'WebGPU', message: 'e2e: simulated GPU reset', reason: 'unknown' });
      });
      await expect.poll(async () => (await engineStats(page))?.backend, { timeout: 20_000 }).toBe('webgl2');
      // the new renderer draws frames, and the run carries on
      const renderCalls = () =>
        page.evaluate(
          () =>
            (window.__wwmGame?.engine?.debug().renderer.info as { calls?: number } | undefined)?.calls ?? 0,
        );
      const calls0 = await renderCalls();
      await expect.poll(renderCalls, { timeout: 20_000 }).toBeGreaterThan(calls0 + 30);
      await expect
        .poll(async () => (await state(page))?.tick ?? 0, { timeout: 20_000 })
        .toBeGreaterThan(tick0 + 60);
      expect((await state(page))?.phase).toBe('play');
      // one canvas: the WebGL2 one took the WebGPU one's place
      expect(await page.locator('canvas.wwm-canvas').count()).toBe(canvases0);
      const warned = problems.filter((m) => m.includes('[@wwm/engine] WebGPU device lost'));
      expect(warned).toHaveLength(1);
      expect(warned[0]).toMatch(/^host \[warning\]/);
      problems.splice(problems.indexOf(warned[0] as string), 1);
      expect(problems).toEqual([]);
      await page.context().close();
    },
    180_000,
  );

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
      // v0.2.7: the QR code carries the pairing secret in the fragment.
      const qr = (await host.getByTestId('pair-qr').getAttribute('data-text')) ?? '';
      expect(qr).toMatch(new RegExp(`^${base}/c/${code}#p=[A-Za-z0-9_-]{22}$`));

      const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
      await ctx.addInitScript(() => {
        const w = window as unknown as Record<string, unknown>;
        const DOE = (w.DeviceOrientationEvent ?? function DeviceOrientationEvent() {}) as Record<
          string,
          unknown
        >;
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
      await phone.goto(qr);
      await host.getByText('Connected!').waitFor({ timeout: 10_000 });
      // The token is kept in sessionStorage and removed from the address bar.
      expect(phone.url()).toBe(`${base}/c/${code}`);
      await waitPhase(host, 'calibrate', 10_000);

      // Someone else types the 6-digit code: refused (4401) while this phone is connected.
      const intruderCtx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
      const intruder = await intruderCtx.newPage();
      await intruder.goto(`${base}/c/${code}`);
      await intruder.getByTestId('unauthorized').waitFor({ timeout: 10_000 });
      await intruderCtx.close();
      expect(await host.evaluate(() => window.__wwmGame?.getView().room.controllerConnected)).toBe(true);
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
      await expect
        .poll(async () => (await phone.textContent('body')) ?? '', { timeout: 5000 })
        .toMatch(/TIME/);
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
      await expect
        .poll(async () => (await state(host))?.timer.remains ?? 0, { timeout: 5000 })
        .toBeLessThan((frozen?.timer.remains ?? 0) - 0.3); // and it runs again
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
