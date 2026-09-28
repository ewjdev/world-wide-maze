/** Cancellation must suppress obsolete stage publication, including in-flight texture loads and retries. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { expect, test } from 'vitest';
import { catalogEntry } from '../src/game/catalog.ts';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS, IN_CI } from './browser-env.ts';

const gallery = catalogEntry('fixture-image-gallery');
const hn = catalogEntry('fixture-hn-front');
if (!gallery || !hn) throw new Error('gallery fixture missing');

for (const operation of ['fixture', 'retry', 'dispose-reject'] as const) {
  test.skipIf(!existsSync(chromium.executablePath()) && !process.env.CI)(
    `cancelled ${operation} install cannot publish into a new generation`,
    async () => {
      const server = await createServer({
        root: fileURLToPath(new URL('../', import.meta.url)),
        server: { port: 0 },
        logLevel: 'error',
      });
      await server.listen();
      const browser = await chromium.launch({ headless: IN_CI, args: CHROMIUM_ARGS });
      try {
        const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
        await browserEnv(context);
        await context.route('**/api/**', (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
        );
        await context.addInitScript((hooks) => {
          localStorage.setItem('wwm.analytics.preference', 'off');
          localStorage.setItem('wwm.howtoSeen', '1');
          localStorage.setItem('wwm.tutorialDone', '1');
          window.__WWM_TEST__ = { ...hooks, skipIntro: true, noAutoPause: true };
        }, CI_HOOKS);
        const page = await context.newPage();
        await page.goto(`${server.resolvedUrls?.local[0]}play/practice?offline=1`);
        await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
        await page.evaluate(
          ({ operation, firstEntry }) => {
            const game = window.__wwmGame;
            if (!game?.engine) throw new Error('game unavailable');
            const state = window as unknown as {
              releaseWorld: () => void;
              releaseNext: () => void;
              secondBlocked: boolean;
              unloads: number;
              rejectedImage?: { readonly width: number };
              installed: string[];
              blocked: boolean;
            };
            const original = game.engine.loadStage.bind(game.engine);
            state.installed = [];
            state.unloads = 0;
            const unload = game.engine.unloadStage.bind(game.engine);
            game.engine.unloadStage = () => {
              state.unloads++;
              unload();
            };
            state.blocked = false;
            state.secondBlocked = false;
            let first = true;
            game.engine.loadStage = async (stage, image) => {
              if (first) {
                first = false;
                state.blocked = true;
                await new Promise<void>((resolve) => {
                  state.releaseWorld = resolve;
                });
              } else {
                state.secondBlocked = true;
                await new Promise<void>((resolve) => {
                  state.releaseNext = resolve;
                });
              }
              if (operation === 'dispose-reject') {
                state.rejectedImage = image;
                throw new Error('controlled late texture failure');
              }
              state.installed.push(stage.stageId);
              await original(stage, image);
            };
            game.menu();
            if (operation === 'retry') game.retryStage();
            else {
              game.askConfirm('search');
              game.confirm(true);
              game.chooseEntry(firstEntry);
            }
          },
          { operation, firstEntry: gallery },
        );
        await page.waitForFunction(() => (window as unknown as { blocked: boolean }).blocked);
        if (operation === 'dispose-reject') {
          await page.evaluate(() => {
            window.__wwmGame?.dispose();
            (window as unknown as { releaseWorld: () => void }).releaseWorld();
          });
          await page.waitForFunction(() => (window as unknown as { unloads: number }).unloads > 0);
          expect(
            await page.evaluate(
              () => (window as unknown as { rejectedImage: ImageBitmap }).rejectedImage.width,
            ),
          ).toBe(0);
          return;
        }
        await page.evaluate(
          (entry) => {
            const game = window.__wwmGame;
            if (!game) throw new Error('game unavailable');
            game.cancelBuild();
            game.chooseEntry(entry);
          },
          operation === 'fixture' ? hn : gallery,
        );
        await page.waitForTimeout(150);
        expect(await page.evaluate(() => (window as unknown as { installed: string[] }).installed)).toEqual(
          [],
        );
        await page.evaluate(() => (window as unknown as { releaseWorld: () => void }).releaseWorld());
        await page.waitForFunction(() => (window as unknown as { secondBlocked: boolean }).secondBlocked);
        await page.waitForTimeout(2500); // Exceed MIN_BUILD_SEC: obsolete retry must not publish BUILT.
        expect(await page.evaluate(() => window.__wwmGame?.debugState().phase)).toBe('building');
        await page.evaluate(() => (window as unknown as { releaseNext: () => void }).releaseNext());
        await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play', null, {
          timeout: 60_000,
        });
        const final = await page.evaluate(() => ({
          state: window.__wwmGame?.debugState(),
          installed: (window as unknown as { installed: string[] }).installed,
        }));
        expect(final.installed).toHaveLength(2);
        expect(final.installed[0]).not.toBe(final.installed[1]);
        expect(final.state?.stageId).toBe(final.installed[1]);
        expect(final.state?.phase).toBe('play');
      } finally {
        await browser.close();
        await server.close();
      }
    },
    120_000,
  );
}
