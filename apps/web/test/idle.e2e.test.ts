/** Foreground synthetic visibility proves app scheduling, independently of browser background throttling. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { browserEnv, CHROMIUM_ARGS, CI_HOOKS } from './browser-env.ts';

declare global {
  interface Window {
    idleProbe: {
      visibility: DocumentVisibilityState;
      frames: number;
      heartbeats: number;
      frameDeltas: { animation: number; quality: number | null | undefined }[];
      padHeld: boolean;
      hide(): void;
      show(): void;
      beats(n: number): Promise<void>;
    };
  }
}
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

for (const driver of ['lockstep', 'worker'])
  test.skipIf(!available)(
    `${driver}: hidden app stops frames and time, resumes without catchup or held gamepad input`,
    async () => {
      const ctx = await browser.newContext();
      await browserEnv(ctx);
      await ctx.addInitScript((hooks) => {
        localStorage.setItem('wwm.analytics.preference', 'off');
        localStorage.setItem('wwm.howtoSeen', '1');
        localStorage.setItem('wwm.tutorialDone', '1');
        window.__WWM_TEST__ = { ...hooks, skipIntro: true, noAutoPause: true };
        const p: Window['idleProbe'] = {
          visibility: 'visible' as DocumentVisibilityState,
          frames: 0,
          heartbeats: 0,
          frameDeltas: [] as { animation: number; quality: number | null | undefined }[],
          padHeld: false,
          hide() {
            p.visibility = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
          },
          show() {
            p.visibility = 'visible';
            document.dispatchEvent(new Event('visibilitychange'));
          },
          async beats(n: number) {
            for (let i = 0; i < n; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()));
          },
        };
        window.idleProbe = p;
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => p.visibility });
        Object.defineProperty(navigator, 'getGamepads', {
          configurable: true,
          value: () => [
            {
              connected: true,
              axes: [0, 0],
              buttons: Array.from({ length: 10 }, (_, i) => ({
                pressed: i === 0 && p.padHeld,
                value: i === 0 && p.padHeld ? 1 : 0,
              })),
            },
          ],
        });
        const beat = () => {
          p.heartbeats++;
          requestAnimationFrame(beat);
        };
        requestAnimationFrame(beat);
      }, CI_HOOKS);
      await ctx.route('**/api/**', (r) => r.fulfill({ json: [] }));
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${base}play/practice?offline=1&physics=${driver}`);
      await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
      const result = await page.evaluate(async () => {
        const g = window.__wwmGame;
        if (!g?.engine) throw new Error('Game not mounted');
        const e = g.engine,
          p = window.idleProbe;
        const frame = e.frame;
        e.frame = function (dt, quality) {
          p.frames++;
          p.frameDeltas.push({ animation: dt, quality });
          return frame.call(this, dt, quality);
        };
        await p.beats(3);
        // A real held keyboard key is reset even without the browser's blur event.
        dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
        p.hide();
        p.padHeld = true;
        const hidden = { state: g.debugState(), frames: p.frames, heartbeats: p.heartbeats };
        await p.beats(65);
        const stopped = { state: g.debugState(), frames: p.frames, heartbeats: p.heartbeats };
        const recStart = g.debugRecording().length;
        p.frameDeltas = [];
        p.show();
        await p.beats(3);
        const resumed = {
          state: g.debugState(),
          frames: p.frames,
          deltas: p.frameDeltas.slice(),
          inputs: g.debugRecording().slice(recStart),
        };
        p.padHeld = false;
        await p.beats(3);
        const freshStart = g.debugRecording().length;
        p.padHeld = true;
        await p.beats(3);
        const fresh = g.debugRecording().slice(freshStart);
        p.padHeld = false;
        g.menu();
        await p.beats(3);
        const paused = g.debugState();
        p.hide();
        await p.beats(3);
        p.show();
        await p.beats(3);
        return { hidden, stopped, resumed, fresh, paused, pausedAfter: g.debugState() };
      });
      expect(result.stopped.frames).toBe(result.hidden.frames);
      expect(result.stopped.heartbeats - result.hidden.heartbeats).toBeGreaterThanOrEqual(65);
      expect(result.stopped.state.tick).toBe(result.hidden.state.tick);
      expect(result.stopped.state.clock).toBe(result.hidden.state.clock);
      expect(result.stopped.state.timer).toEqual(result.hidden.state.timer);
      expect(result.stopped.state.rollLevel).toBe(0);
      expect(result.resumed.frames).toBeGreaterThan(result.stopped.frames);
      expect(result.resumed.state.clock - result.stopped.state.clock).toBeLessThan(0.3);
      expect(result.resumed.deltas[0]?.quality).toBeNull();
      expect(result.resumed.inputs.length).toBeGreaterThan(0);
      expect(result.resumed.inputs.every((x) => !x.jump && !x.power && x.tiltX === 0 && x.tiltZ === 0)).toBe(
        true,
      );
      expect(result.fresh.some((x) => x.jump)).toBe(true);
      expect(result.paused.phase).toBe('paused');
      expect(result.pausedAfter.phase).toBe('paused');
      expect(result.pausedAfter.tick).toBe(result.paused.tick);
      expect(result.pausedAfter.timer).toEqual(result.paused.timer);
      expect(errors).toEqual([]);
      await ctx.close();
    },
    60_000,
  );
