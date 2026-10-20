/**
 * Portal windows end-to-end (N; plans/portal-windows-execution.md M1): the real game with
 * `VITE_PORTAL_WINDOWS_ENABLED=true` (its own Vite server, so the flag-off coverage in portal.e2e.test.ts stays as
 * it is). Offline (`?offline=1`), nothing reaches /api.
 *  1. `portal-hub`: the three portals to bundled fixtures show their pictures; the w3.org one shows the postcard.
 *  2. Hacker News: every link leads to a real site, so every portal shows the postcard.
 *  Both stay inside the draw-call budget with no page errors.
 *
 * Needs Playwright Chromium; skipped locally without it, required in CI.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS, EXPECTED_BACKEND, SOFTWARE_GL_NOISE } from './browser-env.ts';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));

type Dbg = {
  phase: string;
  portalPreviews: Record<string, string>;
  engine: { backend: string; drawCalls: number } | null;
};

describe.skipIf(!HAS_CHROMIUM)('portal windows e2e (Chromium, offline, flag on)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base = '';
  const problems: string[] = [];
  const previousFlag = process.env.VITE_PORTAL_WINDOWS_ENABLED;

  beforeAll(async () => {
    // Vite reads VITE_* from process.env when the server is created.
    process.env.VITE_PORTAL_WINDOWS_ENABLED = 'true';
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

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (previousFlag === undefined) delete process.env.VITE_PORTAL_WINDOWS_ENABLED;
    else process.env.VITE_PORTAL_WINDOWS_ENABLED = previousFlag;
  });

  async function play(stage: string) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await browserEnv(ctx);
    await ctx.addInitScript((ci) => {
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = {
        ...ci,
        skipIntro: true,
        noAutoPause: true,
      };
    }, CI_HOOKS);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !SOFTWARE_GL_NOISE.test(m.text())) problems.push(`[console] ${m.text()}`);
    });
    await page.goto(`${base}/play/${stage}?offline=1`);
    await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 90_000 });
    return { page, ctx };
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
});
