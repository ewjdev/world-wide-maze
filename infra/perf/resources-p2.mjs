/** Per-stage GPU and bitmap ownership probes, derived from the qualified renderer probe. No API writes; offline fixtures, analytics off. */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4321';
const out = new URL(
  `../../docs/launch/evidence/resources-p2/${process.env.PERF_LABEL ?? 'baseline'}/`,
  import.meta.url,
);
mkdirSync(out, { recursive: true });
const mode = process.argv[2] ?? 'retries';
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
try {
  const run = await setup({ quality: 'high', dpr: 2 });
  const { page, cdp } = run;
  report.errors = run.errors;
  await page.evaluate(() => {
    const r = window.__wwmGame.engine.debug().renderer;
    window.__owners = [...r._objects._renderObjects]
      .filter((o) => o.object.name === 'motes')
      .map((o) => ({
        object: o.object,
        geometry: o.geometry,
        attributes: o.getAttributes().filter((a) => a.array?.byteLength === 22400),
      }));
  });
  if (mode === 'retries') {
    report.initial = await snapshot(page, cdp, true);
    report.retries = [];
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => {
        window.__wwmGame.menu();
        window.__wwmGame.retryStage();
      });
      await page.waitForFunction(() => window.__wwmGame.debugState().phase === 'play');
      await page.waitForTimeout(350);
      report.retries.push(await snapshot(page, cdp, true));
      save();
    }
    report.owner = await page.evaluate(() => {
      const r = window.__wwmGame.engine.debug().renderer;
      return window.__owners.map((o) => ({
        geometryId: o.geometry.id,
        objectAttachedToOldGroup: !!o.object.parent,
        attributes: o.attributes.map((a) => ({
          id: a.id,
          bytes: a.array.byteLength,
          retainedByAttributes: r._attributes.has(a),
          retainedByBackend: r.backend.has(a),
        })),
      }));
    });
    await page.screenshot({ path: new URL('after-retries.png', out).pathname });
    if (process.env.PERF_CULL_CASE) {
      await page.evaluate(() => {
        const c = window.__wwmGame.engine.debug().camera;
        window.__updateCamera = c.updateMatrixWorld;
        c.updateMatrixWorld = function (...args) {
          this.position.set(1e6, 1e6, 1e6);
          return window.__updateCamera.apply(this, args);
        };
      });
      report.culledRetries = [];
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          window.__wwmGame.menu();
          window.__wwmGame.retryStage();
        });
        await page.waitForFunction(() => window.__wwmGame.debugState().phase === 'play');
        await page.waitForTimeout(250);
        report.culledRetries.push({
          motesVisible: await page.evaluate(
            () => window.__wwmGame.engine.debug().scene.getObjectByName('motes').visible,
          ),
          ...(await snapshot(page, cdp, true)),
        });
      }
      await page.evaluate(() => {
        const c = window.__wwmGame.engine.debug().camera;
        c.updateMatrixWorld = window.__updateCamera;
      });
      await page.waitForTimeout(250);
      if (
        process.env.PERF_REQUIRE_IMPROVEMENT &&
        (report.culledRetries.some((r) => r.motesVisible) ||
          new Set(report.culledRetries.map((r) => r.game.rendererMemory.attributesSize)).size !== 1)
      )
        throw new Error('Culled mote lifecycle failed');
    }

    report.errors = run.errors;
    if (process.env.PERF_REQUIRE_IMPROVEMENT) {
      const rows = report.retries.slice(2).map((r) => r.game.rendererMemory);
      for (const key of [
        'attributes',
        'attributesSize',
        'geometries',
        'textures',
        'renderTargets',
        'programs',
        'uniformBuffers',
      ])
        if (new Set(rows.map((r) => r[key])).size !== 1) throw new Error(`Retry growth: ${key}`);
      if (report.owner.some((o) => o.attributes.some((a) => a.retainedByAttributes || a.retainedByBackend)))
        throw new Error('Original mote buffers retained');
    }
  } else if (mode === 'stages') {
    report.changes = [];
    for (let i = 0; i < 15; i++) {
      const slug = i % 2 ? 'hn-front' : 'example-sparse';
      await page.evaluate((slug) => {
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
          pageHeight: slug === 'hn-front' ? 1214 : 800,
          thumb: '',
        });
      }, slug);
      await page.waitForFunction(() => window.__wwmGame.debugState().phase === 'play', null, {
        timeout: 90000,
      });
      await page.evaluate((i) => window.__wwmGame.engine.setView(i % 2 ? 'map' : 'chase'), i);
      await page.waitForTimeout(400);
      const state = await snapshot(page, cdp, true);
      const motesVisible = await page.evaluate(
        () => window.__wwmGame.engine.debug().scene.getObjectByName('motes')?.visible,
      );
      report.changes.push({ slug, motesVisible, ...state });
      save();
    }
    if (process.env.PERF_REQUIRE_IMPROVEMENT)
      for (const slug of ['hn-front', 'example-sparse']) {
        const rows = report.changes
          .filter((r) => r.slug === slug)
          .slice(1)
          .map((r) => r.game.rendererMemory);
        for (const key of [
          'attributes',
          'attributesSize',
          'geometries',
          'textures',
          'renderTargets',
          'programs',
          'uniformBuffers',
        ])
          if (new Set(rows.map((r) => r[key])).size !== 1) throw new Error(`Stage growth: ${slug} ${key}`);
      }
    report.recovery = [];
    if (await page.evaluate(() => window.__wwmGame.engine.stats().backend === 'webgpu')) {
      await page.evaluate(() =>
        window.__wwmGame.engine
          .debug()
          .renderer.onDeviceLost({ reason: 'unknown', message: 'Synthetic resource-lifecycle recovery' }),
      );
      await page.waitForFunction(() => window.__wwmGame.engine.stats().backend === 'webgl2');
      await page.waitForTimeout(1000);
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => {
          window.__wwmGame.menu();
          window.__wwmGame.retryStage();
        });
        await page.waitForFunction(() => window.__wwmGame.debugState().phase === 'play');
        await page.waitForTimeout(300);
        report.recovery.push(await snapshot(page, cdp, true));
      }
      if (
        process.env.PERF_REQUIRE_IMPROVEMENT &&
        new Set(report.recovery.slice(1).map((r) => r.game.rendererMemory.attributesSize)).size !== 1
      )
        throw new Error('Recovery attribute growth');
    }
  } else if (mode === 'visual') {
    await page.waitForTimeout(1800);
    await page.screenshot({ path: new URL('normal-settled.png', out).pathname });
    const fixture = JSON.parse(
      readFileSync(new URL('../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
    );
    await page.evaluate(async (fixture) => {
      const g = window.__wwmGame;
      g.menu();
      const canvas = new OffscreenCanvas(5120, 6400),
        ctx = canvas.getContext('2d');
      for (let y = 0; y < 6400; y += 400)
        for (let x = 0; x < 5120; x += 400) {
          ctx.fillStyle = (x / 400 + y / 400) % 2 === 0 ? (y < 3200 ? '#1565c0' : '#c62828') : '#fff4c2';
          ctx.fillRect(x, y, 400, 400);
        }
      ctx.fillStyle = '#172128';
      ctx.font = 'bold 260px sans-serif';
      ctx.fillText('TOP TILE', 400, 1000);
      ctx.fillText('BOTTOM TILE', 400, 4300);
      window.__visualBitmap = await createImageBitmap(canvas);
      await g.engine.loadStage(fixture, window.__visualBitmap);
      g.resume();
      g.engine.setView('map');
    }, fixture);
    await page.waitForTimeout(900);
    await page.screenshot({ path: new URL('large-tiled-texture.png', out).pathname });
    report.visual = await snapshot(page, cdp, true);
    report.visualSource = { width: 5120, height: 6400, expectedTiles: 2, expectedTileSize: [4096, 2560] };
    report.visualSource.actualMaterialCount = await page.evaluate(() => {
      const material = window.__wwmGame.engine.debug().scene.getObjectByName('island-tops').material;
      return Array.isArray(material) ? material.length : 1;
    });
    if (report.visualSource.actualMaterialCount !== 2) throw new Error('Visual test did not tile');
    await page.evaluate(() => {
      window.__wwmGame.engine.unloadStage();
      window.__visualBitmap.close();
      window.__wwmGame.dispose();
    });
  } else if (mode === 'tiles') {
    const fixture = JSON.parse(
      readFileSync(new URL('../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
    );
    await page.evaluate(async (fixture) => {
      window.__wwmGame.menu();
      window.__tileStage = fixture;
      const canvas = new OffscreenCanvas(512, 10000);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ddeeff';
      ctx.fillRect(0, 0, 512, 10000);
      window.__sourceBitmap = await createImageBitmap(canvas);
      window.__tileBitmaps = [];
      const original = createImageBitmap;
      window.createImageBitmap = async (...args) => {
        const bitmap = await original(...args);
        window.__tileBitmaps.push(bitmap);
        return bitmap;
      };
    }, fixture);
    report.tiles = [];
    for (let i = 0; i < 4; i++) {
      await page.evaluate(async () => {
        await window.__wwmGame.engine.loadStage(window.__tileStage, window.__sourceBitmap);
        window.__wwmGame.engine.setView('map');
      });
      await page.waitForTimeout(250);
      report.tiles.push(
        await page.evaluate(() => ({
          created: window.__tileBitmaps.length,
          alive: window.__tileBitmaps.filter((b) => b.width > 0).length,
          sourceWidth: window.__sourceBitmap.width,
        })),
      );
    }
    await page.evaluate(() => window.__wwmGame.engine.unloadStage());
    report.unloaded = await page.evaluate(() => ({
      created: window.__tileBitmaps.length,
      alive: window.__tileBitmaps.filter((b) => b.width > 0).length,
      sourceWidth: window.__sourceBitmap.width,
    }));
    // The engine owns generated tiles, including those completed after an unload cancels the load.
    await page.evaluate(() => {
      const original = createImageBitmap;
      window.createImageBitmap = async (...args) => {
        const bitmap = await original(...args);
        await new Promise((resolve) => {
          window.__releaseBitmap = resolve;
        });
        window.createImageBitmap = original;
        return bitmap;
      };
      window.__pendingStage = window.__wwmGame.engine
        .loadStage(window.__tileStage, window.__sourceBitmap)
        .then(
          () => ({ resolved: true }),
          (e) => ({ error: e.name }),
        );
    });
    await page.waitForFunction(() => !!window.__releaseBitmap);
    await page.evaluate(() => {
      window.__wwmGame.engine.unloadStage();
      window.__releaseBitmap();
    });
    report.cancelled = await page.evaluate(async () => ({
      outcome: await window.__pendingStage,
      alive: window.__tileBitmaps.filter((b) => b.width > 0).length,
      sourceWidth: window.__sourceBitmap.width,
    }));
    await page.evaluate(() => {
      window.__wwmGame.engine.unloadStage();
      window.__sourceBitmap.close();
    });
    report.disposal = await page.evaluate(() => {
      const r = window.__wwmGame.engine.debug().renderer;
      const beforeDispose = { ...r.info.memory };
      window.__wwmGame.dispose();
      return {
        beforeDispose,
        // Three resets Info before disposal callbacks; counters after disposal can be negative.
        memory: { ...r.info.memory },
        ownedBitmapsAlive: window.__tileBitmaps.filter((b) => b.width > 0).length,
      };
    });
    if (
      process.env.PERF_REQUIRE_IMPROVEMENT &&
      (report.tiles.some((r) => r.alive !== 3 || r.sourceWidth !== 512) ||
        report.unloaded.alive !== 0 ||
        report.unloaded.sourceWidth !== 512 ||
        report.cancelled.outcome.error !== 'AbortError' ||
        report.cancelled.alive !== 0 ||
        report.disposal.ownedBitmapsAlive !== 0)
    )
      throw new Error('Tile lifetime violated');
  } else throw new Error(`Unknown mode ${mode}`);
  report.errors = run.errors;
  if (run.errors.length) throw new Error('Browser errors');
  await run.ctx.close();
} finally {
  save();
  await browser.close();
}
