/** Local production-build audit. No API writes; offline fixtures, analytics off. */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyServedBuild } from './p1-build.mjs';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4318';
const out = process.env.AUDIT_OUT
  ? pathToFileURL(`${resolve(process.env.AUDIT_OUT)}/`)
  : new URL('../../docs/launch/evidence/audit-2026-09-27/', import.meta.url);
mkdirSync(out, { recursive: true });
const mode = process.argv[2] ?? 'frames';
// Explicit historical identity permits an A/B diagnostic against preserved built
// assets. Every served byte is still verified; candidates use current source.
const historical = process.env.AUDIT_BASELINE_RECORD
  ? JSON.parse(readFileSync(process.env.AUDIT_BASELINE_RECORD, 'utf8'))
  : null;
const expected = historical?.runtimeFingerprint ?? runtimeFingerprint();
const servedBuild = await verifyServedBuild(base, expected);
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
const root = await browser.newBrowserCDPSession();
const report = {
  date: new Date().toISOString(),
  runtimeFingerprint: expected,
  historicalSourceRecord: process.env.AUDIT_BASELINE_RECORD ?? null,
  servedBuild,
  base,
  mode,
  browser: browser.version(),
  headless: false,
  viewport: { width: 1440, height: 900 },
  instrumentation: {
    optIn: true,
    phaseSamplesEveryMs: 1000,
    maximumRunSeconds: 60,
    gpuTimestampQueries: mode === 'gpu',
  },
  commit: historical?.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  hardware: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.memsize'], {
    encoding: 'utf8',
  }).trim(),
  system: await root.send('SystemInfo.getInfo'),
  runs: [],
  errors: [],
};
const pageErrors = new WeakMap();
const save = () => writeFileSync(new URL(`${mode}.json`, out), JSON.stringify(report, null, 2));
const stats = (a) => {
  const s = [...a].sort((a, b) => a - b);
  if (s.length === 0)
    return { n: 0, mean: null, p50: null, p95: null, p99: null, max: null, over25: 0, over50: 0 };
  return {
    n: s.length,
    mean: a.reduce((x, y) => x + y, 0) / Math.max(1, a.length),
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)],
    p99: s[Math.floor(s.length * 0.99)],
    max: s.at(-1),
    over25: a.filter((x) => x > 25).length,
    over50: a.filter((x) => x > 50).length,
  };
};
async function processes() {
  const { processInfo } = await root.send('SystemInfo.getProcessInfo');
  return processInfo.map((p) => {
    try {
      return {
        ...p,
        rssKiB: Number(execFileSync('ps', ['-p', String(p.id), '-o', 'rss='], { encoding: 'utf8' }).trim()),
      };
    } catch {
      return p;
    }
  });
}
async function setup(spec) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: spec.dpr ?? 1,
  });
  await ctx.addInitScript(({ quality, replay }) => {
    localStorage.setItem('wwm.analytics.preference', 'off');
    localStorage.setItem('wwm.howtoSeen', '1');
    localStorage.setItem('wwm.tutorialDone', '1');
    window.__WWM_TEST__ = {
      skipIntro: true,
      noAutoPause: true,
      ...(quality ? { quality } : {}),
      ...(replay ? { replay } : {}),
    };
    window.__auditLong = [];
    window.__auditVitals = {};
    new PerformanceObserver((l) =>
      window.__auditLong.push(...l.getEntries().map((e) => ({ at: e.startTime, ms: e.duration }))),
    ).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => {
      window.__auditVitals.lcp = l.getEntries().at(-1)?.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  }, spec);
  // No capture, score, relay, or telemetry calls are part of this audit.
  await ctx.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  const page = await ctx.newPage();
  const errors = [];
  pageErrors.set(page, errors);
  const captureError = (kind, message, location) => {
    errors.push(`${kind}: ${message}`);
    report.errors.push({
      kind,
      message,
      location,
      at: new Date().toISOString(),
      scenario: {
        ref: spec.ref,
        path: spec.path,
        quality: spec.quality,
        dpr: spec.dpr ?? 1,
        throttle: spec.throttle ?? spec.coldThrottle ?? 1,
        backend: spec.backend,
        learn: spec.learn,
        replay: !!spec.replay,
      },
    });
  };
  page.on('pageerror', (error) => captureError('pageerror', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') captureError('consoleerror', message.text(), message.location());
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (spec.coldThrottle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: spec.coldThrottle });
  const begin = Date.now();
  await page.goto(
    `${base}${spec.path ?? `/play/${spec.ref ?? 'practice'}`}?offline=1${spec.backend === 'webgl2' ? '&backend=webgl' : ''}${spec.learn ? '&learn=compare-groups' : ''}`,
  );
  await page.waitForFunction(
    () =>
      window.__wwmGame?.engine &&
      (window.__wwmGame.debugState().phase === 'play' || window.__wwmGame.debugState().phase === 'title'),
    null,
    { timeout: 90000 },
  );
  const loadMs = Date.now() - begin;
  await page.waitForTimeout(1500);
  if (spec.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: spec.throttle });
  return { ctx, page, cdp, errors, loadMs };
}
async function snapshot(page, cdp, gc = false) {
  if (gc) await cdp.send('HeapProfiler.collectGarbage');
  return {
    errors: [...(pageErrors.get(page) ?? [])],
    metrics: Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]),
    ),
    dom: await cdp.send('Memory.getDOMCounters'),
    heap: await cdp.send('Runtime.getHeapUsage'),
    processes: await processes(),
    game: await page.evaluate(() => {
      const g = window.__wwmGame;
      const r = g.engine.debug().renderer;
      return {
        state: g.debugState(),
        rendererMemory: { ...r.info.memory },
        canvas: { width: r.domElement.width, height: r.domElement.height },
        deviceFeatures: r.backend.device ? [...r.backend.device.features] : null,
        visibility: document.visibilityState,
      };
    }),
  };
}
async function record(page, cdp, seconds, drive = false, profile = false) {
  const before = await snapshot(page, cdp);
  if (profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
  }
  await page.evaluate(() => {
    const engine = window.__wwmGame.engine;
    window.__auditFrames = [];
    window.__auditRender = [];
    window.__auditStart = performance.now();
    window.__originalFrame = engine.frame;
    engine.frame = function (...args) {
      const t = performance.now();
      const result = window.__originalFrame.apply(this, args);
      window.__auditRender.push(performance.now() - t);
      return result;
    };
    window.__auditActive = true;
    let last;
    function tick(t) {
      if (last !== undefined) window.__auditFrames.push(t - last);
      last = t;
      if (window.__auditActive) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  const samples = [];
  if (drive) await page.keyboard.down('Space');
  for (let i = 0; i < seconds; i++) {
    const key = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'][i % 4];
    if (drive) await page.keyboard.down(key);
    await page.waitForTimeout(1000);
    if (drive) await page.keyboard.up(key);
    samples.push(await page.evaluate(() => window.__wwmGame.debugState()));
  }
  if (drive) await page.keyboard.up('Space');
  const elapsedMs = Date.now() - t0;
  const data = await page.evaluate(() => {
    window.__auditActive = false;
    window.__wwmGame.engine.frame = window.__originalFrame;
    return {
      frames: window.__auditFrames,
      render: window.__auditRender,
      longTasks: window.__auditLong.filter((x) => x.at >= window.__auditStart),
      vitals: window.__auditVitals,
    };
  });
  const after = await snapshot(page, cdp);
  let cpuProfile;
  if (profile) cpuProfile = (await cdp.send('Profiler.stop')).profile;
  const taskMs = (after.metrics.TaskDuration - before.metrics.TaskDuration) * 1000;
  return {
    errors: [...(pageErrors.get(page) ?? [])],
    elapsedMs,
    frame: stats(data.frames),
    engineCpuMs: stats(data.render),
    fps: 1000 / stats(data.frames).mean,
    taskMs,
    mainThreadBusyPct: (100 * taskMs) / elapsedMs,
    samples,
    before,
    after,
    longTasks: data.longTasks,
    vitals: data.vitals,
    cpuProfile,
  };
}
try {
  if (mode === 'frames') {
    const specs = [
      ...[
        'practice',
        'fixture-hn-front',
        'fixture-govuk-card-grid',
        'fixture-mdn-dark-docs',
        'fixture-image-gallery',
        'fixture-wikipedia-article~3',
      ].map((ref) => ({ ref, seconds: 12, drive: true })),
      { ref: 'fixture-wikipedia-article~3', dpr: 2, seconds: 16, drive: true },
      { ref: 'fixture-wikipedia-article~3', throttle: 6, seconds: 20, drive: true, profile: true },
      { ref: 'practice', throttle: 20, seconds: 20, drive: true },
      { ref: 'practice', backend: 'webgl2', dpr: 2, seconds: 16, drive: true },
      { ref: 'practice', quality: 'low', dpr: 2, seconds: 12, drive: true },
      { path: '/', seconds: 12 },
    ];
    // Partial diagnostic reports intentionally cannot pass the full-scenario gate.
    const selected = process.env.AUDIT_FRAME_THROTTLE
      ? specs.filter((spec) => String(spec.throttle) === process.env.AUDIT_FRAME_THROTTLE)
      : specs;
    if (!selected.length) throw new Error('No matching frame diagnostic scenario');
    if (process.env.AUDIT_FRAME_THROTTLE)
      report.diagnosticSelection = { frameThrottle: process.env.AUDIT_FRAME_THROTTLE };
    if (process.env.AUDIT_TOUR_SECONDS) {
      const seconds = Number(process.env.AUDIT_TOUR_SECONDS);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60)
        throw new Error('AUDIT_TOUR_SECONDS must be an integer from 1 to 60');
      for (const spec of selected.filter((s) => s.ref && !s.throttle && !s.backend && !s.quality && !s.dpr))
        spec.seconds = seconds;
    }
    if (process.env.AUDIT_SECONDS) {
      const seconds = Number(process.env.AUDIT_SECONDS);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60)
        throw new Error('AUDIT_SECONDS must be an integer from 1 to 60');
      for (const spec of selected) spec.seconds = seconds;
    }
    for (const spec of selected) {
      let ctx;
      try {
        const run = await setup(spec);
        ctx = run.ctx;
        const result = await record(run.page, run.cdp, spec.seconds, spec.drive, spec.profile);
        if (result.cpuProfile) {
          writeFileSync(new URL('cpu-throttle6.cpuprofile', out), JSON.stringify(result.cpuProfile));
          delete result.cpuProfile;
        }
        report.runs.push({ spec, loadMs: run.loadMs, errors: run.errors, ...result });
        console.log(
          JSON.stringify({
            spec,
            loadMs: run.loadMs,
            fps: result.fps,
            p95: result.frame.p95,
            busy: result.mainThreadBusyPct,
            tiers: [...new Set(result.samples.map((s) => s.engine.tier))],
            phases: [...new Set(result.samples.map((s) => s.phase))],
          }),
        );
      } catch (e) {
        report.runs.push({ spec, error: String(e) });
        console.log(String(e));
      } finally {
        await ctx?.close();
        save();
      }
    }
  } else if (mode === 'idle') {
    const run = await setup({ path: '/' });
    await run.page.waitForTimeout(3000);
    report.runs.push({ name: 'title', ...(await record(run.page, run.cdp, 12)) });
    await run.ctx.close();
  } else if (mode === 'lifecycle') {
    const run = await setup({ ref: 'practice', dpr: 2 });
    const { page, cdp } = run;
    report.runs.push({ name: 'play', ...(await record(page, cdp, 10)) });
    await page.evaluate(() => window.__wwmGame.menu());
    await page.waitForFunction(() => document.body.dataset.phase === 'paused');
    report.runs.push({ name: 'paused', ...(await record(page, cdp, 10)) });
    await page.screenshot({ path: new URL('paused.png', out).pathname });
    await page.evaluate(() => window.__wwmGame.resume());
    report.retries = [];
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => {
        window.__wwmGame.menu();
        window.__wwmGame.retryStage();
      });
      await page.waitForFunction(() => document.body.dataset.phase === 'play');
      await page.waitForTimeout(350);
      report.retries.push(await snapshot(page, cdp, true));
      save();
    }
    // Sample all unique fixture screenshots in one long-lived builder worker.
    report.fixtureLoads = [];
    for (const [slug, height] of [
      ['hn-front', 1214],
      ['wikipedia-article', 6000],
      ['govuk-card-grid', 4550],
      ['mdn-dark-docs', 3671],
      ['image-gallery', 6000],
      ['example-sparse', 800],
      ['hn-front', 1214],
    ]) {
      await page.evaluate(
        ({ slug, height }) => {
          const g = window.__wwmGame;
          g.menu();
          g.askConfirm('search');
          g.confirm(true);
          g.chooseEntry({
            id: `fixture-${slug}`,
            slug,
            title: slug,
            url: 'https://example.com/',
            host: slug,
            stars: 1,
            pageHeight: height,
            thumb: '',
          });
        },
        { slug, height },
      );
      await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 90000 });
      await page.waitForTimeout(800);
      report.fixtureLoads.push({ slug, ...(await snapshot(page, cdp, true)) });
      save();
    }
    const r = await page.evaluate(async () => {
      const renderer = window.__wwmGame.engine.debug().renderer;
      const supported = renderer.backend.device?.features.has('timestamp-query');
      return { supported };
    });
    report.timestampSupport = r;
    await run.ctx.close();
  } else if (mode === 'ghost') {
    const asset = readdirSync(new URL('../../apps/web/dist/assets/', import.meta.url)).find((x) =>
      /^ghost-.*\.js$/.test(x),
    );
    const stage = JSON.parse(
      readFileSync(new URL('../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
    );
    for (const throttle of [1, 6]) {
      const run = await setup({ ref: 'practice', throttle });
      const { page } = run;
      const result = await page.evaluate(
        async ({ asset, stage }) => {
          const module = await import(`/assets/${asset}`);
          const recordGhost = Object.values(module).find(
            (x) => typeof x === 'function' && x.constructor.name === 'AsyncFunction',
          );
          if (!recordGhost) throw new Error('Inspect built ghost exports after bundler changes');
          const inputs = Array.from({ length: 36000 }, () => ({
            tiltX: 0,
            tiltZ: 0,
            frameYaw: 0,
            power: false,
            jump: false,
          }));
          const start = performance.now();
          const track = await recordGhost(stage, inputs);
          const ms = performance.now() - start;
          await new Promise((resolve) => setTimeout(resolve, 100));
          return {
            ms,
            ticks: track.ticks,
            bytes: track.pos.byteLength + track.quat.byteLength,
            longTasks: window.__auditLong.filter((x) => x.at >= start),
          };
        },
        { asset, stage },
      );
      report.runs.push({ throttle, asset, ...result });
      console.log(JSON.stringify(report.runs.at(-1)));
      save();
      await run.ctx.close();
    }
  } else if (mode === 'learning') {
    const run = await setup({ ref: 'practice', learn: true, dpr: 2 });
    report.runs.push({ name: 'learning-play', ...(await record(run.page, run.cdp, 15, true)) });
    await run.page.screenshot({ path: new URL('learning.png', out).pathname });
    await run.ctx.close();
  } else if (mode === 'gpu') {
    for (const quality of ['high', 'medium', 'low']) {
      const run = await setup({ ref: 'practice', dpr: 2, quality });
      const { page, cdp } = run;
      const supported = await page.evaluate(() =>
        window.__wwmGame.engine.debug().renderer.backend.device?.features.has('timestamp-query'),
      );
      if (supported) {
        await page.evaluate(() => {
          const e = window.__wwmGame.engine,
            r = e.debug().renderer;
          const original = e.frame;
          r.backend.trackTimestamp = true;
          window.__gpuSamples = [];
          let pending = false;
          e.frame = function (...args) {
            original.apply(this, args);
            if (!pending) {
              pending = true;
              r.resolveTimestampsAsync('render')
                .then((ms) => window.__gpuSamples.push(ms))
                .finally(() => (pending = false));
            }
          };
        });
      }
      const result = await record(page, cdp, 10);
      const gpu = await page.evaluate(() => window.__gpuSamples ?? []);
      report.runs.push({ quality, supported, gpuMs: stats(gpu), ...result });
      console.log(
        JSON.stringify({ quality, supported, gpuMs: stats(gpu), memory: result.after.game.rendererMemory }),
      );
      save();
      if (quality === 'high') {
        await page.evaluate(() => {
          window.__wwmGame.engine.setQuality('low');
          window.__gpuSamples = [];
        });
        const lowered = await record(page, cdp, 8);
        report.runs.push({
          quality: 'high-to-low',
          supported,
          gpuMs: stats(await page.evaluate(() => window.__gpuSamples ?? [])),
          ...lowered,
        });
        save();
      }
      await run.ctx.close();
    }
  } else if (mode === 'stall') {
    const run = await setup({ ref: 'practice' });
    const { page, cdp } = run;
    await page.evaluate(() => {
      const e = window.__wwmGame.engine,
        original = e.frame;
      window.__stall = true;
      e.frame = function (...args) {
        if (window.__stall) {
          const end = performance.now() + 200;
          while (performance.now() < end) {
            /* calibrated workload, not device emulation */
          }
        }
        return original.apply(this, args);
      };
    });
    report.runs.push({ name: '200ms-main-thread-stall', ...(await record(page, cdp, 14)) });
    await page.evaluate(() => {
      window.__stall = false;
    });
    report.runs.push({ name: 'recovery', ...(await record(page, cdp, 30)) });
    await run.ctx.close();
  } else if (mode === 'cold') {
    for (const coldThrottle of [1, 6]) {
      const run = await setup({ ref: 'practice', coldThrottle });
      report.runs.push({
        coldThrottle,
        loadMs: run.loadMs,
        ...(await snapshot(run.page, run.cdp)),
        startup: await run.page.evaluate(() => ({
          longTasks: window.__auditLong,
          vitals: window.__auditVitals,
          resources: performance.getEntriesByType('resource').map((r) => ({
            name: new URL(r.name).pathname,
            encoded: r.encodedBodySize,
            decoded: r.decodedBodySize,
            duration: r.duration,
          })),
        })),
      });
      save();
      await run.ctx.close();
    }
  } else if (mode === 'replay') {
    const replay = JSON.parse(
      readFileSync(new URL('../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
    );
    for (const throttle of [1, 6, 20]) {
      const run = await setup({ replay, ref: 'practice', throttle });
      const result = await record(run.page, run.cdp, 60, false, throttle === 6);
      if (result.cpuProfile) {
        writeFileSync(new URL('cpu-replay.cpuprofile', out), JSON.stringify(result.cpuProfile));
        delete result.cpuProfile;
      }
      report.runs.push({ throttle, loadMs: run.loadMs, ...result });
      save();
      await run.ctx.close();
    }
  }
} finally {
  save();
  await browser.close();
  save();
}
