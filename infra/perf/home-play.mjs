/** Opt-in, source-bound headed home performance probe. */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareOutput, verifyHomeBuild } from './home-common.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const out = prepareOutput();
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4318';
const servedBuild = await verifyHomeBuild(base);
const stat = (a) => {
  const s = [...a].sort((a, b) => a - b);
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)],
    p99: s[Math.floor(s.length * 0.99)],
    max: s.at(-1),
  };
};
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
const report = {
  when: new Date().toISOString(),
  browser: browser.version(),
  url: new URL('/play/fixture-hn-front?offline=1', base).href,
  servedBuild,
  note: 'Same 8-second scripted arrow cycle per run after 3-second settle, skip intro/no autopause, muted, DPR2. CDP CPU throttle applied after stage compilation. Direction changes and event observers are diagnostic; this is not deterministic replay or physical-device acceptance.',
  runs: [],
};
const save = () => writeFileSync(`${out}/play.json`, JSON.stringify(report, null, 2));
const allSpecs = [
  { name: 'play-auto-native', quality: 'auto', cpu: 1 },
  { name: 'play-low-native', quality: 'low', cpu: 1 },
  { name: 'play-auto-cpu6', quality: 'auto', cpu: 6 },
  { name: 'play-low-cpu6', quality: 'low', cpu: 6 },
];
const specs = process.env.AUDIT_CASES
  ? allSpecs.filter((s) => process.env.AUDIT_CASES.split(',').includes(s.name))
  : allSpecs;
try {
  for (let repeat = 0; repeat < Number(process.env.AUDIT_REPEATS ?? 3); repeat++)
    for (const spec of repeat % 2 ? [...specs].reverse() : specs) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      await ctx.addInitScript(({ quality }) => {
        localStorage.setItem('wwm.analytics.preference', 'off');
        localStorage.setItem('wwm.howtoSeen', '1');
        localStorage.setItem('wwm.tutorialDone', '1');
        localStorage.setItem('wwm.muted', '1');
        window.__WWM_TEST__ = { skipIntro: true, noAutoPause: true, quality };
      }, spec);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Performance.enable');
      await page.goto(report.url);
      await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play', { timeout: 90000 });
      await page.waitForTimeout(3000);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: spec.cpu });
      await page.evaluate(() => {
        window.__play = {
          at: performance.now(),
          cpu: [],
          frames: [],
          long: [],
          events: [],
          inputs: [],
        };
        const p = window.__play;
        new PerformanceObserver((l) =>
          p.long.push(...l.getEntries().map((x) => ({ at: x.startTime, ms: x.duration }))),
        ).observe({ type: 'longtask' });
        new PerformanceObserver((l) =>
          p.events.push(
            ...l.getEntries().map((e) => ({
              name: e.name,
              id: e.interactionId,
              at: e.startTime,
              ms: e.duration,
              processingStart: e.processingStart,
              processingEnd: e.processingEnd,
            })),
          ),
        ).observe({ type: 'event', durationThreshold: 16 });
        let last;
        window.__active = true;
        function tick(t) {
          if (last !== undefined) p.frames.push(t - last);
          last = t;
          if (window.__active) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        const e = window.__wwmGame.engine,
          orig = e.frame;
        e.frame = function (...args) {
          const at = performance.now();
          orig.apply(this, args);
          p.cpu.push(performance.now() - at);
        };
        addEventListener(
          'keydown',
          (e) => {
            const shot = { code: e.code, at: performance.now() };
            p.inputs.push(shot);
            requestAnimationFrame(() => (shot.nextFrame = performance.now()));
          },
          { capture: true },
        );
      });
      const before = Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]),
      );
      const start = Date.now();
      const samples = [];
      await page.keyboard.down('Space');
      for (let i = 0; i < 8; i++) {
        const key = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'][i % 4];
        await page.keyboard.down(key);
        await page.waitForTimeout(1000);
        await page.keyboard.up(key);
        samples.push(await page.evaluate(() => window.__wwmGame.debugState()));
      }
      await page.keyboard.up('Space');
      const elapsed = Date.now() - start;
      const after = Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]),
      );
      const data = await page.evaluate(() => {
        window.__active = false;
        return {
          raw: window.__play,
          state: window.__wwmGame.debugState(),
          memory: window.__wwmGame.engine.debug().renderer.info.memory,
        };
      });
      const result = {
        spec,
        repeat,
        elapsedMs: elapsed,
        errors,
        samples,
        ...data,
        frame: stat(data.raw.frames),
        engineCpuMs: stat(data.raw.cpu),
        mainThreadBusyPct: (100 * (after.TaskDuration - before.TaskDuration)) / (elapsed / 1000),
      };
      report.runs.push(result);
      save();
      console.log(
        JSON.stringify({
          name: spec.name,
          repeat,
          fps: 1000 / result.frame.mean,
          frame: result.frame,
          cpu: result.engineCpuMs,
          busy: result.mainThreadBusyPct,
          phases: [...new Set(samples.map((s) => s.phase))],
          tiers: [...new Set(samples.map((s) => s.engine.tier))],
          inputs: data.raw.inputs,
          events: data.raw.events,
          errors,
        }),
      );
      await ctx.close();
    }
} finally {
  save();
  await browser.close();
}
