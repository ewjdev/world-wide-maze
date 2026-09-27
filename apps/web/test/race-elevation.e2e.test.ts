/** Ordinary recorded inputs drive the same Rapier/session/HUD as a player; no pose or inventory injection. */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RaceCourse, RaceInputSample } from '@wwm/race';
import { describe, expect, test } from 'vitest';

const BASE = process.env.WWM_RACE_E2E_BASE;
const SHOTS = process.env.WWM_RACE_SHOTS;
const run = BASE ? describe : describe.skip;

run('Race elevation browser acceptance', () => {
  test('a real descent disables charging, grounded exit restarts it, and desktop/mobile HUD explain the rule', async () => {
    const course = JSON.parse(
      readFileSync(new URL('../../../fixtures/race/flow-delta/course.json', import.meta.url), 'utf8'),
    ) as RaceCourse;
    expect(course.physicsProfile).toBe('elevation-v1');
    const { inputs } = JSON.parse(
      readFileSync(new URL('../../../fixtures/race/flow-delta/route-0-inputs.json', import.meta.url), 'utf8'),
    ) as { inputs: RaceInputSample[] };
    const expected = JSON.parse(
      readFileSync(
        new URL('../../../fixtures/race/flow-delta/route-0-validation.json', import.meta.url),
        'utf8',
      ),
    );
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
    const errors: string[] = [];
    try {
      await context.addInitScript((stream: RaceInputSample[]) => {
        Object.assign(window, {
          __WWM_RACE_TEST__: {
            inputs: stream,
            countdownSec: 0.01,
            timeScale: 3,
            noAutoPause: true,
            quality: 'low',
          },
        });
      }, inputs);
      const page = await context.newPage();
      await page.routeWebSocket(
        (url) => url.host === new URL(BASE ?? 'http://localhost').host && url.pathname === '/',
        () => {},
      );
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${BASE}/race/flow-delta`);
      await page.getByTestId('race-start').waitFor({ timeout: 30000 });
      expect(await page.getByTestId('race-ready').textContent()).toContain(
        'Downhill and airborne travel reset',
      );
      await page.getByTestId('race-start').click();
      await page.waitForFunction(
        () => {
          const state = window.__wwmRace?.debugState();
          if (state?.mechanics?.chargingReason !== 'downhill') return false;
          if (window.__WWM_RACE_TEST__) window.__WWM_RACE_TEST__.timeScale = 0;
          return true;
        },
        undefined,
        { timeout: 90000 },
      );
      // The HUD publishes at 80 ms. Freeze time, not the underlying physics state, for inspection.
      await page.waitForTimeout(150);
      const downhill = await page.evaluate(() => window.__wwmRace?.debugState());
      expect(downhill?.mechanics).toMatchObject({ chargingReason: 'downhill', chargeTicks: 0, lives: 3 });
      expect(downhill?.ball?.grounded).toBe(true);
      expect(await page.getByTestId('race-charging-reason').textContent()).toBe('Downhill · no charge');
      expect(await page.getByTestId('race-speed').textContent()).toMatch(/\d+\.\d m\/s/);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, 'elevation-downhill-desktop.png') });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.getByTestId('race-charging-reason').isVisible()).toBe(true);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, 'elevation-downhill-mobile.png') });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => {
        if (window.__WWM_RACE_TEST__) window.__WWM_RACE_TEST__.timeScale = 3;
      });
      await page.waitForFunction(
        (after) => {
          const state = window.__wwmRace?.debugState();
          if (
            !state ||
            state.tick <= after ||
            state.mechanics?.chargingReason !== 'charging' ||
            state.mechanics.chargeTicks <= 0
          )
            return false;
          if (window.__WWM_RACE_TEST__) window.__WWM_RACE_TEST__.timeScale = 0;
          return true;
        },
        downhill?.tick ?? 0,
        { timeout: 90000 },
      );
      await page.waitForTimeout(150);
      const resumed = await page.evaluate(() => window.__wwmRace?.debugState());
      expect(resumed?.ball?.grounded).toBe(true);
      expect(resumed?.mechanics?.chargeTicks).toBeGreaterThan(0);
      expect(resumed?.mechanics?.chargeTicks).toBeLessThan(360);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, 'elevation-charge-resumed.png') });
      await page.evaluate(() => {
        if (window.__WWM_RACE_TEST__) window.__WWM_RACE_TEST__.timeScale = 3;
      });
      await page.getByTestId('race-finished').waitFor({ timeout: 180000 });
      const finished = await page.evaluate(() => window.__wwmRace?.debugState());
      expect(finished?.courseId).toBe(expected.courseId);
      expect(finished?.progress).toEqual(expected.progress);
      expect(finished?.mechanics).toEqual(expected.mechanics);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  }, 300000);
});
