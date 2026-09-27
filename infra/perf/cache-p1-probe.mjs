/** Real Chromium worker A/B: same offline fixtures, original worker vs bounded worker. No external requests. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const { createServer } = require('vite');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const root = resolve(repo, 'apps/web');
const baselineRef = process.env.CACHE_BASE ?? 'd88697f';
const out = resolve(process.env.CACHE_OUT ?? resolve(repo, 'docs/launch/evidence/performance-cache-p1'));
mkdirSync(out, { recursive: true });
const baselineFile = resolve(root, 'src/game/.performance-baseline.worker.ts');
const observerFile = resolve(root, 'src/game/.performance-observer.worker.ts');
const sourceFingerprint = runtimeFingerprint();
const baselineSource = execFileSync('git', ['show', `${baselineRef}:apps/web/src/game/builder.worker.ts`], {
  cwd: repo,
  encoding: 'utf8',
});
writeFileSync(baselineFile, baselineSource);
writeFileSync(
  observerFile,
  `
const decoded = [];
const getImageData = OffscreenCanvasRenderingContext2D.prototype.getImageData;
OffscreenCanvasRenderingContext2D.prototype.getImageData = function (...args) {
  const image = getImageData.apply(this, args);
  decoded.push({ bytes: image.data.buffer.byteLength, value: new WeakRef(image.data) });
  return image;
};
globalThis.__decodedStats = () => ({ decodes: decoded.length, liveBytes: decoded.reduce((n, x) => n + (x.value.deref() ? x.bytes : 0), 0) });
if (new URL(location.href).searchParams.get('baseline') === '1') await import('./.performance-baseline.worker.ts');
else await import('./builder.worker.ts');
postMessage({ ready: true });
`,
);
let server;
let browser;
const report = {
  date: new Date().toISOString(),
  runtimeFingerprint: sourceFingerprint,
  baselineRef,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(),
  hardware: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.memsize'], {
    encoding: 'utf8',
  }).trim(),
  method:
    'Headed native Chromium; real module workers; source served by Vite; sequential original/candidate tours; CDP worker GC and backing storage, observer uses WeakRef without retaining images; page is an empty harness, not game renderer.',
  rounds: [],
};

try {
  server = await createServer({ root, server: { port: 4323, strictPort: true }, logLevel: 'error' });
  server.middlewares.use('/__cache-probe.html', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Offline worker cache probe</title>');
  });
  await server.listen();
  browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
  report.browser = browser.version();
  const cdp = await browser.newBrowserCDPSession();
  const waiting = new Map();
  let requestId = 1;
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    const message = JSON.parse(event.message);
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.resolve(message.result);
  });
  async function workerCommand(sessionId, method) {
    const id = requestId++;
    const response = new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method }) });
    return response;
  }
  const slugs = [
    'example-sparse',
    'hn-front',
    'govuk-card-grid',
    'mdn-dark-docs',
    'image-gallery',
    'wikipedia-article',
    'wikipedia-article',
    'hn-front',
    'hn-front',
  ];
  const captures = Object.fromEntries(
    [...new Set(slugs)].map((slug) => [
      slug,
      JSON.parse(readFileSync(resolve(repo, `fixtures/captures/${slug}/capture.json`), 'utf8')),
    ]),
  );
  for (const variant of ['baseline', 'candidate', 'baseline', 'candidate']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await context.route('https://**', (route) => route.abort());
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4323/__cache-probe.html');
    const workerReady = page.waitForEvent('worker');
    await page.evaluate((baseline) => {
      window.probeWorker = new Worker(
        `/src/game/.performance-observer.worker.ts?baseline=${baseline ? '1' : '0'}`,
        { type: 'module' },
      );
      return new Promise((resolve, reject) => {
        window.probeWorker.onerror = (e) => reject(new Error(e.message));
        window.probeWorker.onmessage = (e) => {
          if (e.data.ready) resolve();
        };
      });
    }, variant === 'baseline');
    const worker = await workerReady;
    const targets = await cdp.send('Target.getTargets');
    const target = targets.targetInfos.find(
      (t) => t.type === 'worker' && t.url.includes('.performance-observer.worker'),
    );
    if (!target) throw new Error('worker target missing');
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: false,
    });
    const round = { variant, stages: [] };
    const oversizedUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 8192; // 40 MiB RGBA: deliberately larger than the retention budget.
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/png');
      canvas.width = canvas.height = 0;
      return url;
    });
    const tour = [...slugs, 'oversized-synthetic', 'oversized-synthetic'];
    for (let i = 0; i < tour.length; i++) {
      const slug = tour[i];
      const capture = captures[slug] ?? captures['wikipedia-article'];
      const sliceIndex = i === 6 ? 1 : 0;
      const result = await page.evaluate(
        async ({ id, capture, url, sliceIndex }) => {
          const start = performance.now();
          const reply = await new Promise((resolve, reject) => {
            window.probeWorker.onmessage = (e) =>
              e.data.ok ? resolve(e.data) : reject(new Error(e.data.error));
            window.probeWorker.postMessage({
              id,
              capture,
              screenshotUrl: url,
              sliceIndex,
              seed: 1,
              difficulty: 'normal',
            });
          });
          const hash = Array.from(
            new Uint8Array(
              await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(reply.stage))),
            ),
          )
            .map((x) => x.toString(16).padStart(2, '0'))
            .join('');
          return {
            wallMs: performance.now() - start,
            buildMs: reply.ms,
            cache: reply.cache ?? null,
            stageHash: hash,
            stageId: reply.stage.stageId,
          };
        },
        {
          id: i + 1,
          capture,
          sliceIndex,
          url:
            slug === 'oversized-synthetic'
              ? oversizedUrl
              : `/@fs/${resolve(repo, `fixtures/captures/${slug}/screenshot.png`)}`,
        },
      );
      // Let postMessage/async frames release locals, then collect the dedicated worker, not the page heap.
      await worker.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
      await workerCommand(sessionId, 'HeapProfiler.collectGarbage');
      const workerHeap = await workerCommand(sessionId, 'Runtime.getHeapUsage');
      const decoded = await worker.evaluate(() => globalThis.__decodedStats());
      const pageHeap = await (await context.newCDPSession(page)).send('Runtime.getHeapUsage');
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
      const rss = processInfo
        .filter((p) => p.type === 'renderer')
        .map((p) => ({
          id: p.id,
          rssKiB: Number(execFileSync('ps', ['-p', String(p.id), '-o', 'rss='], { encoding: 'utf8' }).trim()),
        }));
      round.stages.push({
        slug,
        sliceIndex,
        ...result,
        decoded,
        workerHeap,
        pageHeap,
        rendererProcesses: rss,
      });
      console.log(
        JSON.stringify({
          variant,
          slug,
          sliceIndex,
          decoded,
          workerBackingBytes: workerHeap.backingStorageSize,
          cache: result.cache,
        }),
      );
    }
    report.rounds.push(round);
    await cdp.send('Target.detachFromTarget', { sessionId });
    await context.close();
  }
  const expected = report.rounds[0].stages.map((s) => s.stageHash);
  report.identicalStages = report.rounds.every(
    (r) => JSON.stringify(r.stages.map((s) => s.stageHash)) === JSON.stringify(expected),
  );
  report.retentionBoundPass = report.rounds
    .filter((r) => r.variant === 'candidate')
    .every((r) =>
      r.stages.every(
        (s) => s.decoded.liveBytes <= 32 * 1024 * 1024 && s.cache.retainedBytes === s.decoded.liveBytes,
      ),
    );
  if (!report.identicalStages || !report.retentionBoundPass)
    throw new Error('cache A/B correctness or retention gate failed');
} finally {
  writeFileSync(resolve(out, 'worker-tour.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  await server?.close();
  unlinkSync(baselineFile);
  unlinkSync(observerFile);
}
