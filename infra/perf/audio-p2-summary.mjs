/** Compare all sound-enabled product samples; no discarded outliers or synthetic worker timing. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const scenarios = {
  native: { throttle: 1, latency: 0, download: -1 },
  'cpu6-slow10mbps': { throttle: 6, latency: 50, download: 1250000 },
  'learning-cpu6': { throttle: 6, latency: 0, download: -1, learn: true },
};
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const date = (value) => nonempty(value) && Number.isFinite(Date.parse(value));
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const fingerprint = (value) =>
  value?.version === 2 &&
  value.algorithm === 'sha256' &&
  SHA.test(value.sha256 ?? '') &&
  Number.isInteger(value.files) &&
  value.files > 0;
const firstUnlock = (r) => r.observations.spans.find((s) => s.name === 'audio.unlock').duration;
const firstFrame = (r) => r.observations.inputs[0].nextFrame - r.observations.inputs[0].start;
const stats = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, min: s[0], median: (s[2] + s[3]) / 2, max: s.at(-1), values };
};

function validateReport(report) {
  check(report?.muted === false, 'Both timed products must have sound enabled');
  check(!report.error, 'Collector failed');
  check(
    nonempty(report.hardware) &&
      nonempty(report.browser) &&
      date(report.date) &&
      COMMIT.test(report.commit ?? '') &&
      nonempty(report.instrumentation),
    'Missing report host/browser/date/commit/instrumentation metadata',
  );
  check(fingerprint(report.runtimeFingerprint), 'Invalid runtime fingerprint');
  const build = report.servedBuild;
  check(
    build?.verified === true &&
      date(build.verifiedAt) &&
      build.schemaVersion === 1 &&
      date(build.builtAt) &&
      COMMIT.test(build.commit ?? '') &&
      SHA.test(build.manifestSHA256 ?? '') &&
      fingerprint(build.runtimeFingerprint) &&
      JSON.stringify(build.runtimeFingerprint) === JSON.stringify(report.runtimeFingerprint),
    'Unverified served build',
  );
  check(Array.isArray(build.assets) && build.assets.length > 0, 'Missing served asset inventory');
  const paths = new Set();
  for (const asset of build.assets) {
    check(
      nonempty(asset.path) &&
        !asset.path.startsWith('/') &&
        !asset.path.includes('\\') &&
        !asset.path.split('/').some((part) => !part || part === '.' || part === '..') &&
        !paths.has(asset.path) &&
        Number.isSafeInteger(asset.bytes) &&
        asset.bytes >= 0 &&
        SHA.test(asset.sha256 ?? ''),
      'Invalid or duplicate served asset',
    );
    paths.add(asset.path);
  }
  check(
    build.assets.some((x) => x.path === 'index.html' && x.bytes > 0) &&
      build.assets.some((x) => x.path.endsWith('.js') && x.bytes > 0),
    'Served inventory lacks entry HTML or JavaScript',
  );
  // Exact shape/order written by p1-build; verification metadata is outside the hashed manifest.
  const manifest = {
    schemaVersion: build.schemaVersion,
    builtAt: build.builtAt,
    commit: build.commit,
    runtimeFingerprint: build.runtimeFingerprint,
    assets: build.assets,
  };
  check(
    createHash('sha256').update(JSON.stringify(manifest)).digest('hex') === build.manifestSHA256,
    'Served asset manifest hash mismatch',
  );
  check(Array.isArray(report.runs) && report.runs.length === 18, 'Incomplete 18-run collection');
  const cases = new Set();
  for (const r of report.runs) {
    const expected = scenarios[r.scenario?.label];
    check(
      expected &&
        r.scenario.throttle === expected.throttle &&
        r.scenario.latency === expected.latency &&
        r.scenario.download === expected.download &&
        r.scenario.learn === expected.learn,
      'Unknown or invalid scenario workload',
    );
    check(
      Number.isInteger(r.trial) && r.trial >= 0 && r.trial < 3 && ['cold', 'warm'].includes(r.cache),
      'Invalid trial/cache case',
    );
    const key = `${r.scenario.label}:${r.trial}:${r.cache}`;
    check(!cases.has(key), 'Duplicate cold/warm trial');
    cases.add(key);
    check(
      Array.isArray(r.errors) &&
        r.errors.length === 0 &&
        Array.isArray(r.observations?.inputs) &&
        r.observations.inputs.length === 2 &&
        Array.isArray(r.observations.spans),
      'Browser errors or missing input observations',
    );
    const unlocks = r.observations.spans.filter((s) => s.name === 'audio.unlock');
    check(unlocks.length === 2, 'Missing or ambiguous unlock spans');
    let previous = -1;
    for (const [i, input] of r.observations.inputs.entries()) {
      check(
        input.trusted === true &&
          nonnegative(input.start) &&
          Number.isFinite(input.nextFrame) &&
          input.nextFrame > input.start &&
          input.start >= previous,
        'Invalid trusted input timing',
      );
      const span = unlocks[i];
      check(
        nonnegative(span.start) &&
          nonnegative(span.end) &&
          nonnegative(span.duration) &&
          span.end >= span.start &&
          Math.abs(span.duration - (span.end - span.start)) <= 1e-6 &&
          span.start >= input.start &&
          span.end <= input.nextFrame,
        'Invalid or unpaired unlock timing',
      );
      previous = input.nextFrame;
    }
  }
  // Eighteen unique keys from this bounded domain are exactly 3 scenarios × 3 trials × cold/warm.
}

export function compareAudioReports(a, b, { currentRuntime } = {}) {
  validateReport(a);
  validateReport(b);
  check(a.hardware === b.hardware && a.browser === b.browser, 'Host/browser mismatch');
  check(a.instrumentation === b.instrumentation, 'Instrumentation mismatch');
  if (currentRuntime !== undefined)
    check(
      SHA.test(currentRuntime) && b.runtimeFingerprint.sha256 === currentRuntime,
      'Candidate audio evidence is stale for the current runtime source',
    );
  const rows = [];
  for (const scenario of Object.keys(scenarios)) {
    const aa = a.runs.filter((r) => r.scenario.label === scenario),
      bb = b.runs.filter((r) => r.scenario.label === scenario);
    check(
      JSON.stringify(aa.map((r) => [r.scenario, r.trial, r.cache])) ===
        JSON.stringify(bb.map((r) => [r.scenario, r.trial, r.cache])),
      'Scenario pairing mismatch',
    );
    const unlock = { baseline: stats(aa.map(firstUnlock)), candidate: stats(bb.map(firstUnlock)) };
    const input = { baseline: stats(aa.map(firstFrame)), candidate: stats(bb.map(firstFrame)) };
    const gain = 1 - input.candidate.median / input.baseline.median;
    check(unlock.candidate.median < unlock.baseline.median * 0.5, 'Unlock median must improve at least 50%');
    check(gain > 0.2, 'Actual input-to-rAF median must improve at least 20%');
    rows.push({ scenario, unlock, input, inputMedianImprovement: gain });
  }
  return {
    runtimeFingerprint: b.runtimeFingerprint,
    metric: 'trusted first key to next rAF; sound enabled; CPU profiling adds overhead; not field INP',
    rows,
    passed: true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const base = process.argv[2] ?? 'docs/launch/evidence/audio-p2/baseline-sound/startup.json';
  const candidate = process.argv[3] ?? 'docs/launch/evidence/audio-p2/candidate-v2/startup/startup.json';
  const output = process.argv[4] ?? 'docs/launch/evidence/audio-p2/comparison.json';
  const report = {
    baseline: resolve(base),
    candidate: resolve(candidate),
    ...compareAudioReports(
      JSON.parse(readFileSync(base)),
      JSON.parse(readFileSync(candidate)),
      process.argv.includes('--current-runtime') ? { currentRuntime: runtimeFingerprint().sha256 } : {},
    ),
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      report.rows.map((r) => ({
        scenario: r.scenario,
        unlock: [r.unlock.baseline.median, r.unlock.candidate.median],
        input: [r.input.baseline.median, r.input.candidate.median],
        improvement: r.inputMedianImprovement,
      })),
      null,
      2,
    ),
  );
}
