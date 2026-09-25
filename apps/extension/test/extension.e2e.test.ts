/**
 * Phase 14 end-to-end, in real Chromium with the unpacked extension loaded (`--load-extension`, new headless
 * via the full `chromium` channel), the game on the Vite dev server, and the real Worker in workerd:
 *
 *  1. Extension: popup (opened for the fixture tab) → service worker → scroll-stitched capture of a local page
 *     → game tab at /play/local → handoff → built in the browser → a playable maze (the ball rolls).
 *  2. Share: the receiver uploads the capture to POST /api/stages/upload; the returned link plays from the server.
 *  3. Receiver origin checks: a capture posted by another window (a frame on another origin) is ignored.
 *  4. Bookmarklet: DOM-only capture → sketch mode → playable.
 *  5. The popup on a page it can't capture explains why.
 *
 * `WWM_SHOTS=1` writes screenshots to docs/build-log/assets/phase-14/. Needs Playwright Chromium; skipped
 * locally without it, required in CI.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StageData } from '@wwm/schema';
import { type BrowserContext, chromium, type Page, type Worker } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildExtension } from '../scripts/build.ts';
import { startFixturePage } from './fixture-page.ts';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const WEB_ROOT = fileURLToPath(new URL('../../web/', import.meta.url));
const WORKER_CONFIG = fileURLToPath(new URL('../../worker/wrangler.jsonc', import.meta.url));
/** The game page's automation handles (apps/web: `GameApp.tsx`, `local-capture/LocalPlayPage.tsx`). */
declare global {
  interface Window {
    __wwmGame?: {
      debugState(): { ball: [number, number, number]; stageId: string | null };
      start(): void;
      playKeyboard(): void;
    };
    __wwmLocal?: {
      phase: string;
      via: string | null;
      rejected: number;
      ignored: number;
      sharedUrl: string | null;
    };
  }
}

const SHOTS = process.env.WWM_SHOTS
  ? fileURLToPath(new URL('../../../docs/build-log/assets/phase-14/', import.meta.url))
  : null;
/**
 * Locally the game runs on the real GPU's WebGPU. GitHub-hosted runners have no GPU and Chromium's software
 * WebGPU loses its device at random, so in CI the pages run as a browser without WebGPU and the engine picks
 * WebGL2 (SwiftShader) up front (same as apps/web/test/browser-env.ts; phase-12 build log).
 */
const IN_CI = !!process.env.CI;
const GPU = IN_CI
  ? ['--enable-unsafe-swiftshader']
  : ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'];
/** Dev-only noise also seen by the Phase 08 e2e (StrictMode double mount of sockets). */
const NOISE = /WebSocket is closed before the connection is established|\[vite\]|Download the React DevTools/;
/** CI (no GPU): ANGLE's "GPU stall due to ReadPixels" performance note (apps/web/test/browser-env.ts). */
const SOFTWARE_GL_NOISE = /GL Driver Message \(OpenGL, Performance, [^)]*\): GPU stall due to ReadPixels/;

async function shot(page: Page, name: string, fullPage = false) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}${name}.jpg`, type: 'jpeg', quality: 86, fullPage });
}

describe.skipIf(!HAS_CHROMIUM)('extension e2e (Chromium + unpacked extension + Vite + workerd)', () => {
  let harness: ReturnType<typeof import('wrangler').createTestHarness>;
  let vite: ViteDevServer;
  let game = '';
  let fixture: Awaited<ReturnType<typeof startFixturePage>>;
  let ctx: BrowserContext;
  let sw: Worker;
  let extId = '';
  let extDir = '';
  let userData = '';
  const problems: string[] = [];

  function watch(page: Page, who: string) {
    page.on('console', (m) => {
      const t = m.text();
      if ((m.type() === 'error' || m.type() === 'warning') && !NOISE.test(t) && !SOFTWARE_GL_NOISE.test(t))
        problems.push(`${who} [${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`${who} [pageerror] ${e.message}`));
  }
  const phaseOf = (p: Page) => p.evaluate(() => document.body.dataset.phase ?? '');
  const waitLocal = (p: Page, want: string, timeout = 60_000) =>
    p.waitForFunction((w) => document.body.dataset.local === w, want, { timeout });
  const waitPhase = (p: Page, want: string, timeout = 90_000) =>
    p.waitForFunction((w) => document.body.dataset.phase === w, want, { timeout });
  const ball = (p: Page) =>
    p.evaluate(() => window.__wwmGame?.debugState().ball ?? null) as Promise<[number, number, number] | null>;
  const stageOf = (p: Page) =>
    p.evaluate(() => {
      const g = window.__wwmGame as unknown as { debugState(): { stageId: string | null } } | undefined;
      return g?.debugState().stageId ?? null;
    });

  /**
   * Roll the ball with the keyboard; the maze is playable when it moves. Up for 1.4 s then left for 0.6 s, repeated
   * (at most 5×) until it has moved > 0.5 m: a loaded CI runner renders fewer frames per wall-clock second.
   */
  async function rolls(p: Page): Promise<number> {
    const a = await ball(p);
    if (!a) return 0;
    let moved = 0;
    for (let i = 0; i < 5 && moved <= 0.5; i++) {
      await p.keyboard.down('ArrowUp');
      await p.waitForTimeout(1400);
      await p.keyboard.up('ArrowUp');
      await p.keyboard.down('ArrowLeft');
      await p.waitForTimeout(600);
      await p.keyboard.up('ArrowLeft');
      const b = await ball(p);
      moved = b ? Math.hypot(b[0] - a[0], b[2] - a[2]) : 0;
    }
    return moved;
  }

  async function tabIdOf(url: string): Promise<number> {
    return sw.evaluate(async (u) => {
      const c = (
        globalThis as unknown as {
          chrome: { tabs: { query(q: object): Promise<{ id: number; url: string }[]> } };
        }
      ).chrome;
      const tabs = await c.tabs.query({});
      const t = tabs.find((x) => x.url?.startsWith(u));
      if (!t) throw new Error(`no tab ${u}: ${tabs.map((x) => x.url).join(', ')}`);
      return t.id;
    }, url);
  }

  beforeAll(async () => {
    const { createTestHarness } = await import('wrangler');
    harness = createTestHarness();
    await harness.update({ workers: [{ configPath: WORKER_CONFIG }] });
    const { url } = await harness.listen();
    await harness.getWorker().applyD1Migrations('DB' as never);
    process.env.WWM_API_URL = url.toString().replace(/\/$/, '');

    vite = await createServer({
      root: WEB_ROOT,
      configFile: `${WEB_ROOT}vite.config.ts`,
      logLevel: 'error',
      server: { port: 5391, strictPort: false, host: 'localhost' },
    });
    await vite.listen();
    const addr = vite.httpServer?.address();
    game = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 5391}`;

    fixture = await startFixturePage();
    extDir = mkdtempSync(join(tmpdir(), 'wwm-ext-'));
    const built = await buildExtension({ origin: game, outDir: extDir, zip: false });
    userData = mkdtempSync(join(tmpdir(), 'wwm-ext-profile-'));
    ctx = await chromium.launchPersistentContext(userData, {
      channel: 'chromium',
      headless: !process.env.WWM_HEADED,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${built.dir}`,
        `--load-extension=${built.dir}`,
        // lets the test click the toolbar action through CDP (Extensions.triggerAction)
        '--enable-unsafe-extension-debugging',
        ...GPU,
      ],
    });
    if (IN_CI)
      await ctx.addInitScript(() => {
        delete (Navigator.prototype as { gpu?: unknown }).gpu;
      });
    await ctx.addInitScript((ci) => {
      if (location.port && location.hostname === 'localhost') {
        localStorage.setItem('wwm.howtoSeen', '1');
        localStorage.setItem('wwm.tutorialDone', '1');
        (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = {
          // CI: the engine's 'low' tier, so software WebGL2 leaves CPU for the sim (apps/web/test/browser-env.ts)
          ...(ci ? { quality: 'low' } : {}),
          noAutoPause: true,
          skipIntro: true,
        };
      }
    }, IN_CI);
    sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    extId = new URL(sw.url()).host;
  }, 180_000);

  afterAll(async () => {
    await ctx?.close();
    await vite?.close();
    await harness?.close();
    await fixture?.close();
    if (extDir) rmSync(extDir, { recursive: true, force: true });
    if (userData) rmSync(userData, { recursive: true, force: true });
  });

  let local: Page;

  test('extension click → scroll-stitched capture → /play/local → a playable maze', async () => {
    const pageUrl = `${fixture.origin}/`;
    const site = await ctx.newPage();
    watch(site, 'site');
    await site.goto(pageUrl);
    await site.evaluate(() => window.scrollTo(0, 420)); // the player is mid-page
    await site.bringToFront();
    const tabId = await tabIdOf(pageUrl);

    // The toolbar click: CDP `Extensions.triggerAction` on the fixture tab runs the extension's action exactly
    // like a click (the popup opens, `activeTab` is granted for that tab, and the popup starts the capture).
    const gameTab = ctx.waitForEvent('page', {
      predicate: (p) => p.url().includes('/play/local'),
      timeout: 60_000,
    });
    const cdp = await ctx.browser()?.newBrowserCDPSession();
    if (!cdp) throw new Error('no browser CDP session');
    const { targetInfos } = (await cdp.send('Target.getTargets', { filter: [{}] })) as {
      targetInfos: { type: string; url: string; targetId: string }[];
    };
    const tabTarget = targetInfos.find((t) => t.type === 'tab' && t.url === pageUrl);
    if (!tabTarget) throw new Error('no tab target for the fixture page');
    await cdp.send(
      'Extensions.triggerAction' as 'Target.getTargets',
      { id: extId, targetId: tabTarget.targetId } as never,
    );

    // A second view of the same popup, in its own window so the fixture tab stays in front, for screenshots.
    // It joins the running job (a start request while busy is ignored).
    const popupSeen = ctx.waitForEvent('page', {
      predicate: (p) => p.url().startsWith(`chrome-extension://${extId}/popup.html`),
    });
    await sw.evaluate(
      async ({ id, tab }) => {
        const c = (globalThis as unknown as { chrome: { windows: { create(o: object): Promise<unknown> } } })
          .chrome;
        await c.windows.create({
          url: `chrome-extension://${id}/popup.html?tab=${tab}`,
          type: 'popup',
          width: 360,
          height: 560,
          focused: false,
        });
      },
      { id: extId, tab: tabId },
    );
    const popup = await popupSeen;
    watch(popup, 'popup');
    await popup.setViewportSize({ width: 348, height: 440 });
    await popup
      .waitForSelector('.step__count', { timeout: 20_000 }) // mid-way through the frames
      .catch(() => popup.waitForSelector('.step.is-now, .step.is-done'));
    await shot(popup, '01-popup-capturing');

    local = await gameTab.catch(async (e) => {
      const why = await sw.evaluate(() =>
        JSON.stringify((globalThis as unknown as { wwmState(): unknown }).wwmState()),
      );
      throw new Error(`no game tab; popup says: ${why}`, { cause: e });
    });
    watch(local, 'game');
    await waitLocal(local, 'playing');
    expect(await local.evaluate(() => window.__wwmLocal?.via)).toBe('extension');
    if (!popup.isClosed()) {
      await popup.waitForFunction(
        () => document.querySelector('.pop')?.getAttribute('data-state') === 'done',
        null,
        { timeout: 20_000 },
      );
      await shot(popup, '02-popup-done');
    }

    // the page was restored where the player left it
    expect(await site.evaluate(() => window.scrollY)).toBe(420);
    expect(
      await site.evaluate(
        () => document.querySelectorAll('[data-wwm-ext-hidden], style[data-wwm-ext]').length,
      ),
    ).toBe(0);

    await waitPhase(local, 'play');
    const stage = (await local.evaluate(async () => {
      const g = window.__wwmGame as unknown as { debugState(): { stageId: string | null } };
      return g.debugState().stageId;
    })) as string;
    expect(stage).toMatch(/^[0-9a-f]{64}$/);
    await local.waitForTimeout(800);
    await shot(local, '03-play-local');
    const moved = await rolls(local);
    expect(moved).toBeGreaterThan(0.5);
    // the plate: local capture, nothing uploaded
    const plate = local.getByTestId('local-origin');
    expect(await plate.textContent()).toContain('127.0.0.1');
    expect(await plate.getAttribute('data-sketch')).toBeNull();
    expect(problems).toEqual([]);
  }, 240_000);

  test('Share uploads to POST /api/stages/upload; the link plays the maze from the server', async () => {
    await local.getByTestId('local-share').click();
    await local.getByTestId('local-shared').waitFor({ timeout: 90_000 });
    await shot(local, '04-shared');
    const url = (await local.evaluate(() => window.__wwmLocal?.sharedUrl)) as string;
    expect(url).toMatch(/\/play\/[0-9a-f]{64}$/);
    const stageId = url.split('/').at(-1) as string;
    const stage = (await (
      await fetch(`${process.env.WWM_API_URL}/api/stages/${stageId}`)
    ).json()) as StageData;
    expect(stage.provenance.notes).toContain('local-capture');
    expect(stage.source.url).toBe(`${fixture.origin}/`);
    expect(stage.texture.scale).toBeGreaterThanOrEqual(1);

    const shared = await ctx.newPage();
    watch(shared, 'shared');
    await shared.goto(url);
    await waitPhase(shared, 'play');
    expect(await stageOf(shared)).toBe(stageId);
    expect(await rolls(shared)).toBeGreaterThan(0.5);
    await shared.close();
    expect(problems).toEqual([]);
  }, 240_000);

  test('receiver ignores a capture from another window (wrong origin), then accepts the trusted one', async () => {
    // The fixture page (another origin) frames /play/local and posts a capture into it.
    const site = await ctx.newPage();
    watch(site, 'site-2');
    await site.goto(`${fixture.origin}/`);
    await site.evaluate((g) => {
      document.body.innerHTML = `<iframe id="f" src="${g}/play/local" style="width:900px;height:600px"></iframe>`;
    }, game);
    const frame = await (await site.waitForSelector('#f')).contentFrame();
    if (!frame) throw new Error('no frame');
    await frame.waitForFunction(() => document.body.dataset.local === 'waiting');
    await site.evaluate(async (g) => {
      const f = document.getElementById('f') as HTMLIFrameElement;
      const bundle = {
        schema: 'wwm.capture/1',
        captureId: 'x',
        url: 'https://evil.example/',
        title: 'evil',
        capturedAt: new Date().toISOString(),
        viewport: { width: 800, height: 600 },
        page: { width: 800, height: 600 },
        screenshot: { path: 's.png', width: 800, height: 600, format: 'png', scale: 1 },
        backgroundColor: '#ffffff',
        elements: [],
      };
      for (const target of [g, '*'])
        f.contentWindow?.postMessage({ type: 'wwm:capture', version: 1, bundle, image: null }, target);
    }, game);
    // Wait until the receiver has handled both messages (not a fixed 400 ms: slower on a loaded CI runner).
    await expect
      .poll(
        () => frame.evaluate(() => (window.__wwmLocal?.ignored ?? 0) + (window.__wwmLocal?.rejected ?? 0)),
        {
          timeout: 15_000,
        },
      )
      .toBeGreaterThanOrEqual(2);
    const dbg = await frame.evaluate(() => ({ ...window.__wwmLocal }));
    expect(dbg).toMatchObject({ phase: 'waiting', ignored: 2, rejected: 0 });
    expect(await frame.evaluate(() => document.body.dataset.local)).toBe('waiting');
    await site.close();
  }, 60_000);

  test('bookmarklet: DOM-only capture → sketch mode → playable', async () => {
    const mazify = await ctx.newPage();
    watch(mazify, 'mazify');
    await mazify.goto(`${game}/mazify`);
    // the page swaps the bookmarklet URL in from an effect (MazifyPage.tsx): `/mazify` until then
    const bookmarklet = mazify.getByTestId('bookmarklet');
    await expect.poll(() => bookmarklet.getAttribute('href'), { timeout: 20_000 }).toMatch(/^javascript:/);
    const href = (await bookmarklet.getAttribute('href')) as string;
    await shot(mazify, '07-mazify', true);
    await mazify.close();

    const site = await ctx.newPage();
    watch(site, 'site-3');
    await site.goto(`${fixture.origin}/`);
    const opened = ctx.waitForEvent('page', { predicate: (p) => p.url().includes('via=bookmarklet') });
    // what clicking the bookmark does: run its code as a script on the page
    await site.addScriptTag({ content: decodeURIComponent(href.slice('javascript:'.length)) });
    const sketch = await opened;
    watch(sketch, 'sketch');
    await waitLocal(sketch, 'playing');
    expect(await sketch.evaluate(() => window.__wwmLocal?.via)).toBe('bookmarklet');
    await waitPhase(sketch, 'play');
    await sketch.waitForTimeout(800);
    await shot(sketch, '05-play-sketch');
    expect(await sketch.getByTestId('local-origin').getAttribute('data-sketch')).toBe('true');
    expect(await rolls(sketch)).toBeGreaterThan(0.5);
    expect(problems).toEqual([]);
  }, 180_000);

  test('the popup explains pages it cannot capture; the receiver waits with help', async () => {
    // a browser page no extension may capture
    const tabId = await sw.evaluate(async () => {
      const c = (
        globalThis as unknown as { chrome: { tabs: { create(o: object): Promise<{ id: number }> } } }
      ).chrome;
      return (await c.tabs.create({ url: 'chrome://version', active: false })).id;
    });
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 348, height: 420 });
    await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await popup.waitForFunction(
      () => document.querySelector('.pop')?.getAttribute('data-state') === 'restricted',
    );
    expect(await popup.locator('#notice').isVisible()).toBe(true);
    await shot(popup, '06-popup-restricted');
    await popup.close();

    const wait = await ctx.newPage();
    await wait.setViewportSize({ width: 1280, height: 800 });
    await wait.goto(`${game}/play/local`);
    await wait.getByTestId('local-slow').waitFor({ timeout: 15_000 });
    await shot(wait, '08-receiver-waiting');
    const sel = await ctx.newPage();
    await sel.goto(`${game}/`);
    await sel.waitForFunction(() => !!window.__wwmGame);
    await sel.evaluate(() => {
      const g = window.__wwmGame as unknown as { start(): void; howtoDone(): void; playKeyboard(): void };
      g.start();
    });
    await sel
      .waitForFunction(
        () => document.body.dataset.phase === 'select' || document.body.dataset.phase === 'pairing',
        null,
        { timeout: 10_000 },
      )
      .catch(() => {});
    if ((await phaseOf(sel)) === 'pairing')
      await sel.evaluate(() => (window.__wwmGame as unknown as { playKeyboard(): void }).playKeyboard());
    await sel.getByTestId('select-mazify').waitFor({ timeout: 15_000 });
    await sel.waitForTimeout(900); // the screen's entrance animation
    await shot(sel, '09-select-hint');
  }, 90_000);
});
