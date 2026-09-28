import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareAudioReports } from './audio-p2-summary.mjs';

const baseline = JSON.parse(
  readFileSync(new URL('../../docs/launch/evidence/audio-p2/baseline-sound/startup.json', import.meta.url)),
);
const candidate = JSON.parse(
  readFileSync(
    new URL('../../docs/launch/evidence/audio-p2/candidate-v2/startup/startup.json', import.meta.url),
  ),
);
const pair = () => [structuredClone(baseline), structuredClone(candidate)];
test('all actual sound-enabled trials and outliers remain accepted', () => {
  const r = compareAudioReports(baseline, candidate, { currentRuntime: candidate.runtimeFingerprint.sha256 });
  assert.equal(r.passed, true);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].input.baseline.n, 6);
  assert.equal(r.rows[0].input.baseline.max, 156.20000004768372);
});
test('current-runtime option rejects otherwise valid historical evidence', () => {
  assert.throws(() => compareAudioReports(baseline, candidate, { currentRuntime: 'a'.repeat(64) }), /stale/);
});
test('both arms missing equal identity does not count as a matched host', () => {
  for (const key of ['hardware', 'browser', 'date', 'commit', 'instrumentation']) {
    const [a, b] = pair();
    delete a[key];
    delete b[key];
    assert.throws(() => compareAudioReports(a, b), /metadata/);
  }
});
test('a verified flag without an asset manifest is insufficient', () => {
  for (const key of ['assets', 'manifestSHA256', 'verifiedAt', 'builtAt', 'commit', 'runtimeFingerprint']) {
    const [a, b] = pair();
    delete b.servedBuild[key];
    assert.throws(() => compareAudioReports(a, b), /build|inventory/);
  }
});
test('tampered manifest bytes and duplicate or missing entry assets fail', () => {
  for (const mutate of [
    (b) => {
      b.servedBuild.assets[0].bytes++;
    },
    (b) => {
      b.servedBuild.assets.push(b.servedBuild.assets[0]);
    },
    (b) => {
      b.servedBuild.assets = b.servedBuild.assets.filter((x) => x.path !== 'index.html');
    },
  ]) {
    const [a, b] = pair();
    mutate(b);
    assert.throws(() => compareAudioReports(a, b), /manifest|asset|inventory/);
  }
});
test('negative, zero, nonfinite and reversed input timing cannot look faster', () => {
  for (const value of [-1, 0, NaN, Infinity]) {
    const [a, b] = pair();
    for (const r of b.runs) r.observations.inputs[0].nextFrame = r.observations.inputs[0].start + value;
    assert.throws(() => compareAudioReports(a, b), /input timing/);
  }
  const [a, b] = pair();
  b.runs[0].observations.inputs.reverse();
  assert.throws(() => compareAudioReports(a, b), /timing/);
});
test('invalid unlock durations and detached spans cannot look faster', () => {
  for (const mutate of [
    (s) => {
      s.duration = -1;
    },
    (s) => {
      s.duration = NaN;
    },
    (s) => {
      s.duration = Infinity;
    },
    (s) => {
      s.duration = 0;
    },
    (s) => {
      s.start = 0;
      s.end = s.duration;
    },
    (s) => {
      s.end = s.start - 1;
    },
  ]) {
    const [a, b] = pair();
    mutate(b.runs[0].observations.spans.find((s) => s.name === 'audio.unlock'));
    assert.throws(() => compareAudioReports(a, b), /unlock timing/);
  }
});
test('duplicated matching cases in both arms cannot replace missing cold/warm trials', () => {
  const [a, b] = pair();
  a.runs[1] = structuredClone(a.runs[0]);
  b.runs[1] = structuredClone(b.runs[0]);
  assert.throws(() => compareAudioReports(a, b), /Duplicate/);
});
test('wrong trial numbers, missing cases and renamed or changed workloads fail', () => {
  for (const mutate of [
    (r) => {
      r.trial = 3;
    },
    (r) => {
      r.cache = 'hot';
    },
    (r) => {
      r.scenario.label = 'other';
    },
    (r) => {
      r.scenario.throttle = 0;
    },
  ]) {
    const [a, b] = pair();
    mutate(a.runs[0]);
    mutate(b.runs[0]);
    assert.throws(() => compareAudioReports(a, b), /scenario|case/);
  }
  const [a, b] = pair();
  b.runs.pop();
  assert.throws(() => compareAudioReports(a, b), /18-run/);
});
test('missing trusted input or observed browser error is rejected', () => {
  for (const mutate of [
    (r) => {
      r.observations.inputs[1].trusted = false;
    },
    (r) => {
      r.errors.push('error');
    },
    (r) => {
      r.observations.spans = r.observations.spans.filter((s) => s.name !== 'audio.unlock');
    },
  ]) {
    const [a, b] = pair();
    mutate(b.runs[0]);
    assert.throws(() => compareAudioReports(a, b), /input|errors|spans/);
  }
});
test('valid but unimproved samples still fail measured gain requirement', () => {
  assert.throws(() => compareAudioReports(baseline, baseline), /improve/);
});
