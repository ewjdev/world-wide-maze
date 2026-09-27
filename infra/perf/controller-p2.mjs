// Run: node --import tsx infra/perf/controller-p2.mjs (synthetic session CPU, not a phone benchmark).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { ControllerSession } from '../../apps/web/src/controller/session.ts';
import { StreamStats } from '../../packages/net/src/index.ts';

export function exercise(Session, hz, scenario, seconds = 30) {
  let now = 1000;
  let visible = true;
  let raf = null;
  const sensor = new EventTarget();
  const visibility = new EventTarget();
  const packets = [];
  const sockets = [];
  const times = [];
  let publications = 0;
  let summaries = 0;
  const summary = StreamStats.prototype.summary;
  StreamStats.prototype.summary = function (...args) {
    summaries++;
    return summary.apply(this, args);
  };
  const session = new Session('123456', {
    origin: 'https://fixture.invalid',
    now: () => now,
    requestAnimationFrame: (cb) => {
      raf = cb;
      return 1;
    },
    cancelAnimationFrame: () => {
      raf = null;
    },
    sensorTarget: sensor,
    visibilityTarget: visibility,
    isVisible: () => visible,
    screenAngle: () => 0,
    DeviceOrientationEvent: {},
    storage: {
      getItem: () => (scenario === 'calibration' ? null : '[0,0,-1]'),
      setItem() {},
      removeItem() {},
    },
    log() {},
    createSocket: () => {
      const socket = {
        readyState: 0,
        bufferedAmount: 0,
        binaryType: 'arraybuffer',
        onopen: null,
        onclose: null,
        onmessage: null,
        onerror: null,
        send(data) {
          if (data instanceof ArrayBuffer) {
            packets.push(Buffer.from(data));
            times.push(now);
          }
        },
        close() {
          this.readyState = 3;
        },
      };
      sockets.push(socket);
      return socket;
    },
  });
  const open = () => {
    const socket = sockets.at(-1);
    socket.readyState = 1;
    socket.onopen?.({});
    socket.onmessage?.({ data: JSON.stringify({ t: 'peer', role: 'host', connected: true }) });
  };
  const orient = (i) =>
    sensor.dispatchEvent(
      Object.assign(new Event('deviceorientation'), {
        alpha: 0,
        beta: 10 * Math.sin(i / 10),
        gamma: 8 * Math.cos(i / 7),
      }),
    );
  try {
    session.start();
    open();
    session.enableTilt();
    orient(0);
    session.subscribe(() => {
      publications++;
    });
    const start = performance.now();
    const cpu = process.cpuUsage();
    for (let i = 0; i < seconds * hz; i++) {
      now = 1000 + (i * 1000) / hz;
      orient(i);
      if (scenario === 'reconnect' && i === 2 * hz) {
        visible = false;
        visibility.dispatchEvent(new Event('visibilitychange'));
      }
      if (scenario === 'reconnect' && i === 6 * hz) {
        visible = true;
        visibility.dispatchEvent(new Event('visibilitychange'));
        open();
      }
      const callback = raf;
      raf = null;
      callback?.(now);
      if (i % hz === Math.floor(hz / 3)) session.setButton('power', true);
      if (i % hz === Math.floor(hz / 3) + 1) session.setButton('power', false);
    }
    const used = process.cpuUsage(cpu);
    return {
      hz,
      scenario,
      seconds,
      cpuMs: (used.user + used.system) / 1000,
      wallMs: performance.now() - start,
      publications,
      summaries,
      sends: packets.length,
      wireSHA256: createHash('sha256').update(Buffer.concat(packets)).digest('hex'),
      intervalsSHA256: createHash('sha256').update(JSON.stringify(times)).digest('hex'),
      screen: session.getView().screen,
      intervalMinMs: Math.min(...times.slice(1).map((t, i) => t - times[i])),
      intervalMaxMs: Math.max(...times.slice(1).map((t, i) => t - times[i])),
    };
  } finally {
    session.dispose();
    StreamStats.prototype.summary = summary;
  }
}

async function main() {
  const baselineRef = process.env.PERF_BASELINE ?? 'ebd368b';
  const file = new URL('../../apps/web/src/controller/.performance-baseline-session.ts', import.meta.url);
  const source = execFileSync('git', ['show', `${baselineRef}:apps/web/src/controller/session.ts`]);
  await writeFile(file, source);
  try {
    const Baseline = (await import(file.href)).ControllerSession;
    for (const Session of [Baseline, ControllerSession]) exercise(Session, 120, 'play', 5);
    const pairs = [];
    for (const hz of [60, 90, 120])
      for (const scenario of ['play', 'calibration', 'reconnect'])
        for (let repeat = 0; repeat < 5; repeat++) {
          const order = repeat % 2 ? [ControllerSession, Baseline] : [Baseline, ControllerSession];
          const values = order.map((Session) => exercise(Session, hz, scenario));
          const baseline = values[repeat % 2 ? 1 : 0];
          const candidate = values[repeat % 2 ? 0 : 1];
          assert.equal(candidate.wireSHA256, baseline.wireSHA256, 'wire input must be byte-identical');
          assert.equal(candidate.intervalsSHA256, baseline.intervalsSHA256, 'send times must be identical');
          assert.equal(candidate.screen, baseline.screen);
          pairs.push({ repeat, baseline, candidate });
        }
    const report = {
      date: new Date().toISOString(),
      baselineRef,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      baselineSourceSHA256: createHash('sha256').update(source).digest('hex'),
      candidateSourceSHA256: createHash('sha256')
        .update(await readFile(new URL('../../apps/web/src/controller/session.ts', import.meta.url)))
        .digest('hex'),
      node: process.version,
      hardware: os.cpus()[0]?.model,
      method:
        'Synthetic EventTarget + fake WebSocket + scheduled 60/90/120Hz timestamps. Session CPU excludes React/browser/network. Summary/publication counts exact; no heap allocation byte or physical battery claim.',
      pairs,
    };
    const out = process.env.AUDIT_OUT ?? 'docs/launch/evidence/controller-p2';
    await mkdir(out, { recursive: true });
    await writeFile(`${out}/session.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Passed ${pairs.length} exact wire/timing comparisons; wrote ${out}/session.json`);
  } finally {
    await rm(file, { force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
