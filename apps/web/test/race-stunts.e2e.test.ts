/** Browser review for stunt Race. Synthetic phone transport/sensors do not validate a physical phone. */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RaceInputSample } from '@wwm/race';
import { decodeInput, type RaceState, type StateMessage } from '@wwm/schema';
import type { WebSocketRoute } from 'playwright';
import { describe, expect, test } from 'vitest';

const BASE = process.env.WWM_RACE_E2E_BASE;
const SHOTS = process.env.WWM_RACE_SHOTS;
const run = BASE ? describe : describe.skip;

run('Race stunt browser acceptance', () => {
  test('three real falls stop the race and retry restores lives with an empty stack', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
    try {
      await context.addInitScript(() =>
        Object.assign(window, {
          __WWM_RACE_TEST__: {
            inputs: Array.from({ length: 36000 }, () => ({
              tiltX: 0.43,
              tiltZ: 0.43,
              frameYaw: 0,
              power: true,
              jump: false,
            })),
            countdownSec: 0.01,
            timeScale: 4,
            noAutoPause: true,
            quality: 'low',
          },
        }),
      );
      const page = await context.newPage();
      // Course rebuilds must not reload an in-progress acceptance run.
      await page.routeWebSocket(
        (url) => url.host === new URL(BASE ?? 'http://localhost').host && url.pathname === '/',
        () => {},
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${BASE}/race/needle-garden`);
      await page.getByTestId('race-start').click({ timeout: 30000 });
      await page.getByTestId('race-lives').waitFor();
      expect(await page.getByTestId('race-lives').textContent()).toContain('3 / 3');
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, 'stacked-turbo-lives-mobile.png') });
      }
      await page.getByTestId('race-exhausted').waitFor({ timeout: 90000 });
      const ended = await page.evaluate(() => window.__wwmRace?.debugState());
      expect(ended?.mechanics).toMatchObject({ lives: 0, turboCharges: 0, exhausted: true });
      expect(ended?.progress.reasons).toContain('fall');
      await page.waitForTimeout(250);
      expect((await page.evaluate(() => window.__wwmRace?.debugState()))?.tick).toBe(ended?.tick);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, 'stacked-turbo-out-of-lives.png') });
      await page.evaluate(() => {
        if (window.__WWM_RACE_TEST__) window.__WWM_RACE_TEST__.countdownSec = 1000;
      });
      await page.getByTestId('race-retry').click();
      await page.waitForFunction(() => window.__wwmRace?.debugState().phase === 'countdown');
      const retry = await page.evaluate(() => window.__wwmRace?.debugState());
      expect(retry?.mechanics).toMatchObject({ lives: 3, turboCharges: 0, exhausted: false });
      expect(retry?.tick).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  }, 120000);
  test('simulated phone displays charge, sends turbo on tap, disables while paused, and retains legacy Power', async () => {
    const { chromium, devices } = await import('playwright');
    const browser = await chromium.launch();
    const context = await browser.newContext({ ...devices['iPhone 15 Pro'], locale: 'en-US' });
    const errors: string[] = [];
    const messages: Record<string, unknown>[] = [];
    let poweredFrames = 0;
    let socket: WebSocketRoute | null = null;
    try {
      await context.addInitScript(() => {
        Object.assign(DeviceOrientationEvent, { requestPermission: () => Promise.resolve('granted') });
        setInterval(() => {
          window.dispatchEvent(
            Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 45, gamma: 0 }),
          );
        }, 16);
      });
      const page = await context.newPage();
      // Course rebuilds must not reload an in-progress acceptance run.
      await page.routeWebSocket(
        (url) => url.host === new URL(BASE ?? 'http://localhost').host && url.pathname === '/',
        () => {},
      );
      page.on('pageerror', (error) => errors.push(error.message));
      await page.routeWebSocket(/\/api\/rooms\/123456\//, (ws) => {
        socket = ws;
        ws.onMessage((message) => {
          if (typeof message !== 'string') {
            const frame = decodeInput(
              message.buffer.slice(
                message.byteOffset,
                message.byteOffset + message.byteLength,
              ) as ArrayBuffer,
            );
            if (frame?.power) poweredFrames++;
            return;
          }
          const parsed = JSON.parse(message);
          messages.push(parsed);
          if (parsed.t === 'ping') ws.send(JSON.stringify({ ...parsed, t: 'pong' }));
        });
      });
      await page.goto(`${BASE}/c/123456`);
      await page.getByTestId('enable-tilt').waitFor();
      const send = (message: object) => {
        if (!socket) throw new Error('Phone socket did not connect');
        socket.send(JSON.stringify(message));
      };
      send({ t: 'peer', role: 'host', connected: true });
      send({ t: 'capabilities-request' });
      await expect
        .poll(() => messages.find((m) => m.t === 'capabilities'))
        .toEqual({
          t: 'capabilities',
          raceVersion: 1,
          stuntVersion: 1,
        });
      await page.getByTestId('enable-tilt').tap();
      await page.locator('[data-screen="play"]').waitFor({ timeout: 10000 });
      const race: RaceState = {
        version: 1,
        phase: 'racing',
        elapsedTicks: 120,
        simHz: 120,
        sector: 0,
        totalSectors: 2,
        practice: false,
        boost: { ready: false, chargeTicks: 180, chargeRequired: 360, turboTicks: 0 },
      };
      const state: StateMessage = { t: 'state', phase: 'play', score: 0, balls: 0, timeLeft: 0, race };
      send(state);
      const turbo = page.getByTestId('btn-turbo');
      await turbo.waitFor();
      expect(await turbo.isDisabled()).toBe(true);
      expect(await turbo.textContent()).toContain('50% next');
      race.boost = { ready: true, chargeTicks: 90, chargeRequired: 360, turboTicks: 0, turboCharges: 2 };
      race.lives = 2;
      race.maxLives = 3;
      send(state);
      await expect.poll(() => turbo.isEnabled()).toBe(true);
      expect(await turbo.textContent()).toContain('Ready');
      expect(await turbo.textContent()).toContain('Turbo × 2');
      expect(await turbo.textContent()).toContain('25% next');
      race.boost.chargingReason = 'downhill';
      race.boost.chargeTicks = 0;
      send(state);
      await expect.poll(() => turbo.textContent()).toContain('Downhill · no charge');
      expect(await turbo.isEnabled()).toBe(true);
      race.boost.chargingReason = 'airborne';
      send(state);
      await expect.poll(() => turbo.textContent()).toContain('Airborne · no charge');
      expect(await turbo.isEnabled()).toBe(true);
      race.boost.chargingReason = 'charging';
      send(state);
      expect(await page.getByTestId('race-host-hud').textContent()).toContain('Lives 2 / 3');
      const power = page.getByTestId('btn-power');
      await power.dispatchEvent('pointerdown', { pointerId: 7, isPrimary: true, pointerType: 'touch' });
      await expect.poll(() => poweredFrames).toBeGreaterThan(0);
      await power.dispatchEvent('pointerup', { pointerId: 7, isPrimary: true, pointerType: 'touch' });
      expect(await turbo.isEnabled()).toBe(true);
      const box = await turbo.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, 'stunts-phone-turbo-ready.png') });
      }
      await turbo.tap();
      await expect.poll(() => messages.filter((m) => m.t === 'race-turbo').length).toBe(1);
      race.phase = 'paused';
      send(state);
      await expect.poll(() => turbo.isDisabled()).toBe(true);
      expect(messages.filter((m) => m.t === 'race-turbo')).toHaveLength(1);
      send({ t: 'state', phase: 'play', score: 0, balls: 3, timeLeft: 60 });
      await page.getByTestId('btn-power').waitFor();
      expect(await turbo.count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  }, 30000);
  test('all three real routes finish; turbo jump persists and replays as a personal shadow', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    try {
      for (const route of ['safe', 'near', 'far']) {
        const fixture = JSON.parse(
          readFileSync(
            new URL(`../../../fixtures/race/island-leap/${route}-inputs.json`, import.meta.url),
            'utf8',
          ),
        ) as { inputs: RaceInputSample[] };
        const expected = JSON.parse(
          readFileSync(
            new URL(`../../../fixtures/race/island-leap/${route}-validation.json`, import.meta.url),
            'utf8',
          ),
        );
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          locale: 'en-US',
        });
        try {
          await context.addInitScript((inputs) => {
            Object.assign(window, {
              __WWM_RACE_TEST__: {
                inputs,
                countdownSec: 0.01,
                timeScale: 4,
                noAutoPause: true,
                quality: 'low',
              },
            });
          }, fixture.inputs);
          const page = await context.newPage();
          // Course rebuilds must not reload an in-progress acceptance run.
          await page.routeWebSocket(
            (url) => url.host === new URL(BASE ?? 'http://localhost').host && url.pathname === '/',
            () => {},
          );
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.goto(`${BASE}/race/island-leap`);
          await page.getByTestId('race-ready').waitFor({ timeout: 30000 });
          await page.getByTestId('race-start').click();
          await page.getByTestId('race-boost').waitFor();
          // Derive review moments from the same frozen physics report as the input fixture.
          // This keeps changed jump counts/timing honest without baking the original course into tests.
          const events = expected.events as {
            tick: number;
            mechanic: string | null;
            events: { type: string }[];
          }[];
          const launches = events.filter((event) => event.mechanic === 'launch');
          const moments: { tick: number; name: string }[] = [];
          for (const [index, launch] of launches.entries()) {
            const landing = events.find((event) => event.tick > launch.tick && event.mechanic === 'landing');
            if (!landing) continue;
            moments.push(
              { tick: Math.max(1, launch.tick - 72), name: `jump-${index + 1}-approach` },
              { tick: Math.floor((launch.tick + landing.tick) / 2), name: `jump-${index + 1}-airborne` },
              {
                tick: Math.min(expected.progress.finishTick - 1, landing.tick + 24),
                name: `jump-${index + 1}-exit`,
              },
            );
          }
          if (!launches.length) {
            const crossing = events.filter((event) => event.events.some((item) => item.type === 'island'))[1];
            if (crossing) moments.push({ tick: crossing.tick, name: 'ground-turn' });
          }
          for (const moment of moments.sort((left, right) => left.tick - right.tick)) {
            await page.waitForFunction(
              (tick) => {
                if ((window.__wwmRace?.debugState().tick ?? 0) >= tick && window.__WWM_RACE_TEST__) {
                  window.__WWM_RACE_TEST__.timeScale = 0.001;
                  return true;
                }
                return false;
              },
              moment.tick,
              { timeout: 60000 },
            );
            const reviewState = await page.evaluate(() => window.__wwmRace?.debugState());
            expect(reviewState?.phase).toBe('racing');
            if (moment.name.endsWith('airborne')) {
              expect(reviewState?.mechanics?.launches).toBeGreaterThan(reviewState?.mechanics?.landings ?? 0);
            }
            if (SHOTS) {
              mkdirSync(SHOTS, { recursive: true });
              await page.screenshot({ path: join(SHOTS, `stunts-${route}-${moment.name}.png`) });
            }
            await page.evaluate(
              (speed) => {
                if (window.__WWM_RACE_TEST__) window.__WWM_RACE_TEST__.timeScale = speed;
              },
              moment.name.endsWith('approach') || moment.name.endsWith('airborne') ? 1 : 4,
            );
          }
          await page.getByTestId('race-finished').waitFor({ timeout: 60000 });
          const first = await page.evaluate(() => window.__wwmRace?.debugState());
          expect(first?.progress).toEqual(expected.progress);
          expect(first?.mechanics?.launches).toBe(expected.mechanics.launches);
          expect(first?.mechanics?.landings).toBe(expected.mechanics.landings);
          expect(first?.newBest).toBe(true);
          if (SHOTS) {
            mkdirSync(SHOTS, { recursive: true });
            await page.screenshot({ path: join(SHOTS, `stunts-${route}-finish.png`) });
          }
          await expect
            .poll(async () => (await page.evaluate(() => window.__wwmRace?.debugState()))?.recent.length, {
              timeout: 10000,
            })
            .toBe(1);
          if (route === 'far') {
            const flags = await page.evaluate(() => {
              const recording = window.__wwmRace?.debugState().result?.recording;
              if (!recording) return null;
              const view = new DataView(recording.data);
              let turboCount = 0;
              for (let i = 0; i < recording.ticks; i++) if (view.getUint8(i * 25 + 24) & 4) turboCount++;
              return { format: recording.format, turboCount };
            });
            expect(flags).toEqual({
              format: 'wwm.race-input/2',
              turboCount: fixture.inputs.filter((input) => input.turbo).length,
            });
            await page.reload();
            await page.getByTestId('race-ready').waitFor({ timeout: 30000 });
            expect(await page.evaluate(() => window.__wwmRace?.debugState().best?.id)).toBe(
              first?.result?.id,
            );
            await page.getByTestId('race-start').click();
            await expect
              .poll(async () => (await page.evaluate(() => window.__wwmRace?.debugState()))?.ghostCount, {
                timeout: 30000,
              })
              .toBe(1);
            await page.getByTestId('race-finished').waitFor({ timeout: 60000 });
            const second = await page.evaluate(() => window.__wwmRace?.debugState());
            expect(second?.progress).toEqual(first?.progress);
            expect(second?.ball).toEqual(first?.ball);
            expect(second?.ghostError).toBe(false);
            // Switch from the fixture to real UI controls after earning charge.
            await page.getByTestId('race-retry').click();
            await page.waitForFunction(() => window.__wwmRace?.debugState().mechanics?.ready, null, {
              timeout: 30000,
            });
            await page.evaluate(() => {
              window.__WWM_RACE_TEST__?.inputs?.splice(window.__wwmRace?.debugState().tick ?? 0);
            });
            await page.getByTestId('race-turbo').click();
            await page.waitForFunction(() => (window.__wwmRace?.debugState().mechanics?.turboTicks ?? 0) > 0);
            expect(await page.getByTestId('race-turbo').isDisabled()).toBe(true);
          }
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }, 180000);
  test('real ArrowUp earns turbo, keyboard T spends it once, and mobile course instructions fit', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
    try {
      // Only shorten countdown and rendering quality. Movement and turbo use actual keyboard events.
      await context.addInitScript(() =>
        Object.assign(window, {
          __WWM_RACE_TEST__: { countdownSec: 0.01, quality: 'low', noAutoPause: true },
        }),
      );
      const page = await context.newPage();
      // Course rebuilds must not reload an in-progress acceptance run.
      await page.routeWebSocket(
        (url) => url.host === new URL(BASE ?? 'http://localhost').host && url.pathname === '/',
        () => {},
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${BASE}/race/island-leap`);
      await page.getByTestId('race-ready').waitFor({ timeout: 30000 });
      await page.getByTestId('race-start').click();
      await page.waitForFunction(() => window.__wwmRace?.debugState().phase === 'racing');
      await page.keyboard.down('ArrowUp');
      await page.waitForFunction(() => window.__wwmRace?.debugState().mechanics?.ready, null, {
        timeout: 20000,
      });
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, 'stunts-keyboard-charged.png') });
      }
      await page.keyboard.press('KeyT');
      await page.waitForFunction(() => (window.__wwmRace?.debugState().mechanics?.turboTicks ?? 0) > 0);
      expect(await page.getByTestId('race-turbo').isDisabled()).toBe(true);
      const beforeTurn = await page.evaluate(() => window.__wwmRace?.debugState().ball?.pos);
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(300);
      await page.keyboard.up('ArrowRight');
      const afterTurn = await page.evaluate(() => window.__wwmRace?.debugState().ball?.pos);
      expect(Math.abs((afterTurn?.[2] ?? 0) - (beforeTurn?.[2] ?? 0))).toBeGreaterThan(0.05);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, 'stunts-keyboard-steering.png') });
      await page.keyboard.up('ArrowUp');
      await page.keyboard.press('Escape');
      await page.getByTestId('race-paused').waitFor();
      expect(errors).toEqual([]);
      await context.close();
      const mobile = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: 'en-US',
      });
      try {
        const narrow = await mobile.newPage();
        narrow.on('pageerror', (error) => errors.push(error.message));
        await narrow.goto(`${BASE}/race/island-leap`);
        await narrow.getByTestId('race-ready').waitFor({ timeout: 30000 });
        expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
          true,
        );
        const start = await narrow.getByTestId('race-start').boundingBox();
        expect(start?.height).toBeGreaterThanOrEqual(44);
        if (SHOTS) await narrow.screenshot({ path: join(SHOTS, 'stunts-ready-mobile.png') });
      } finally {
        await mobile.close();
      }
    } finally {
      await context.close();
      await browser.close();
    }
  }, 60000);
  test('a weak launch lands on the lower catch and returns via ramps without a reset', async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL('../../../fixtures/race/island-leap/recovery-inputs.json', import.meta.url),
        'utf8',
      ),
    ) as { inputs: RaceInputSample[] };
    const expected = JSON.parse(
      readFileSync(
        new URL('../../../fixtures/race/island-leap/recovery-validation.json', import.meta.url),
        'utf8',
      ),
    );
    const events = expected.events as { tick: number; events: { type: string; islandId?: number }[] }[];
    const catchTick = events.find((event) =>
      event.events.some((item) => item.type === 'island' && item.islandId === 7),
    )?.tick;
    const groundTick = events.find((event) =>
      event.events.some((item) => item.type === 'island' && item.islandId === 4),
    )?.tick;
    expect(catchTick).toBeDefined();
    expect(groundTick).toBeGreaterThan(catchTick ?? 0);
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
    try {
      await context.addInitScript(
        (inputs) =>
          Object.assign(window, {
            __WWM_RACE_TEST__: {
              inputs,
              countdownSec: 0.01,
              timeScale: 4,
              noAutoPause: true,
              quality: 'low',
            },
          }),
        fixture.inputs,
      );
      const page = await context.newPage();
      // Course rebuilds must not reload an in-progress acceptance run.
      await page.routeWebSocket(
        (url) => url.host === new URL(BASE ?? 'http://localhost').host && url.pathname === '/',
        () => {},
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${BASE}/race/island-leap`);
      await page.getByTestId('race-ready').waitFor({ timeout: 30000 });
      await page.getByTestId('race-start').click();
      for (const moment of [
        { tick: (catchTick ?? 0) + 48, name: 'catch' },
        { tick: (groundTick ?? 0) - 100, name: 'return-ramp' },
      ]) {
        await page.waitForFunction(
          (tick) => {
            if ((window.__wwmRace?.debugState().tick ?? 0) >= tick && window.__WWM_RACE_TEST__) {
              window.__WWM_RACE_TEST__.timeScale = 0.001;
              return true;
            }
            return false;
          },
          moment.tick,
          { timeout: 60000 },
        );
        expect(await page.evaluate(() => window.__wwmRace?.debugState().progress.reasons)).toEqual([]);
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true });
          await page.screenshot({ path: join(SHOTS, `stunts-recovery-${moment.name}.png`) });
        }
        await page.evaluate(() => {
          if (window.__WWM_RACE_TEST__) window.__WWM_RACE_TEST__.timeScale = 4;
        });
      }
      await page.getByTestId('race-finished').waitFor({ timeout: 60000 });
      const finished = await page.evaluate(() => window.__wwmRace?.debugState());
      expect(finished?.progress).toEqual(expected.progress);
      expect(finished?.result?.recording.recoveries).toEqual([]);
      expect(finished?.mechanics?.launches).toBe(expected.mechanics.launches);
      expect(finished?.mechanics?.landings).toBe(expected.mechanics.landings);
      expect(finished?.newBest).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  }, 90000);
});
