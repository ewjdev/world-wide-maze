/**
 * The same simulation code in a real Web Worker (Chromium via Playwright, served by the web app's Vite dev
 * server at /dev/physics?selftest=1):
 *  1. the fixture replay run inside the worker is bit-identical to the Node run (cross-engine determinism),
 *  2. the free-running worker holds ~120 steps/s and moves the ball, with no console errors.
 * Needs Playwright Chromium (`pnpm --filter @wwm/fixture-capture browsers`); skipped locally without it,
 * required in CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { InputSample } from '@wwm/schema';
import { type Browser, chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { replay } from '../src/replay.ts';
import { HANDMADE, HANDMADE_REPLAY_URL } from './helpers/stages.ts';

const HAS_CHROMIUM = existsSync(chromium.executablePath()) || !!process.env.CI;
const WEB_ROOT = fileURLToPath(new URL('../../../apps/web/', import.meta.url));

describe.skipIf(!HAS_CHROMIUM)('worker build in Chromium (/dev/physics)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base = '';

  beforeAll(async () => {
    server = await createServer({
      root: WEB_ROOT,
      configFile: `${WEB_ROOT}vite.config.ts`,
      logLevel: 'error',
      server: { port: 5190, strictPort: false, host: '127.0.0.1', proxy: {} },
    });
    await server.listen();
    base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5190/';
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  test('replay in the worker == replay in Node; live worker steps at ~120 Hz', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}dev/physics?selftest=1`);
    const el = page.getByTestId('selftest');
    await expect
      .poll(async () => (await el.textContent())?.length ?? 0, { timeout: 90_000 })
      .toBeGreaterThan(10);
    const result = JSON.parse((await el.textContent()) ?? '{}');
    await page.close();
    expect(result.error).toBeUndefined();

    const inputs = JSON.parse(readFileSync(HANDMADE_REPLAY_URL, 'utf8')) as InputSample[];
    const node = await replay(HANDMADE, inputs);
    expect(result.replay.goalTick).toBe(node.goalTick);
    expect(result.replay.events).toEqual(node.events);
    expect(result.replay.final).toEqual(node.final); // bit-identical across V8-in-Node and Chromium worker

    console.log(
      `[physics] worker live: ${result.live.stepsPerSec.toFixed(1)} steps/s, tick ${result.live.tick}`,
    );
    expect(result.live.stepsPerSec).toBeGreaterThan(100);
    expect(result.live.stepsPerSec).toBeLessThan(140);
    expect(result.live.moved).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  }, 120_000);
});
