/** Read-only comparison of opt-in local audit evidence; no browser, server, or telemetry side effects. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const state = (run) => run?.after?.game?.state;
const memory = (run) => run?.after?.game?.rendererMemory;
const backend = (run) => state(run)?.engine?.backend;
const sameViewport = (a, b) =>
  a?.width === b?.width &&
  a?.height === b?.height &&
  (a?.deviceScaleFactor ?? 1) === (b?.deviceScaleFactor ?? 1);
const key = (run) =>
  JSON.stringify(run.spec ?? { quality: run.quality, throttle: run.throttle, name: run.name });
const otherResourceCounters = [
  'textures',
  'texturesSize',
  'renderTargets',
  'geometries',
  'programs',
  'storageAttributes',
  'storageAttributesSize',
  'readbackBuffers',
  'readbackBuffersSize',
  'indirectStorageAttributes',
  'indirectStorageAttributesSize',
  'indexAttributes',
  'indexAttributesSize',
  'uniformBuffers',
  'uniformBuffersSize',
];

const gpuIdentity = (report) => {
  const gpu = report.system?.gpu;
  if (!gpu || !Array.isArray(gpu.devices) || gpu.devices.length === 0 || !gpu.auxAttributes?.glRenderer)
    return null;
  return JSON.stringify({
    devices: gpu.devices,
    renderer: gpu.auxAttributes?.glRenderer,
    vendor: gpu.auxAttributes?.glVendor,
    implementation: gpu.auxAttributes?.glImplementationParts,
  });
};

export function compareEvidence(baseline, candidate, currentFingerprint, options = {}) {
  const gates = [];
  const add = (id, status, details) => gates.push({ id, status, ...details });
  // Include supplemental modes too: an error cannot disappear because a mode has no timing gate.
  for (const [mode, report] of Object.entries(candidate)) {
    if (report?.error || report?.errors?.length)
      add(`runtime-report:${mode}`, 'fail', { error: report.error, errors: report.errors });
  }
  const required = ['frames', 'gpu', 'replay', 'lifecycle'];
  for (const mode of required) {
    if (!baseline[mode] || !candidate[mode]) {
      add(`evidence:${mode}`, 'missing', { message: 'Both baseline and candidate evidence are required.' });
      continue;
    }
    const a = baseline[mode];
    const b = candidate[mode];
    const sameHost =
      a.hardware === b.hardware &&
      a.browser === b.browser &&
      a.headless === b.headless &&
      gpuIdentity(a) !== null &&
      gpuIdentity(a) === gpuIdentity(b) &&
      sameViewport(a.viewport ?? { width: 1440, height: 900 }, b.viewport);
    if (!b.runtimeFingerprint?.sha256)
      add(`source:${mode}`, 'missing', { message: 'Candidate runtime content fingerprint required.' });
    else if (currentFingerprint && b.runtimeFingerprint.sha256 !== currentFingerprint.sha256)
      add(`source:${mode}`, 'fail', {
        message: 'Native evidence is stale for the current runtime source.',
        measured: b.runtimeFingerprint,
        current: currentFingerprint,
      });
    else
      add(`source:${mode}`, 'pass', {
        measured: b.runtimeFingerprint,
        checkedAgainstCurrentTree: !!currentFingerprint,
      });
    if (
      b.servedBuild?.verified !== true ||
      b.servedBuild?.runtimeFingerprint?.sha256 !== b.runtimeFingerprint?.sha256 ||
      !b.servedBuild?.manifestSHA256 ||
      !b.servedBuild?.assets?.length
    )
      add(`served-build:${mode}`, 'missing', {
        message: 'Native evidence requires a source-bound build manifest and verified served asset hashes.',
      });
    add(`environment:${mode}`, sameHost ? 'pass' : 'review', {
      baseline: {
        commit: a.commit,
        hardware: a.hardware,
        browser: a.browser,
        headless: a.headless,
        viewport: a.viewport ?? 'legacy harness: 1440x900, verify source',
        date: a.date,
        gpu: gpuIdentity(a),
      },
      candidate: {
        commit: b.commit,
        hardware: b.hardware,
        browser: b.browser,
        headless: b.headless,
        viewport: b.viewport ?? 'legacy harness: 1440x900, verify source',
        date: b.date,
        gpu: gpuIdentity(b),
      },
      message: sameHost
        ? 'Host/browser match; compare scenario DPR, backend and workload below.'
        : 'Timing comparison requires review because host/browser/headless/GPU identity differs or is missing.',
    });
    if (!b.commit || !b.browser || !b.hardware || !b.date)
      add(`metadata:${mode}`, 'missing', { message: 'Candidate commit/browser/hardware/date required.' });
    for (const old of a.runs ?? []) {
      if (old.error || old.errors?.length || !finite(old.frame?.p95)) continue;
      const run = b.runs?.find((r) => key(r) === key(old));
      if (
        !run ||
        !finite(run.frame?.p95) ||
        run.frame.p95 <= 0 ||
        !finite(run.frame?.mean) ||
        run.frame.mean <= 0 ||
        !finite(run.frame?.n) ||
        run.frame.n < 30 ||
        !finite(run.fps) ||
        run.fps <= 0 ||
        !finite(run.elapsedMs) ||
        run.elapsedMs < old.elapsedMs * 0.8 ||
        run.frame.n * run.frame.mean < run.elapsedMs * 0.8 ||
        run.frame.n * run.frame.mean > run.elapsedMs * 1.2 ||
        !backend(run)
      )
        add(`scenario:${mode}:${key(old)}`, 'missing', {
          message:
            'Successful baseline scenario requires positive frame metrics, at least 30 samples covering the measurement window, at least 80% of baseline duration, and backend metadata.',
        });
    }
    if (mode === 'frames' && !(a.runs ?? []).some((r) => finite(r.frame?.p95) && !r.error))
      add('scenario:frames', 'missing', { message: 'No successful baseline frame scenarios.' });
    for (const run of b.runs ?? []) {
      if (run.error || run.errors?.length)
        add(`runtime:${mode}:${key(run)}`, 'fail', { error: run.error, errors: run.errors });
      if (!finite(run.frame?.p95)) continue;
      const old = a.runs?.find((r) => key(r) === key(run));
      if (!old || !finite(old.frame?.p95)) continue;
      const sameBackend = backend(old) === backend(run);
      const threshold = old.frame.p95 * 1.2 + 2;
      add(
        `timing:${mode}:${key(run)}`,
        !sameHost || !sameBackend || run.frame.p95 > threshold ? 'review' : 'pass',
        {
          baselineP95Ms: old.frame.p95,
          candidateP95Ms: run.frame.p95,
          reviewThresholdMs: threshold,
          baselineBackend: backend(old),
          candidateBackend: backend(run),
          message:
            'Timing is noisy. Review repeated paired trials; this is not a hard throughput or device certification gate.',
        },
      );
    }
  }

  for (const throttle of [1, 6, 20]) {
    const replay = candidate.replay?.runs?.find((r) => r.throttle === throttle);
    const end = state(replay);
    if (!end) add(`replay:${throttle}`, 'missing', { message: 'Completed reference replay required.' });
    else
      add(
        `replay:${throttle}`,
        end.phase === 'result' && end.tick === 5429 && end.total === 1484 && end.recording?.replays === 1
          ? 'pass'
          : 'fail',
        {
          actual: {
            phase: end.phase,
            ticks: end.tick,
            score: end.total,
            savedReplays: end.recording?.replays,
          },
          expected: { phase: 'result', ticks: 5429, score: 1484, savedReplays: 1 },
        },
      );
  }

  const low = candidate.gpu?.runs?.find((r) => r.quality === 'low');
  const down = candidate.gpu?.runs?.find((r) => r.quality === 'high-to-low');
  const baseDown = baseline.gpu?.runs?.find((r) => r.quality === 'high-to-low');
  const lowMemory = memory(low);
  const downMemory = memory(down);
  if (!finite(lowMemory?.total) || !finite(downMemory?.total))
    add('gpu:retained-targets', 'missing', {
      message: 'Fresh low and high-to-low renderer byte counters required.',
    });
  else {
    const gap = downMemory.total - lowMemory.total;
    const tolerance = Math.max(8 * 1024 * 1024, lowMemory.total * 0.1);
    const noExtraTargets = downMemory.renderTargets <= lowMemory.renderTargets;
    add('gpu:retained-targets', gap <= tolerance && noExtraTargets ? 'pass' : 'fail', {
      freshLowBytes: lowMemory.total,
      downshiftBytes: downMemory.total,
      excessBytes: gap,
      toleranceBytes: tolerance,
      freshLowTargets: lowMemory.renderTargets,
      downshiftTargets: downMemory.renderTargets,
      baselineDownshiftBytes: memory(baseDown)?.total ?? null,
      gainBytes: finite(memory(baseDown)?.total) ? memory(baseDown).total - downMemory.total : null,
      message:
        'Three.js resource estimates, not physical VRAM utilization. Budget allows small shader/geometry differences, never extra retained targets.',
    });
  }

  const retries = candidate.lifecycle?.retries;
  const oldRetries = baseline.lifecycle?.retries;
  if (!retries || retries.length < 5 || !oldRetries || oldRetries.length < 5)
    add('memory:retry-attributes', 'missing', {
      message: 'At least five post-GC retries in both baseline and candidate required.',
    });
  else {
    const slope = (runs, key) => {
      const first = runs[1]?.game?.rendererMemory?.[key];
      const last = runs.at(-1)?.game?.rendererMemory?.[key];
      return finite(first) && finite(last) ? (last - first) / (runs.length - 2) : null;
    };
    const bytesPerRetry = slope(retries, 'attributesSize');
    const baselineBytesPerRetry = slope(oldRetries, 'attributesSize');
    const attributesPerRetry = slope(retries, 'attributes');
    const baselineAttributesPerRetry = slope(oldRetries, 'attributes');
    if (![bytesPerRetry, baselineBytesPerRetry, attributesPerRetry, baselineAttributesPerRetry].every(finite))
      add('memory:retry-attributes', 'missing', {
        message: 'Baseline/candidate retry attribute bytes and counts required.',
      });
    else {
      const knownBound =
        baselineBytesPerRetry > 0 && baselineBytesPerRetry <= 44800 && baselineAttributesPerRetry <= 2;
      const worse =
        bytesPerRetry > Math.max(0, baselineBytesPerRetry) ||
        attributesPerRetry > Math.max(0, baselineAttributesPerRetry);
      const growth = bytesPerRetry > 0 || attributesPerRetry > 0;
      const rejectedGrowth = growth && (options.strictResourcePlateau || !knownBound);
      add('memory:retry-attributes', worse || rejectedGrowth ? 'fail' : growth ? 'known-failure' : 'pass', {
        issue: '#24',
        bytesPerRetry,
        baselineBytesPerRetry,
        attributesPerRetry,
        baselineAttributesPerRetry,
        growthBytes: bytesPerRetry * (retries.length - 2),
        retriesAfterWarmup: retries.length - 2,
        strictResourcePlateau: options.strictResourcePlateau === true,
        message:
          growth && options.strictResourcePlateau
            ? 'P2 requires a flat retained resource set; the historical #24 leak waiver is disabled.'
            : worse || rejectedGrowth
              ? 'New or worse attribute retention fails the P1 gate; it is not waived as P2.'
              : growth
                ? 'Existing P2 retention remains failing within the measured baseline bound. Memory acceptance remains open.'
                : 'No post-warmup attribute growth.',
      });
    }
    for (const allocation of otherResourceCounters) {
      const before = slope(oldRetries, allocation);
      const after = slope(retries, allocation);
      if (finite(before) && !finite(after))
        add(`memory:retry-${allocation}`, 'missing', { message: 'Candidate allocation counter missing.' });
      else if (finite(before) && finite(after) && after > Math.max(0, before) + 0.01)
        add(`memory:retry-${allocation}`, 'fail', {
          baselinePerRetry: before,
          candidatePerRetry: after,
          message: 'New/worse allocation growth is not covered by known P2 attribute retention.',
        });
    }
    if (options.strictResourcePlateau) {
      for (const allocation of ['attributes', 'attributesSize', ...otherResourceCounters]) {
        const values = retries.slice(1).map((r) => r.game?.rendererMemory?.[allocation]);
        const existed = oldRetries.some((r) => finite(r.game?.rendererMemory?.[allocation]));
        if (!existed && values.every((value) => value === undefined)) continue;
        const valid = values.every(finite);
        const aboveWarmup = valid && values.some((value) => value > values[0]);
        add(`memory:plateau-${allocation}`, !valid ? 'missing' : aboveWarmup ? 'fail' : 'pass', {
          warmup: values[0],
          checkpoints: values,
          message: !valid
            ? 'Every post-warmup resource checkpoint is required.'
            : aboveWarmup
              ? 'A resource checkpoint exceeds the warm retained set; endpoint recovery or historical growth cannot waive it.'
              : 'Every checkpoint remains within the warm retained set.',
        });
      }
    }
  }

  if (candidate.cache) {
    const rounds = candidate.cache.rounds?.filter((r) => r.variant === 'candidate') ?? [];
    const pass =
      candidate.cache.identicalStages === true &&
      rounds.length >= 2 &&
      rounds.every(
        (r) =>
          r.stages?.length >= 9 &&
          r.stages.every(
            (s) =>
              finite(s.decoded?.liveBytes) &&
              s.decoded.liveBytes <= 32 * 1024 * 1024 &&
              s.cache?.retainedBytes === s.decoded.liveBytes,
          ),
      );
    add('cache:decoded-bound-and-parity', pass ? 'pass' : 'fail', {
      rounds: rounds.length,
      budgetBytes: 32 * 1024 * 1024,
      identicalStages: candidate.cache.identicalStages,
    });
  }

  const failures = gates.filter((g) => g.status === 'fail');
  const missing = gates.filter((g) => g.status === 'missing');
  const knownFailures = gates.filter((g) => g.status === 'known-failure');
  const review = gates.filter((g) => g.status === 'review');
  const exitCode = failures.length
    ? 1
    : missing.length
      ? 2
      : review.length
        ? 4
        : knownFailures.length
          ? 3
          : 0;
  return {
    schemaVersion: 1,
    policy: { strictResourcePlateau: options.strictResourcePlateau === true },
    generatedAt: new Date().toISOString(),
    exitCode,
    status: ['pass', 'failed', 'incomplete', 'known-p2-failure', 'timing-review'][exitCode],
    limitations: [
      'No physical desktop/mobile, battery or thermal acceptance.',
      'CPU throttling does not emulate a weak GPU or worker CPU.',
      'Timing review requires repeated paired trials; metadata and resource/correctness gates are separate.',
      'Known P2 failures remain visible and return nonzero; this report does not authorize a production merge.',
    ],
    gates,
  };
}

export function readEvidence(directory) {
  const read = (name) => {
    const path = resolve(directory, `${name}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  };
  return {
    ...Object.fromEntries(
      ['frames', 'gpu', 'replay', 'lifecycle', 'stall', 'cold', 'idle', 'ghost', 'learning', 'overhead'].map(
        (mode) => [mode, read(mode)],
      ),
    ),
    cache: read('worker-tour'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [baseline, candidate, output] = process.argv.slice(2);
  if (!baseline || !candidate || !output) {
    console.error(
      'Usage: node infra/perf/p1-regression.mjs BASELINE_DIR CANDIDATE_DIR OUTPUT_JSON [--strict-resource-plateau]',
    );
    process.exitCode = 2;
  } else {
    const report = compareEvidence(readEvidence(baseline), readEvidence(candidate), runtimeFingerprint(), {
      strictResourcePlateau: process.argv.includes('--strict-resource-plateau'),
    });
    writeFileSync(resolve(output), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          status: report.status,
          exitCode: report.exitCode,
          gates: report.gates.map(({ id, status }) => ({ id, status })),
        },
        null,
        2,
      ),
    );
    process.exitCode = report.exitCode;
  }
}
