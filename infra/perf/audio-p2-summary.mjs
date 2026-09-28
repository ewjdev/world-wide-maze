/** Compare all sound-enabled product samples; no discarded outliers or synthetic worker timing. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.argv[2] ?? 'docs/launch/evidence/audio-p2/baseline-sound/startup.json';
const candidate = process.argv[3] ?? 'docs/launch/evidence/audio-p2/candidate-v2/startup/startup.json';
const output = process.argv[4] ?? 'docs/launch/evidence/audio-p2/comparison.json';
const a = JSON.parse(readFileSync(base)),
  b = JSON.parse(readFileSync(candidate));
const stats = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, min: s[0], median: (s[2] + s[3]) / 2, max: s.at(-1), values };
};
const firstUnlock = (r) => r.observations.spans.find((s) => s.name === 'audio.unlock').duration;
const firstFrame = (r) => r.observations.inputs[0].nextFrame - r.observations.inputs[0].start;
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
check(a.muted === false && b.muted === false, 'Both timed products must have sound enabled');
check(a.hardware === b.hardware && a.browser === b.browser, 'Host/browser mismatch');
check(a.runs.length === 18 && b.runs.length === 18, 'Incomplete18-run collection');
check(!a.error && !b.error, 'Collector failed');
for (const report of [a, b]) {
  check(
    report.servedBuild.verified &&
      report.servedBuild.runtimeFingerprint.sha256 === report.runtimeFingerprint.sha256,
    'Unverified served build',
  );
  for (const r of report.runs)
    check(
      !r.errors.length && r.observations.inputs.length === 2 && r.observations.inputs.every((i) => i.trusted),
      'Browser errors or missing trusted inputs',
    );
}
const rows = [];
for (const scenario of ['native', 'cpu6-slow10mbps', 'learning-cpu6']) {
  const aa = a.runs.filter((r) => r.scenario.label === scenario),
    bb = b.runs.filter((r) => r.scenario.label === scenario);
  check(aa.length === 6 && bb.length === 6, 'Missing cold/warm trials');
  check(
    JSON.stringify(aa.map((r) => [r.scenario, r.trial, r.cache])) ===
      JSON.stringify(bb.map((r) => [r.scenario, r.trial, r.cache])),
    'Scenario pairing mismatch',
  );
  const unlock = { baseline: stats(aa.map(firstUnlock)), candidate: stats(bb.map(firstUnlock)) };
  const input = { baseline: stats(aa.map(firstFrame)), candidate: stats(bb.map(firstFrame)) };
  const gain = 1 - input.candidate.median / input.baseline.median;
  check(unlock.candidate.median < unlock.baseline.median * 0.5, 'Unlock median must improve at least50%');
  check(gain > 0.2, 'Actual input-to-rAF median must improve at least20%');
  rows.push({ scenario, unlock, input, inputMedianImprovement: gain });
}
const report = {
  baseline: resolve(base),
  candidate: resolve(candidate),
  runtimeFingerprint: b.runtimeFingerprint,
  metric: 'trusted first key to next rAF; sound enabled; CPU profiling adds overhead; not field INP',
  rows,
  passed: true,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    rows.map((r) => ({
      scenario: r.scenario,
      unlock: [r.unlock.baseline.median, r.unlock.candidate.median],
      input: [r.input.baseline.median, r.input.candidate.median],
      improvement: r.inputMedianImprovement,
    })),
    null,
    2,
  ),
);
