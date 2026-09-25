#!/usr/bin/env node
/**
 * Monthly cost ESTIMATE for docs/launch/cost-model.md (Phase 12). Every number is an assumption or a list price;
 * nothing here is a measured bill. Edit ASSUMPTIONS and re-run: `node infra/scripts/cost-model.mjs [--md]`.
 * Prices: Cloudflare docs, Workers Paid, fetched 2026-09-25 (see cost-model.md for links).
 */
const PRICE = {
  base: 5, // Workers Paid subscription, $/month
  workers: { reqIncl: 10e6, reqPerM: 0.3, cpuInclMs: 30e6, cpuPerMms: 0.02 },
  do: { reqIncl: 1e6, reqPerM: 0.15, gbsIncl: 400e3, gbsPerM: 12.5, wsRatio: 20 },
  browser: { hoursIncl: 10, perHour: 0.09, concIncl: 10, perConc: 2 },
  r2: { gbIncl: 10, perGb: 0.015, aIncl: 1e6, aPerM: 4.5, bIncl: 10e6, bPerM: 0.36 },
  kv: { readsIncl: 10e6, readPerM: 0.5, writesIncl: 1e6, writePerM: 5 },
  d1: { writesIncl: 50e6, writePerM: 1 }, // reads (25 B included) are negligible here
  logs: { incl: 20e6, perM: 0.6 },
};

const A = {
  daysPerMonth: 30,
  stagesPerPlay: 3, // stages actually played per session (a run of slices / several sites)
  playMinutes: 5, // wall time with the room open
  phoneShare: 0.5, // share of plays paired with a phone (rest: keyboard, no room traffic)
  inputHz: 60, // controller INPUT frames during play (contracts §6); ~4 Hz keepalive outside play
  hostMsgsPerSec: 4, // state/haptic/pos frames from the host
  // Room DO duration. With the WebSocket Hibernation API an idle DO that is *eligible* for hibernation isn't billed
  // for duration, so billed time ≈ time spent in handlers: messages × doActiveMsPerMsg (ASSUMED 1 ms per message,
  // incl. runtime overhead; not measured). `--awake` models the pessimistic case: billed for the whole play.
  doActiveMsPerMsg: 1,
  doAwakeWholePlay: process.argv.includes('--awake'),
  workerReqPerPlay: 20, // stage + texture per stage, run/curated, boards, ghost, scores, room create + 2 ws upgrades
  workerCpuMsPerReq: 2,
  scoreSubmitsPerPlay: 0.6, // verified stage submissions (replay re-simulation)
  replayVerifyCpuMs: 130, // measured: 120–135 ms wall per 5,429-tick replay in workerd (Phase 10)
  newUrlShare: 0.1, // share of plays that enter a URL
  runCacheHitRate: 0.5, // of those, share already built (KV run cache, 7-day TTL) — ASSUMED, not measured
  browserSecPerBuild: 12, // active capture ≈ 5–8 s (local Browser Run p50 5.3 s) + session reuse overhead
  peakConcurrentBrowsers: (buildsPerDay) => Math.max(1, Math.ceil((buildsPerDay / 86400) * 12 * 4)), // 4× avg
  buildCpuMs: 1500, // PNG decode + builder for all slices of a tall page (0.1–0.2 s per slice measured) + storage
  mbPerBuild: 6, // capture PNG + 4 DPR-2 WebP textures + JSON
  r2PutsPerBuild: 10,
  retentionDays: 30,
  r2ReadsPerPlay: 6, // stage JSON + texture per stage (no edge cache in front of the Worker yet)
  kvReadsPerUrlPost: 4, // run cache + in-flight + opt-out chain (~2)
  kvWritesPerBuild: 2,
  d1WritesPerPlay: 1, // score rows (+ runs/stages rows per build, small)
  logEventsPerPlay: 25, // invocation logs + structured lines; room keepalive is logged once a minute
};

function month(playsPerDay) {
  const d = A.daysPerMonth;
  const plays = playsPerDay * d;
  const phonePlays = plays * A.phoneShare;
  const out = {};

  // Workers (the API Worker; static assets are free)
  const wReq = plays * A.workerReqPerPlay;
  const buildsPerDay = playsPerDay * A.newUrlShare * (1 - A.runCacheHitRate);
  const builds = buildsPerDay * d;
  const wCpu =
    wReq * A.workerCpuMsPerReq + plays * A.scoreSubmitsPerPlay * A.replayVerifyCpuMs + builds * A.buildCpuMs;
  out.workers =
    (Math.max(0, wReq - PRICE.workers.reqIncl) / 1e6) * PRICE.workers.reqPerM +
    (Math.max(0, wCpu - PRICE.workers.cpuInclMs) / 1e6) * PRICE.workers.cpuPerMms;

  // Durable Objects: Room relay dominates (BuildJob/Limiter are small)
  const playSec = A.playMinutes * 60;
  const wsMsgs = phonePlays * playSec * (A.inputHz + A.hostMsgsPerSec);
  const doReq = wsMsgs / PRICE.do.wsRatio + phonePlays * 2 + builds * 20;
  const gbs = A.doAwakeWholePlay
    ? phonePlays * playSec * 0.128
    : ((wsMsgs * A.doActiveMsPerMsg) / 1000) * 0.128;
  out.durableObjects =
    (Math.max(0, doReq - PRICE.do.reqIncl) / 1e6) * PRICE.do.reqPerM +
    (Math.max(0, gbs - PRICE.do.gbsIncl) / 1e6) * PRICE.do.gbsPerM;
  out._doGbs = gbs;
  out._doReq = doReq;

  // Browser Run
  const hours = (builds * A.browserSecPerBuild) / 3600;
  const conc = A.peakConcurrentBrowsers(buildsPerDay);
  out.browserRun =
    Math.max(0, hours - PRICE.browser.hoursIncl) * PRICE.browser.perHour +
    Math.max(0, conc - PRICE.browser.concIncl) * PRICE.browser.perConc;
  out._browserHours = hours;
  out._peakBrowsers = conc;

  // R2
  const gb = (buildsPerDay * A.retentionDays * A.mbPerBuild) / 1024;
  const aOps = builds * A.r2PutsPerBuild + plays * A.scoreSubmitsPerPlay;
  const bOps = plays * A.r2ReadsPerPlay;
  out.r2 =
    Math.max(0, gb - PRICE.r2.gbIncl) * PRICE.r2.perGb +
    (Math.max(0, aOps - PRICE.r2.aIncl) / 1e6) * PRICE.r2.aPerM +
    (Math.max(0, bOps - PRICE.r2.bIncl) / 1e6) * PRICE.r2.bPerM;
  out._r2Gb = gb;

  // KV, D1, Logs
  const kvR = plays * A.newUrlShare * A.kvReadsPerUrlPost;
  const kvW = builds * A.kvWritesPerBuild;
  out.kv =
    (Math.max(0, kvR - PRICE.kv.readsIncl) / 1e6) * PRICE.kv.readPerM +
    (Math.max(0, kvW - PRICE.kv.writesIncl) / 1e6) * PRICE.kv.writePerM;
  out.d1 = (Math.max(0, plays * A.d1WritesPerPlay - PRICE.d1.writesIncl) / 1e6) * PRICE.d1.writePerM;
  out.logs = (Math.max(0, plays * A.logEventsPerPlay - PRICE.logs.incl) / 1e6) * PRICE.logs.perM;

  out.base = PRICE.base;
  out.total = ['base', 'workers', 'durableObjects', 'browserRun', 'r2', 'kv', 'd1', 'logs'].reduce(
    (s, k) => s + out[k],
    0,
  );
  out._builds = builds;
  return out;
}

const tiers = [1_000, 10_000, 100_000];
const rows = tiers.map((t) => ({ t, ...month(t) }));
const $ = (n) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')}`;
const lines = [
  '| Line item (per month) | 1k plays/day | 10k plays/day | 100k plays/day |',
  '|---|---|---|---|',
  ...[
    ['Workers Paid subscription', 'base'],
    ['Workers requests + CPU (API, replay checks, builds)', 'workers'],
    ['Durable Objects (Room relay, jobs, limiters)', 'durableObjects'],
    ['Browser Run (captures)', 'browserRun'],
    ['R2 (stages, textures, captures, replays)', 'r2'],
    ['Workers KV (run cache, opt-outs)', 'kv'],
    ['D1 (runs, stages, scores)', 'd1'],
    ['Workers Logs', 'logs'],
    ['**Total (estimate)**', 'total'],
  ].map(([label, k]) => `| ${label} | ${rows.map((r) => $(r[k])).join(' | ')} |`),
  '',
  '| Driver | 1k | 10k | 100k |',
  '|---|---|---|---|',
  `| New builds / month | ${rows.map((r) => Math.round(r._builds).toLocaleString('en-US')).join(' | ')} |`,
  `| Browser hours / month | ${rows.map((r) => r._browserHours.toFixed(1)).join(' | ')} |`,
  `| Peak concurrent browsers (assumed 4× average) | ${rows.map((r) => r._peakBrowsers).join(' | ')} |`,
  `| Room DO duration, GB-s / month | ${rows.map((r) => Math.round(r._doGbs).toLocaleString('en-US')).join(' | ')} |`,
  `| DO billed requests / month | ${rows.map((r) => Math.round(r._doReq).toLocaleString('en-US')).join(' | ')} |`,
  `| R2 stored (30-day retention), GB | ${rows.map((r) => r._r2Gb.toFixed(1)).join(' | ')} |`,
];
if (process.argv.includes('--json')) console.log(JSON.stringify({ assumptions: A, rows }, null, 2));
else console.log(lines.join('\n'));
