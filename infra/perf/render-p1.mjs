/** Renderer P1 paired probes, derived from audit-2026-09. No API writes; offline fixtures, analytics off. */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4321';
const out = new URL(
  `../../docs/launch/evidence/render-p1/${process.env.PERF_LABEL ?? 'baseline'}/`,
  import.meta.url,
);
mkdirSync(out, { recursive: true });
const mode = process.argv[2] ?? 'frames';
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
const root = await browser.newBrowserCDPSession();
const report = {
  date: new Date().toISOString(),
  base,
  mode,
  browser: browser.version(),
  headless: false,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  hardware: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.memsize'], {
    encoding: 'utf8',
  }).trim(),
  system: await root.send('SystemInfo.getInfo'),
  runs: [],
};
delete report.system.commandLine;
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
    viewport: spec.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
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
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (spec.coldThrottle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: spec.coldThrottle });
  const begin = Date.now();
  await page.goto(
    `${base}${spec.path ?? `/play/${spec.ref ?? 'practice'}`}?offline=1${(spec.backend ?? process.env.PERF_BACKEND) === 'webgl2' ? '&backend=webgl' : ''}${spec.learn ? '&learn=compare-groups' : ''}`,
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
  await page.evaluate((measureTransitions) => {
    const engine = window.__wwmGame.engine;
    window.__tierTransitions = [];
    let lastTier = engine.stats().tier;
    window.__auditFrames = [];
    window.__auditRender = [];
    window.__auditStart = performance.now();
    window.__originalFrame = engine.frame;
    engine.frame = function (...args) {
      const t = performance.now();
      const result = window.__originalFrame.apply(this, args);
      window.__auditRender.push(performance.now() - t);
      if (measureTransitions) {
        const state = engine.stats();
        if (state.tier !== lastTier) {
          window.__tierTransitions.push({ elapsedMs: performance.now() - window.__auditStart, ...state });
          lastTier = state.tier;
        }
      }
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
  }, mode === 'stall');
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
      tierTransitions: window.__tierTransitions,
    };
  });
  const after = await snapshot(page, cdp);
  let cpuProfile;
  if (profile) cpuProfile = (await cdp.send('Profiler.stop')).profile;
  const taskMs = (after.metrics.TaskDuration - before.metrics.TaskDuration) * 1000;
  return {
    elapsedMs,
    frame: stats(data.frames),
    engineCpuMs: stats(data.render),
    tierTransitions: data.tierTransitions,
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
    for (const spec of specs) {
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
  } else if (mode === 'recovery') {
    const run = await setup({ quality: 'high', dpr: 2 });
    const before = await snapshot(run.page, run.cdp);
    await run.page.evaluate(() => {
      window.__wwmGame.engine.debug().renderer.onDeviceLost({
        reason: 'unknown',
        message: 'Synthetic loss callback for fallback lifecycle verification',
      });
    });
    await run.page.waitForFunction(() => window.__wwmGame.engine.stats().backend === 'webgl2');
    await run.page.waitForTimeout(1500);
    await run.page.evaluate(() => window.__wwmGame.engine.setQuality('low'));
    await run.page.waitForTimeout(700);
    const after = await snapshot(run.page, run.cdp);
    report.runs.push({ before, after, errors: run.errors, syntheticLossCallback: true });
    if (
      after.game.state.engine.backend !== 'webgl2' ||
      after.game.state.engine.tier !== 3 ||
      run.errors.length
    )
      throw new Error('WebGPU loss fallback/low graph failed');
    await run.ctx.close();
  } else if (mode === 'compile-race') {
    const run = await setup({ quality: 'high', dpr: 2 });
    await run.page.evaluate(() => {
      const g = window.__wwmGame,
        r = g.engine.debug().renderer;
      const original = r.compileAsync;
      r.compileAsync = async function (...args) {
        window.__compileHeld = true;
        await original.apply(this, args);
        await new Promise((resolve) => {
          window.__releaseCompile = resolve;
        });
        r.compileAsync = original;
      };
      g.menu();
      g.retryStage();
    });
    await run.page.waitForFunction(() => !!window.__releaseCompile);
    const held = await run.page.evaluate(() => {
      const e = window.__wwmGame.engine;
      e.setQuality('low');
      e.resize(390, 844);
      return e.stats();
    });
    await run.page.waitForTimeout(150);
    await run.page.evaluate(() => window.__releaseCompile());
    await run.page.waitForFunction(() => window.__wwmGame.debugState().phase === 'play');
    await run.page.waitForTimeout(500);
    const after = await snapshot(run.page, run.cdp);
    report.runs.push({ held, after, errors: run.errors });
    if (after.game.state.engine.tier !== 3 || run.errors.length)
      throw new Error('Pending compile quality/resize failed');
    await run.ctx.close();
  } else if (mode === 'inspect') {
    const run = await setup({ quality: 'high', dpr: 2 });
    await run.page.evaluate(() => window.__wwmGame.engine.setQuality('low'));
    await run.page.waitForTimeout(1500);
    report.runs.push(
      await run.page.evaluate(() => {
        const r = window.__wwmGame.engine.debug().renderer;
        return {
          memory: r.info.memory,
          frameBuffers: [...r._frameBufferTargets.values()].map((t) => ({
            width: t.width,
            height: t.height,
            textures: t.textures.map((x) => ({
              width: x.width,
              height: x.height,
              type: x.type,
              format: x.format,
              bytes: r.info.memoryMap.get(x),
            })),
            depth: t.depthTexture && {
              width: t.depthTexture.width,
              height: t.depthTexture.height,
              bytes: r.info.memoryMap.get(t.depthTexture),
            },
          })),
        };
      }),
    );
    console.log(JSON.stringify(report.runs));
    await run.ctx.close();
  } else if (mode === 'gpu') {
    for (const quality of (process.env.PERF_QUALITIES ?? 'high,medium,low').split(',')) {
      const run = await setup({ ref: 'practice', dpr: 2, quality });
      const { page, cdp } = run;
      const supported = await page.evaluate(
        () =>
          window.__wwmGame.engine.debug().renderer.backend.device?.features.has('timestamp-query') ?? false,
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
      report.runs.push({ quality, supported, gpuMs: stats(gpu), ...result, errors: run.errors });
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
          errors: run.errors,
          supported,
          gpuMs: stats(await page.evaluate(() => window.__gpuSamples ?? [])),
          ...lowered,
        });
        save();
      }
      await run.ctx.close();
    }
    if (process.env.PERF_REQUIRE_IMPROVEMENT) {
      const fresh = report.runs.find((r) => r.quality === 'low').after.game.rendererMemory;
      const lowered = report.runs.find((r) => r.quality === 'high-to-low').after.game.rendererMemory;
      if (
        lowered.total > fresh.total + 2 * 1024 * 1024 ||
        lowered.renderTargets !== fresh.renderTargets ||
        lowered.textures !== fresh.textures
      )
        throw new Error('High-to-low resources did not converge to fresh low');
      if (report.runs.some((r) => r.errors.length)) throw new Error('Renderer errors');
    }
  } else if (mode === 'tiers') {
    for (const tier of [2, 4]) {
      const run = await setup({ ref: 'practice', quality: 'auto', dpr: 2 });
      await run.page.evaluate((target) => {
        const e = window.__wwmGame.engine;
        e.setQuality('auto');
        // Establish an intermediate/minimum tier deterministically, then hold it during the short sample.
        for (let i = 0; i < 400 && e.stats().tier < target; i++) e.frame(target === 2 ? 1 / 35 : 1 / 10);
        const original = e.frame;
        e.frame = function (dt) {
          return original.call(this, dt, null);
        };
      }, tier);
      const supported = await run.page.evaluate(
        () =>
          window.__wwmGame.engine.debug().renderer.backend.device?.features.has('timestamp-query') ?? false,
      );
      if (supported)
        await run.page.evaluate(() => {
          const e = window.__wwmGame.engine,
            r = e.debug().renderer,
            original = e.frame;
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
      const result = await record(run.page, run.cdp, 4);
      report.runs.push({
        tier,
        supported,
        gpuMs: stats(await run.page.evaluate(() => window.__gpuSamples ?? [])),
        ...result,
        errors: run.errors,
      });
      save();
      await run.ctx.close();
    }
  } else if (mode === 'transitions') {
    for (const mobile of [false, true]) {
      const run = await setup({
        ref: 'practice',
        quality: 'high',
        dpr: mobile ? 3 : 2,
        mobile,
        learn: mobile,
      });
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const quality of ['low', 'high']) {
          await run.page.evaluate((q) => window.__wwmGame.engine.setQuality(q), quality);
          await run.page.waitForTimeout(1000);
          report.runs.push({ mobile, cycle, quality, ...(await record(run.page, run.cdp, 3)) });
          save();
        }
      }
      await run.page.screenshot({
        path: new URL(mobile ? 'mobile-high-learning.png' : 'desktop-high.png', out).pathname,
      });
      await run.page.evaluate(() => window.__wwmGame.engine.setQuality('low'));
      await run.page.waitForTimeout(1000);
      await run.page.screenshot({
        path: new URL(mobile ? 'mobile-low-learning.png' : 'desktop-low.png', out).pathname,
      });
      report.runs.push({ mobile, errors: run.errors });
      await run.ctx.close();
      const portals = await setup({ ref: 'fixture-hn-front', quality: 'low', dpr: mobile ? 3 : 2, mobile });
      await portals.page.screenshot({
        path: new URL(mobile ? 'mobile-low-portals.png' : 'desktop-low-portals.png', out).pathname,
      });
      report.runs.push({
        mobile,
        portalScene: true,
        ...(await record(portals.page, portals.cdp, 2)),
        errors: portals.errors,
      });
      save();
      await portals.ctx.close();
    }
    if (process.env.PERF_REQUIRE_IMPROVEMENT) {
      for (const mobile of [false, true])
        for (const quality of ['high', 'low']) {
          const cycles = report.runs.filter((r) => r.mobile === mobile && r.quality === quality);
          const first = cycles[0].after.game.rendererMemory;
          for (const r of cycles.slice(1)) {
            const m = r.after.game.rendererMemory;
            if (
              ['attributes', 'renderTargets', 'textures', 'programs', 'uniformBuffers', 'total'].some(
                (k) => m[k] > first[k],
              )
            )
              throw new Error(`Resources grew across ${quality} cycles`);
          }
        }
      if (report.runs.some((r) => r.errors?.length)) throw new Error('Renderer errors');
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
    if (!process.env.PERF_QUICK) report.runs.push({ name: 'recovery', ...(await record(page, cdp, 30)) });
    await run.ctx.close();
  } else if (mode === 'visibility') {
    const run = await setup({ ref: 'practice' });
    const before = await run.page.evaluate(() => window.__wwmGame.engine.stats());
    await run.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await run.page.waitForTimeout(2500);
    const hidden = await run.page.evaluate(() => window.__wwmGame.engine.stats());
    await run.page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await run.page.waitForTimeout(2500);
    const resumed = await run.page.evaluate(() => window.__wwmGame.engine.stats());
    report.runs.push({
      before,
      hidden,
      resumed,
      errors: run.errors,
      note: 'Synthetic visibility lifecycle; not OS background power acceptance.',
    });
    await run.ctx.close();
  } else if (mode === 'replay') {
    const replay = JSON.parse(
      readFileSync(new URL('../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
    );
    for (const throttle of (process.env.PERF_REPLAY_THROTTLES ?? '1,6,20').split(',').map(Number)) {
      const run = await setup({ replay, ref: 'practice', throttle });
      await run.page.evaluate(() => {
        window.__replayQualityChanges = [];
        for (const [atMs, quality] of [
          [10000, 'low'],
          [25000, 'high'],
          [40000, 'auto'],
        ]) {
          setTimeout(() => {
            const g = window.__wwmGame;
            g.engine.setQuality(quality);
            window.__replayQualityChanges.push({ quality, tick: g.debugState().tick });
          }, atMs);
        }
      });
      const result = await record(run.page, run.cdp, 60, false, throttle === 6);
      if (result.cpuProfile) {
        writeFileSync(new URL('cpu-replay.cpuprofile', out), JSON.stringify(result.cpuProfile));
        delete result.cpuProfile;
      }
      report.runs.push({
        throttle,
        loadMs: run.loadMs,
        ...result,
        qualityChanges: await run.page.evaluate(() => window.__replayQualityChanges),
        errors: run.errors,
      });
      save();
      await run.ctx.close();
    }
  }
} finally {
  save();
  await browser.close();
}
