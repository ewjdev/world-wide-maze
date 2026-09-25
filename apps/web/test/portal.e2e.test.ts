/**
 * Phase 13 end-to-end: a web journey in the real game (Vite dev server + Chromium), with `/api` mocked.
 *
 * Stage A is the practice stage served as a capture-service stage with one link portal on its start island.
 *  1. The ball rolls into the portal with the real physics → "Travel to … (…)?" with the sim paused.
 *     MENU (M) keeps playing; rolling in again reopens it; Travel builds the link through `POST /api/stages` +
 *     SSE → the second site's maze loads; score and spare balls carry over; the trail and the ranking share link
 *     list both sites.
 *  2. With the capture service unreachable, the portal says "Needs the online service" and travel is refused.
 *  3. The `/j/<trail>` share page renders the journey without loading the game.
 *
 * Needs Playwright Chromium; skipped locally without it, required in CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeRunId, type StageData, validateStage } from '@wwm/schema';
import { type Browser, chromium, type Page, type Route } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS } from './browser-env.ts';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));
const HANDMADE = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;
const PNG = readFileSync(new URL('../../../fixtures/stages/handmade-simple.png', import.meta.url));

const A = 'a1'.repeat(32);
const B = 'b2'.repeat(32);
const [sx, sy] = HANDMADE.start.pos;
const STAGE_A: StageData = {
  ...HANDMADE,
  stageId: A,
  source: { ...HANDMADE.source, url: 'https://first.example/', title: 'First site' },
  texture: { ...HANDMADE.texture, path: `${A}/texture` },
  portals: [
    {
      id: 0,
      islandId: HANDMADE.start.islandId,
      pos: [sx + 60, sy],
      href: 'https://second.example/page',
      label: 'The second site',
      sourceElementId: 0,
    },
  ],
};
const STAGE_B: StageData = {
  ...HANDMADE,
  stageId: B,
  source: { ...HANDMADE.source, url: 'https://second.example/page', title: 'Second site', captureId: 'c2' },
  texture: { ...HANDMADE.texture, path: `${B}/texture` },
};

describe.skipIf(!HAS_CHROMIUM)('link portals e2e (Chromium, mocked /api)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base = '';
  let runA = '';
  const problems: string[] = [];

  beforeAll(async () => {
    expect(validateStage(STAGE_A).errors).toEqual([]);
    runA = await computeRunId(
      STAGE_A.source.captureId,
      STAGE_A.seed,
      STAGE_A.builderVersion,
      STAGE_A.difficulty,
    );
    process.env.WWM_API_URL = 'http://127.0.0.1:9'; // nothing listens: every /api call is routed below
    server = await createServer({
      root: WEB_ROOT,
      configFile: `${WEB_ROOT}vite.config.ts`,
      logLevel: 'error',
      server: { port: 5293, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    base = (server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5293/').replace(/\/$/, '');
    browser = await chromium.launch({ args: CHROMIUM_ARGS });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  /** The capture service, mocked. `online: false` = unreachable (health fails). */
  async function api(page: Page, online: boolean) {
    const posts: string[] = [];
    const json = (route: Route, body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      if (p === '/api/health') return online ? json(route, { ok: true, contract: '0.3.0' }) : route.abort();
      if (p === `/api/stages/${A}`) return json(route, STAGE_A);
      if (p === `/api/stages/${B}`) return json(route, STAGE_B);
      if (p.endsWith('/texture')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (p === `/api/runs/${runA}`)
        return json(route, {
          runId: runA,
          url: 'https://first.example/',
          title: 'First site',
          stageIds: [A],
        });
      if (p === '/api/runs/run-b')
        return json(route, {
          runId: 'run-b',
          url: 'https://second.example/page',
          title: 'Second site',
          stageIds: [B],
        });
      if (p === '/api/stages' && route.request().method() === 'POST') {
        posts.push((route.request().postDataJSON() as { url: string }).url);
        return json(route, { jobId: 'job-1' }, 202);
      }
      if (p === '/api/jobs/job-1')
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body:
            'event: progress\ndata: {"step":"capturing","pct":30}\n\n' +
            'event: done\ndata: {"runId":"run-b","stageIds":["' +
            B +
            '"]}\n\n',
        });
      return json(route, { code: 'NOT_FOUND', message: p }, 404);
    });
    return posts;
  }

  async function open(online: boolean) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await browserEnv(ctx);
    await ctx.addInitScript((ci) => {
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = {
        ...ci,
        skipIntro: true,
        noAutoPause: true,
        timeScale: 2,
      };
    }, CI_HOOKS);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    const posts = await api(page, online);
    await page.goto(`${base}/play/${A}`);
    await waitPhase(page, 'play');
    return { page, posts, ctx };
  }

  const waitPhase = (p: Page, want: string, timeout = 60_000) =>
    p.waitForFunction((w) => document.body.dataset.phase === w, want, { timeout });
  type Dbg = {
    phase: string;
    total: number;
    spares: number;
    stageId: string | null;
    api: string;
    portal: { label: string; host: string; offline: boolean } | null;
    journey: { host: string; via: string; ref: string | null }[];
    tick: number;
  };
  const state = (p: Page) =>
    p.evaluate(() => {
      const d = (window as unknown as { __wwmGame: { debugState(): unknown } }).__wwmGame.debugState();
      return { ...(d as object), engine: null } as unknown as Dbg;
    });
  const roll = (p: Page) =>
    p.evaluate(() =>
      (
        window as unknown as { __wwmGame: { debugRollIntoPortal(id: number, m: number): boolean } }
      ).__wwmGame.debugRollIntoPortal(0, 4),
    );

  test('roll into a portal, confirm, and the linked site’s maze loads with the score carried over', async () => {
    const { page, posts, ctx } = await open(true);
    await page.waitForFunction(
      () =>
        (window as unknown as { __wwmGame: { debugState(): { api: string } } }).__wwmGame.debugState().api !==
        'unknown',
    );
    expect(await roll(page)).toBe(true);
    await page.waitForSelector('[data-testid="portal-prompt"]', { timeout: 15_000 });
    const s1 = await state(page);
    expect(s1.phase).toBe('play');
    expect(s1.portal).toMatchObject({ label: 'The second site', host: 'second.example', offline: false });
    await expect
      .poll(async () => (await page.textContent('#portal-h')) ?? '', { timeout: 15_000 })
      .toContain('Travel to The second site?');
    // paused: the sim doesn't step while the prompt shows
    const t0 = (await state(page)).tick;
    await page.waitForTimeout(400);
    expect((await state(page)).tick).toBe(t0);

    // MENU keeps playing; the portal re-arms after the ball leaves; rolling in again reopens the prompt
    await page.keyboard.press('KeyM');
    await page.waitForSelector('[data-testid="portal-prompt"]', { state: 'detached' });
    expect((await state(page)).phase).toBe('play');
    expect(await roll(page)).toBe(true);
    await page.waitForSelector('[data-testid="portal-prompt"]', { timeout: 15_000 });

    const before = await state(page);
    await page.click('[data-testid="portal-travel"]');
    await page.waitForSelector('[data-testid="travel-iris"]');
    await waitPhase(page, 'building', 15_000);
    expect(await page.textContent('[data-testid="building"]')).toContain('Rolling to second.example');
    await waitPhase(page, 'play', 60_000);
    const after = await state(page);
    expect(posts).toEqual(['https://second.example/page']);
    expect(after.stageId).toBe(B);
    expect(after.total).toBe(before.total);
    expect(after.spares).toBe(before.spares);
    expect(after.journey.map((s) => [s.host, s.via])).toEqual([
      ['first.example', 'start'],
      ['second.example', 'portal'],
    ]);
    expect(after.journey[1]?.ref).toBe(B);
    await page.waitForSelector('[data-testid="journey-hud"]');

    // finish the second stop → the ranking offers the journey's share link, which renders the card
    const goal = await page.evaluate(() =>
      (
        window as unknown as { __wwmGame: { debugRollIntoGoal(m: number): boolean } }
      ).__wwmGame.debugRollIntoGoal(4),
    );
    expect(goal).toBe(true);
    await waitPhase(page, 'result', 60_000);
    await page.waitForSelector('[data-testid="journey-section"]');
    await page.click('[data-testid="res-finish"]');
    await waitPhase(page, 'ranking');
    const href = await page.getAttribute('[data-testid="journey-link"]', 'href');
    expect(href).toMatch(/\/j\/[A-Za-z0-9_-]+$/);
    const card = await ctx.newPage();
    await card.goto(href as string);
    await card.waitForSelector('[data-testid="journey-page"]');
    const text = (await card.textContent('main')) ?? '';
    expect(text).toContain('first.example');
    expect(text).toContain('second.example');
    expect(await card.getAttribute('[data-testid="journey-start"]', 'href')).toBe(`/play/${A}`);
    // the share page stays light: no renderer
    const three = await card.evaluate(() =>
      performance.getEntriesByType('resource').some((r) => /three|rapier|engine/.test(r.name)),
    );
    expect(three).toBe(false);
    await ctx.close();
    expect(problems).toEqual([]);
  }, 180_000);

  test('offline: the portal needs the online service and travel is refused', async () => {
    const { page, posts, ctx } = await open(false);
    await page.waitForFunction(
      () =>
        (window as unknown as { __wwmGame: { debugState(): { api: string } } }).__wwmGame.debugState().api ===
        'offline',
    );
    expect(await roll(page)).toBe(true);
    await page.waitForSelector('[data-testid="portal-offline"]', { timeout: 15_000 });
    expect(await page.textContent('#portal-h')).toContain('Needs the online service');
    await page.keyboard.press('Enter'); // on the offline prompt, Enter = keep playing
    await page.waitForSelector('[data-testid="portal-offline"]', { state: 'detached' });
    expect((await state(page)).phase).toBe('play');
    expect(posts).toEqual([]);
    await ctx.close();
  }, 120_000);
});
