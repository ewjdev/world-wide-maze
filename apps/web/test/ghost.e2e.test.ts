/** Real worker parity plus classic-game preparation, retry, error and unmount lifecycle. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PHYSICS_VERSION } from '@wwm/physics';
import type { InputSample, StageData } from '@wwm/schema';
import { type Browser, chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { recordGhostTrack } from '../src/ranking/ghost-track.ts';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS } from './browser-env.ts';

const stage = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;
const inputs = JSON.parse(
  readFileSync(new URL('../../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
) as InputSample[];
const png = readFileSync(new URL('../../../fixtures/stages/handmade-simple.png', import.meta.url));
const available = existsSync(chromium.executablePath()) || !!process.env.CI;
let server: ViteDevServer;
let browser: Browser;
let base: string;
beforeAll(async () => {
  if (!available) return;
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  base = server.resolvedUrls?.local[0] ?? '';
  browser = await chromium.launch({ headless: !!process.env.CI, args: CHROMIUM_ARGS });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

test.skipIf(!available)(
  'real worker matches all headless reference poses and goal tick',
  async () => {
    const page = await browser.newPage();
    await page.route('**/ghost-test', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<title>Ghost test</title>' }),
    );
    await page.goto(`${base}ghost-test`);
    await page.addScriptTag({
      type: 'module',
      content:
        "import { GhostClient } from '/src/ranking/ghost-client.ts'; window.TestGhostClient = GhostClient;",
    });
    await page.waitForFunction(() => 'TestGhostClient' in window);
    const reference = await recordGhostTrack(stage, inputs);
    const actual = await page.evaluate(
      async ({ stage, inputs }) => {
        const Client = (
          window as unknown as {
            TestGhostClient: typeof import('../src/ranking/ghost-client.ts').GhostClient;
          }
        ).TestGhostClient;
        const client = new Client();
        const track = await client.prepare(stage, inputs);
        client.dispose();
        return { ...track, pos: Array.from(track.pos), quat: Array.from(track.quat) };
      },
      { stage, inputs },
    );
    expect(actual).toEqual({
      ...reference,
      pos: Array.from(reference.pos),
      quat: Array.from(reference.quat),
    });
    expect(actual.goalTick).toBe(5429);
    await page.close();
  },
  60_000,
);

test.skipIf(!available)(
  'game stays playable, retries cancel preparation, and unmount terminates workers',
  async () => {
    const ctx = await browser.newContext();
    await browserEnv(ctx);
    await ctx.addInitScript((hooks) => {
      localStorage.setItem('wwm.analytics.preference', 'off');
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      window.__WWM_TEST__ = { ...hooks, skipIntro: true, noAutoPause: true };
      // Hold only ghost jobs before dispatch, so cancellation is deterministic rather
      // than dependent on how fast this host can run Rapier. Other workers remain real.
      const NativeWorker = Worker;
      Object.assign(window, { ghostJobs: [], ghostFailure: false });
      window.Worker = class extends NativeWorker {
        ghost = false;
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.ghost = String(url).includes('ghost-worker');
        }
        override postMessage(message: unknown, transfer: Transferable[]): void;
        override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
        override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
          if (!this.ghost) {
            super.postMessage(message, options as StructuredSerializeOptions);
            return;
          }
          const w = window as unknown as {
            ghostJobs: { worker: Worker; terminated: boolean; release: () => void }[];
            ghostFailure: boolean;
          };
          if (w.ghostFailure) {
            queueMicrotask(() => this.dispatchEvent(new Event('error')));
            return;
          }
          w.ghostJobs.push({
            worker: this,
            terminated: false,
            release: () => super.postMessage(message, options as StructuredSerializeOptions),
          });
        }
        override terminate() {
          const w = window as unknown as { ghostJobs: { worker: Worker; terminated: boolean }[] };
          for (const job of w.ghostJobs) if (job.worker === this) job.terminated = true;
          super.terminate();
        }
      };
    }, CI_HOOKS);
    let generation = 0;
    await ctx.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/texture')) return route.fulfill({ contentType: 'image/png', body: png });
      if (path.startsWith('/api/stages/'))
        return route.fulfill({
          json: {
            ...stage,
            texture: { ...stage.texture, path: `${base}api/stages/${stage.stageId}/texture` },
          },
        });
      if (path.startsWith('/api/runs/'))
        return route.fulfill({
          json: { runId: 'test', title: 'Ghost test', url: stage.source.url, stageIds: [stage.stageId] },
        });
      if (path.endsWith('/ghost'))
        return route.fulfill({
          json: {
            name: `ghost_${++generation}`,
            score: 1484,
            timeMs: 45_000,
            physicsVersion: PHYSICS_VERSION,
            inputs,
          },
        });
      return route.fulfill({
        json: { entries: [{ name: 'ghost', score: 1484, at: new Date().toISOString() }] },
      });
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}play/${stage.stageId}`);
    await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
    expect(await page.getByTestId('ghost-status').textContent()).toContain('Preparing ghost');
    await page.keyboard.press('KeyM');
    await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'paused');
    await page.evaluate(() => window.__wwmGame?.retryStage());
    await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { ghostJobs: unknown[] }).ghostJobs.length))
      .toBe(2);
    expect(
      await page.evaluate(
        () => (window as unknown as { ghostJobs: { terminated: boolean }[] }).ghostJobs[0]?.terminated,
      ),
    ).toBe(true);
    await page.evaluate(() =>
      (window as unknown as { ghostJobs: { release: () => void }[] }).ghostJobs[1]?.release(),
    );
    await page.waitForFunction(() => window.__wwmGame?.debugState().ghost.loaded);
    expect(await page.evaluate(() => window.__wwmGame?.debugState().ghost.run?.name)).toBe('ghost_2');
    // Worker failure is visible while the game stays playable and pausable.
    await page.goto(`${base}play/${stage.stageId}`);
    await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
    await page.evaluate(() => {
      Object.assign(window, { ghostFailure: true });
      window.__wwmGame?.menu();
      window.__wwmGame?.retryStage();
    });
    await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
    await expect.poll(() => page.getByTestId('ghost-status').textContent()).toContain('Ghost unavailable');
    await page.keyboard.press('KeyM');
    await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'paused');
    // A new route gets a fresh game. Hold a new real worker, then unmount while pending.
    await page.goto(`${base}play/${stage.stageId}`);
    await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
    expect(await page.evaluate(() => (window as unknown as { ghostJobs: unknown[] }).ghostJobs.length)).toBe(
      1,
    );
    // Navigation starts before the lazy About route is ready. Keep its module pending
    // to prove URL changes alone do not establish the GameApp unmount boundary.
    let releaseAbout = () => {};
    const aboutReady = new Promise<void>((resolve) => {
      releaseAbout = resolve;
    });
    await page.route('**/src/pages/about/AboutPage.tsx*', async (route) => {
      await aboutReady;
      await route.continue();
    });
    const aboutRequested = page.waitForRequest('**/src/pages/about/AboutPage.tsx*');
    try {
      await page.evaluate(() => {
        history.pushState({}, '', '/about');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await aboutRequested;
      expect(
        await page.evaluate(() => ({
          mounted: !!window.__wwmGame,
          terminated: (window as unknown as { ghostJobs: { terminated: boolean }[] }).ghostJobs.map(
            (job) => job.terminated,
          ),
        })),
      ).toEqual({ mounted: true, terminated: [false] });
      releaseAbout();
      // GameApp clears this handle after its synchronous dispose cleanup. Wait for
      // that actual lifecycle boundary, then require termination without polling.
      await page.waitForFunction(() => window.__wwmGame === undefined);
      expect(
        await page.evaluate(() =>
          (window as unknown as { ghostJobs: { terminated: boolean }[] }).ghostJobs.map(
            (job) => job.terminated,
          ),
        ),
      ).toEqual([true]);
    } finally {
      releaseAbout();
    }
    expect(errors).toEqual([]);
    await ctx.close();
  },
  120_000,
);

test.skipIf(!available)(
  'late network response cannot replace a newer same-stage ghost',
  async () => {
    const ctx = await browser.newContext();
    await browserEnv(ctx);
    await ctx.addInitScript((hooks) => {
      localStorage.setItem('wwm.analytics.preference', 'off');
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      window.__WWM_TEST__ = { ...hooks, skipIntro: true, noAutoPause: true, timeScale: 2 };
    }, CI_HOOKS);
    let releaseFirst: () => void = () => {};
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    await ctx.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/texture')) return route.fulfill({ contentType: 'image/png', body: png });
      if (path.startsWith('/api/stages/'))
        return route.fulfill({
          json: {
            ...stage,
            texture: { ...stage.texture, path: `${base}api/stages/${stage.stageId}/texture` },
          },
        });
      if (path.startsWith('/api/runs/'))
        return route.fulfill({
          json: { runId: 'test', title: 'Ghost test', url: stage.source.url, stageIds: [stage.stageId] },
        });
      if (path.endsWith('/ghost')) {
        const call = ++calls;
        if (call === 1) await first;
        return route.fulfill({
          json: {
            name: `ghost_${call}`,
            score: 1484,
            timeMs: 45_000,
            physicsVersion: PHYSICS_VERSION,
            inputs,
          },
        });
      }
      return route.fulfill({
        json: { entries: [{ name: 'ghost', score: 1484, at: new Date().toISOString() }] },
      });
    });
    try {
      const page = await ctx.newPage();
      await page.goto(`${base}play/${stage.stageId}`);
      await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
      expect(calls).toBe(1);
      await page.evaluate(() => {
        window.__wwmGame?.menu();
        window.__wwmGame?.retryStage();
      });
      await page.waitForFunction(() => window.__wwmGame?.debugState().ghost.loaded);
      expect(await page.evaluate(() => window.__wwmGame?.debugState().ghost.run?.name)).toBe('ghost_2');
      const delivered = page.waitForResponse((r) => r.url().endsWith('/ghost'));
      releaseFirst();
      await delivered;
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => window.__wwmGame?.debugState().ghost.run?.name)).toBe('ghost_2');
    } finally {
      releaseFirst();
      await ctx.close();
    }
  },
  90_000,
);
