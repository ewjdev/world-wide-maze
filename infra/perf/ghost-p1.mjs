/** #22 paired probe: unchanged reference replay vs shipped worker client, same build/page/workload.
 * node infra/perf/ghost-p1.mjs build; pnpm --filter @wwm/web preview --host 127.0.0.1 --port 4322
 * node infra/perf/ghost-p1.mjs measure
 * No API writes. CPU throttling stresses the main page; it is NOT physical mobile/worker CPU emulation.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const web = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const evidence = process.env.AUDIT_OUT
  ? pathToFileURL(`${resolve(process.env.AUDIT_OUT)}/`)
  : new URL('../../docs/launch/evidence/ghost-p1/', import.meta.url);
mkdirSync(evidence, { recursive: true });
if (process.argv[2] === 'build') {
  const probe = `${web}.ghost-perf.ts`;
  writeFileSync(
    probe,
    "import { GhostClient } from './src/ranking/ghost-client.ts'; import { recordGhostTrack } from './src/ranking/ghost-track.ts'; Object.assign(window, { ghostProbe: { GhostClient, recordGhostTrack } });",
  );
  try {
    const { build } = await import(require.resolve('vite'));
    await build({
      root: web,
      build: { rolldownOptions: { input: { main: `${web}index.html`, ghostPerf: probe } } },
    });
  } finally {
    unlinkSync(probe);
  }
  process.exit(0);
}
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: false, args: ['--enable-gpu', '--use-angle=metal'] });
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4322';
const asset = readdirSync(`${web}dist/assets`).find((x) => /^ghostPerf-.*\.js$/.test(x));
if (!asset) throw new Error('Run build mode first');
const stage = JSON.parse(
  readFileSync(new URL('../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
);
const reference = JSON.parse(
  readFileSync(new URL('../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
);
const report = {
  date: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirtySource: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  // Content hashes identify the actual measured candidate even before its commit.
  buildAssets: Object.fromEntries(
    readdirSync(`${web}dist/assets`)
      .filter((x) => /\.(js|wasm)$/.test(x))
      .sort()
      .map((name) => [
        name,
        createHash('sha256')
          .update(readFileSync(`${web}dist/assets/${name}`))
          .digest('hex'),
      ]),
  ),
  browser: browser.version(),
  hardware: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string', 'hw.memsize'], {
    encoding: 'utf8',
  }).trim(),
  note: 'Reference recorder code unchanged except returned physicsVersion. Paired same-build scenario; CPU throttle applies to main thread, not equivalent worker CPU slowdown.',
  runs: [],
};
try {
  for (const throttle of [1, 6]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      localStorage.setItem('wwm.analytics.preference', 'off');
      localStorage.setItem('wwm.howtoSeen', '1');
      localStorage.setItem('wwm.tutorialDone', '1');
      window.__WWM_TEST__ = { skipIntro: true, noAutoPause: true };
    });
    await context.route('**/api/**', (r) => r.fulfill({ json: [] }));
    const page = await context.newPage();
    await page.goto(`${base}/play/practice?offline=1`);
    await page.waitForFunction(() => window.__wwmGame?.debugState().phase === 'play');
    await page.waitForTimeout(1000);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const result = await page.evaluate(
      async ({ asset, stage, reference, throttle }) => {
        await import(`/assets/${asset}`);
        const { GhostClient, recordGhostTrack } = window.ghostProbe;
        if (!GhostClient || !recordGhostTrack) throw new Error('Probe exports missing');
        const inputs = Array.from({ length: 36000 }, () => ({
          tiltX: 0,
          tiltZ: 0,
          frameYaw: 0,
          power: false,
          jump: false,
        }));
        const hashes = async (track) => {
          const sha = async (array) =>
            Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', array)))
              .map((x) => x.toString(16).padStart(2, '0'))
              .join('');
          return {
            pos: await sha(track.pos),
            quat: await sha(track.quat),
            ticks: track.ticks,
            goalTick: track.goalTick,
            physicsVersion: track.physicsVersion,
          };
        };
        const parityClient = new GhostClient();
        const expected = await recordGhostTrack(stage, reference);
        const actual = await parityClient.prepare(stage, reference);
        parityClient.dispose();
        const parity = { reference: await hashes(expected), worker: await hashes(actual) };
        const runs = [];
        for (let repeat = 0; repeat < 3; repeat++) {
          // Alternate order to reduce one-sided warm-up/order bias. Worker starts fresh each job.
          for (const mode of repeat % 2 ? ['worker', 'reference'] : ['reference', 'worker']) {
            await new Promise((r) => setTimeout(r, 300));
            const frames = [];
            const longTasks = [];
            const heartbeat = [];
            let active = true;
            let lastFrame = performance.now();
            let lastBeat = lastFrame;
            const frame = (now) => {
              frames.push(now - lastFrame);
              lastFrame = now;
              if (active) requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
            const timer = setInterval(() => {
              const now = performance.now();
              heartbeat.push(now - lastBeat);
              lastBeat = now;
            }, 10);
            const observer = new PerformanceObserver((l) =>
              longTasks.push(...l.getEntries().map((e) => e.duration)),
            );
            observer.observe({ type: 'longtask' });
            const client = new GhostClient();
            const started = performance.now();
            const track =
              mode === 'worker' ? await client.prepare(stage, inputs) : await recordGhostTrack(stage, inputs);
            const wallMs = performance.now() - started;
            await new Promise((r) => setTimeout(r, 60)); // deliver the final long-task entry and blocked heartbeat
            active = false;
            clearInterval(timer);
            observer.disconnect();
            client.dispose();
            runs.push({
              throttle,
              repeat,
              mode,
              wallMs,
              frameMaxMs: Math.max(...frames),
              heartbeatMaxMs: Math.max(...heartbeat),
              frameCount: frames.length,
              longTasks,
              bytes: track.pos.byteLength + track.quat.byteLength,
              ...(await hashes(track)),
            });
          }
        }
        return { parity, runs };
      },
      { asset, stage, reference, throttle },
    );
    report.runs.push(result);
    writeFileSync(new URL('paired.json', evidence), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(result));
    await context.close();
  }
} finally {
  await browser.close();
}
