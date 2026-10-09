/** Early Start -> first controlled fixture, including allocation peaks and phase handoff. */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareOutput, stats, verifyHomeBuild } from './home-common.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const out = prepareOutput();
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4318';
const servedBuild = await verifyHomeBuild(base);
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
const report = { at: new Date().toISOString(), servedBuild, browser: browser.version(), runs: [] };
const save = () => writeFileSync(`${out}/start-control.json`, JSON.stringify(report, null, 2));
const specs = [
  { name: 'desktop-native', viewport: { width: 1440, height: 900 }, cpu: 1 },
  { name: 'desktop-cpu6-10Mbps', viewport: { width: 1440, height: 900 }, cpu: 6, mbps: 10, latency: 100 },
  { name: 'mobile-cpu6-1.6Mbps', viewport: { width: 390, height: 844 }, cpu: 6, mbps: 1.6, latency: 150 },
].filter((s) => !process.env.AUDIT_CASES || process.env.AUDIT_CASES.split(',').includes(s.name));

try {
  for (const spec of specs)
    for (let repeat = 0; repeat < Number(process.env.AUDIT_REPEATS ?? 3); repeat++) {
      const ctx = await browser.newContext({ viewport: spec.viewport, deviceScaleFactor: 2 });
      await ctx.addInitScript(() => {
        localStorage.setItem('wwm.analytics.preference', 'off');
        localStorage.setItem('wwm.howtoSeen', '1');
        localStorage.setItem('wwm.tutorialDone', '1');
        window.__WWM_TEST__ = { skipIntro: true, noAutoPause: true };
        const p = (window.__homeControl = { phases: [], samples: [], frames: 0, dimensions: [], events: [] });
        for (const name of ['width', 'height']) {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name);
          Object.defineProperty(HTMLCanvasElement.prototype, name, {
            ...descriptor,
            set(value) {
              descriptor.set.call(this, value);
              p.dimensions.push({ at: performance.now(), width: this.width, height: this.height });
            },
          });
        }
        new PerformanceObserver((list) =>
          p.events.push(
            ...list.getEntries().map((e) => ({ at: e.startTime, name: e.name, duration: e.duration })),
          ),
        ).observe({ type: 'event', durationThreshold: 16 });
        let game;
        Object.defineProperty(window, '__wwmGame', {
          configurable: true,
          get: () => game,
          set(g) {
            game = g;
            if (!g) return;
            let phase, engine;
            const snapshot = () => {
              const v = g.getView();
              if (v.phase !== phase) {
                phase = v.phase;
                p.phases.push({ at: performance.now(), phase });
              }
              if (g.engine && g.engine !== engine) {
                engine = g.engine;
                p.initialTier = engine.stats().tier;
                const frame = engine.frame;
                engine.frame = function (...args) {
                  frame.apply(this, args);
                  p.frames++;
                };
              }
              if (engine)
                p.samples.push({
                  at: performance.now(),
                  phase,
                  bytes: engine.debug().renderer.info.memory.total ?? null,
                  stats: engine.stats(),
                });
              if (phase === 'play' && !p.playAt) {
                // The game's engine frame follows its phase transition inside the same rAF.
                requestAnimationFrame(() => {
                  p.playAt ??= performance.now();
                });
              }
            };
            g.subscribe(snapshot);
            setInterval(snapshot, 100);
            snapshot();
          },
        });
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await ctx.route('**/api/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: spec.cpu });
      if (spec.mbps)
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: spec.latency,
          downloadThroughput: spec.mbps * 125000,
          uploadThroughput: spec.mbps * 125000,
          connectionType: 'cellular4g',
        });
      await page.goto(`${base}/?offline=1`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('start').waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-testid=start]').disabled);
      await page.evaluate(() => {
        window.__homeControl.startAt = performance.now();
      });
      await page.getByTestId('start').click({ force: true });
      await page.waitForFunction(
        () => window.__wwmGame?.getView().phase !== 'title' && window.__wwmGame?.getView().engineReady,
        { timeout: 90000 },
      );
      // Both arms follow the same keyboard/offline fixture path after acknowledging Start.
      if (await page.getByTestId('howto-go').count()) await page.getByTestId('howto-go').click();
      if (await page.getByTestId('play-keyboard').count()) await page.getByTestId('play-keyboard').click();
      await page.getByTestId('site-practice').click();
      await page.waitForFunction(() => window.__homeControl.playAt, { timeout: 90000 });
      await page.keyboard.down('Space');
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(150);
      const controlled = await page.evaluate(() => ({
        at: performance.now(),
        control: window.__wwmGame.engine.debug().scene !== null,
        state: window.__wwmGame.debugState(),
        probe: window.__homeControl,
      }));
      await page.keyboard.up('ArrowUp');
      await page.keyboard.up('Space');
      report.runs.push({
        spec,
        repeat,
        errors,
        ...controlled,
        navigationToPlayMs: controlled.probe.playAt,
        startToPlayMs: controlled.probe.playAt - controlled.probe.startAt,
        sampledPeakBytes: Math.max(...controlled.probe.samples.map((s) => s.bytes ?? 0)),
      });
      save();
      console.log(
        JSON.stringify({
          name: spec.name,
          repeat,
          navigationToPlayMs: controlled.probe.playAt,
          startToPlayMs: controlled.probe.playAt - controlled.probe.startAt,
          initialTier: controlled.probe.initialTier,
          peakMiB: report.runs.at(-1).sampledPeakBytes / 1048576,
          errors,
        }),
      );
      await ctx.close();
    }
  report.summary = specs.map((spec) => ({
    name: spec.name,
    navigationToPlayMs: stats(
      report.runs.filter((r) => r.spec.name === spec.name).map((r) => r.navigationToPlayMs),
    ),
    startToPlayMs: stats(report.runs.filter((r) => r.spec.name === spec.name).map((r) => r.startToPlayMs)),
  }));
} finally {
  save();
  await browser.close();
}
