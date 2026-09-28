/** Portable, opt-in device evidence helpers. No product imports or accepted device budgets. */
export const FRAME_COLUMNS = ['atMs', 'intervalMs', 'animationDtSec', 'adaptiveDtSec', 'callWallMs'];
export const RAF_COLUMNS = ['atMs', 'intervalMs', 'visible'];
export function numericLog(width, limit = 240000) {
  const chunks = [];
  let rows = 0;
  return {
    append(values) {
      if (rows === limit || values.length !== width) return false;
      const chunk = Math.floor(rows / 1024);
      chunks[chunk] ??= new Float64Array(1024 * width);
      chunks[chunk].set(values, (rows % 1024) * width);
      rows++;
      return true;
    },
    get rows() {
      return rows;
    },
    export() {
      const out = [];
      for (let row = 0; row < rows; row++) {
        const chunk = chunks[Math.floor(row / 1024)];
        out.push(...chunk.subarray((row % 1024) * width, ((row % 1024) + 1) * width));
      }
      return out;
    },
  };
}
export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) ?? null,
  };
}
export function summarizeDevice(report) {
  const seconds = Math.ceil((report.elapsedMs ?? 0) / 60000);
  return Array.from({ length: seconds }, (_, window) => {
    const from = window * 60000,
      to = Math.min((window + 1) * 60000, report.elapsedMs);
    const browserIntervals = [],
      engineIntervals = [];
    for (let i = 0; i < (report.browserFrames?.length ?? 0); i += 3)
      if (
        report.browserFrames[i] >= from &&
        report.browserFrames[i] < to &&
        report.browserFrames[i + 2] === 1 &&
        report.browserFrames[i + 1] > 0
      )
        browserIntervals.push(report.browserFrames[i + 1]);
    for (let i = 0; i < (report.engineFrames?.length ?? 0); i += 5)
      if (report.engineFrames[i] >= from && report.engineFrames[i] < to && report.engineFrames[i + 1] > 0)
        engineIntervals.push(report.engineFrames[i + 1]);
    const snapshots = (report.snapshots ?? []).filter((x) => x.atMs >= from && x.atMs <= to);
    return {
      fromMs: from,
      toMs: to,
      browserIntervals: distribution(browserIntervals),
      engineIntervals: distribution(engineIntervals),
      firstSnapshot: snapshots[0] ?? null,
      lastSnapshot: snapshots.at(-1) ?? null,
    };
  });
}
const SHA = /^[a-f0-9]{64}$/;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
/** A complete dataset still needs human physical-device verification and accepted budgets. */
export function validateDevice(report, expected = {}) {
  const invalid = [],
    missing = [],
    limitations = [
      'Physical hardware identity is self-reported; this tool cannot certify a physical device.',
      'No accepted device floor or performance budget is selected by this validator.',
      'Engine call wall time is not CPU utilization. Allocation estimates are not GPU residency.',
      'Controller network RTT is not input-to-photon latency.',
    ];
  if (report?.schemaVersion !== 1)
    return { status: 'invalid', exitCode: 1, invalid: ['Unsupported evidence schema'], missing, limitations };
  const meta = report.metadata ?? {};
  for (const key of [
    'operator',
    'deviceModel',
    'osVersion',
    'browserVersion',
    'role',
    'scenario',
    'inputProtocol',
    'powerMode',
    'cacheState',
    'network',
  ])
    if (!text(meta[key]) || meta[key] === 'unknown') missing.push(`metadata.${key}`);
  if (!['desktop-game', 'mobile-game', 'phone-controller'].includes(meta.role))
    invalid.push('Unknown device role');
  if (meta.execution !== 'physical-self-reported')
    missing.push('Physical-device run (emulated/automated/unknown does not satisfy it)');
  if (
    /Headless|Playwright|SwiftShader/i.test(
      `${report.environment?.userAgent ?? ''} ${report.environment?.gpuDescription ?? ''}`,
    ) &&
    meta.execution === 'physical-self-reported'
  )
    invalid.push('Physical claim contradicts automated/software-browser metadata');
  if (report.environment?.webdriver && meta.execution === 'physical-self-reported')
    invalid.push('Physical claim contradicts navigator.webdriver');
  if (!text(meta.physicalEvidence))
    missing.push('Independent physical-device evidence or reviewer reference');
  if (!text(report.environment?.userAgent)) missing.push('Browser user agent');
  if (
    !(report.environment?.viewport?.width > 0) ||
    !(report.environment?.viewport?.height > 0) ||
    !(report.environment?.dpr > 0)
  )
    missing.push('Measured viewport/DPR');
  if (
    ![
      'steady-play',
      'adaptation',
      'lifecycle',
      'paused',
      'title',
      'hidden',
      'thermal',
      'controller',
    ].includes(meta.scenario)
  )
    invalid.push('Unknown scenario');
  if (!expected.runtimeSHA256) missing.push('Independent expected source fingerprint not supplied');
  const provenance = report.provenance ?? {};
  for (const key of ['runtimeSHA256', 'assetManifestSHA256', 'collectorSHA256', 'instrumentedHtmlSHA256'])
    if (!SHA.test(provenance[key] ?? '')) missing.push(`provenance.${key}`);
  if (provenance.assetsVerified !== true || provenance.htmlModifiedForCollector !== true)
    missing.push('Verified build and explicit instrumented-entry declaration');
  if (expected.runtimeSHA256 && provenance.runtimeSHA256 !== expected.runtimeSHA256)
    invalid.push('Evidence source fingerprint does not match expected build');
  if (expected.assetManifestSHA256 && provenance.assetManifestSHA256 !== expected.assetManifestSHA256)
    invalid.push('Evidence asset manifest does not match expected build');
  if (expected.collectorSHA256 && provenance.collectorSHA256 !== expected.collectorSHA256)
    invalid.push('Collector revision mismatch');
  if (!(report.elapsedMs > 0) || !Number.isFinite(report.elapsedMs))
    missing.push('Positive elapsed measurement window');
  if (!(meta.durationSeconds >= 5 && meta.durationSeconds <= 1800))
    invalid.push('Requested duration must be 5–1800 seconds');
  if (report.elapsedMs < meta.durationSeconds * 1000 * 0.95)
    missing.push('Requested duration was not completed');
  if (report.truncated) missing.push('Capture hit its bounded sample limit');
  for (const [key, width] of [
    ['browserFrames', 3],
    ['engineFrames', 5],
  ]) {
    const values = report[key];
    if (!Array.isArray(values) || values.length % width !== 0 || values.some((x) => !Number.isFinite(x))) {
      invalid.push(`Invalid ${key} raw data`);
      continue;
    }
    let previous = -1;
    for (let i = 0; i < values.length; i += width) {
      if (values[i] < previous || values[i] < 0 || values[i] > report.elapsedMs + 100)
        invalid.push(`${key} timestamps out of order/window`);
      if (i && values[i + 1] !== -1 && Math.abs(values[i + 1] - (values[i] - previous)) > 0.01)
        invalid.push(`${key} intervals disagree with timestamps`);
      if (key === 'engineFrames' && (values[i + 2] < 0 || values[i + 3] < -1 || values[i + 4] < 0))
        invalid.push('Invalid engine timing values');
      if (values[i + 1] < -1 || (key === 'browserFrames' && ![0, 1].includes(values[i + 2])))
        invalid.push(`${key} invalid interval/visibility`);
      previous = values[i];
    }
    if (
      values.length / width < 30 &&
      meta.scenario !== 'hidden' &&
      !(meta.role === 'phone-controller' && key === 'engineFrames')
    )
      missing.push(`${key}: fewer than 30 samples`);
  }
  const visibility = report.visibility;
  const visibleSegments = [];
  if (!Array.isArray(visibility) || !visibility.length || visibility[0].atMs !== 0)
    missing.push('Visibility history from start');
  else {
    let previous = -1;
    for (let i = 0; i < visibility.length; i++) {
      const entry = visibility[i],
        end = visibility[i + 1]?.atMs ?? report.elapsedMs;
      if (
        !['visible', 'hidden'].includes(entry.state) ||
        !Number.isFinite(entry.atMs) ||
        entry.atMs < previous ||
        entry.atMs > report.elapsedMs
      )
        invalid.push('Invalid visibility history');
      if (entry.state === 'visible') visibleSegments.push([entry.atMs, end]);
      previous = entry.atMs;
    }
    if (meta.scenario === 'hidden' && !visibility.some((x) => x.state === 'hidden'))
      missing.push('Hidden scenario has no actual hidden-document observation');
  }
  const observedVisibility = (at) =>
    Array.isArray(visibility) ? visibility.findLast((x) => x.atMs <= at)?.state : undefined;
  if (Array.isArray(report.browserFrames))
    for (let i = 0; i < report.browserFrames.length; i += 3)
      if (
        (report.browserFrames[i + 2] === 1 ? 'visible' : 'hidden') !==
        observedVisibility(report.browserFrames[i])
      )
        invalid.push('Frame visibility contradicts history');
  for (const [from, to] of visibleSegments)
    if (to - from > 2000) {
      for (const [key, width] of [
        ['browserFrames', 3],
        ['engineFrames', 5],
      ]) {
        if (key === 'engineFrames' && meta.role === 'phone-controller') continue;
        const values = report[key];
        if (!Array.isArray(values)) continue;
        const times = [];
        for (let i = 0; i < values.length; i += width)
          if (values[i] >= from && values[i] <= to) times.push(values[i]);
        if (!times.length || times[0] > from + 1500 || times.at(-1) < to - 1500)
          missing.push(`${key} does not cover visible window`);
        for (let i = 1; i < times.length; i++)
          if (times[i] - times[i - 1] > 5000) missing.push(`${key} has a visible gap over five seconds`);
      }
    }
  const snapshots = report.snapshots;
  if (
    meta.scenario === 'lifecycle' &&
    new Set((snapshots ?? []).map((x) => x.game?.phase).filter(Boolean)).size < 2
  )
    missing.push('Lifecycle scenario requires observed phase transitions');
  if (!Array.isArray(snapshots) || snapshots.length < 2)
    missing.push('Endpoint and sustained resource/phase snapshots');
  else {
    if (snapshots[0].atMs > 1500 || snapshots.at(-1).atMs < report.elapsedMs - 1500)
      missing.push('Snapshots do not cover the measured window');
    let previous = -1;
    for (const sample of snapshots) {
      if (!(sample.atMs >= previous && sample.atMs <= report.elapsedMs + 100))
        invalid.push('Snapshot timestamps invalid');
      previous = sample.atMs;
      if (sample.visibility !== observedVisibility(sample.atMs))
        invalid.push('Snapshot visibility contradicts history');
      const requiredPhase = { 'steady-play': 'play', adaptation: 'play', paused: 'paused', title: 'title' }[
        meta.scenario
      ];
      if (requiredPhase && sample.visibility === 'visible' && sample.game?.phase !== requiredPhase)
        missing.push(`Scenario requires observed ${requiredPhase} phase`);
      if (
        sample.visibility === 'visible' &&
        meta.role !== 'phone-controller' &&
        (!sample.game?.backend || !Number.isFinite(sample.game?.tier) || !sample.rendererMemory)
      )
        missing.push('Visible game sample lacks backend/tier/resource counters');
      if (
        sample.rendererMemory &&
        (!Object.keys(sample.rendererMemory).length ||
          Object.values(sample.rendererMemory).some((x) => !Number.isFinite(x) || x < 0))
      )
        invalid.push('Invalid retained resource counters');
      if (
        sample.game &&
        (!['webgpu', 'webgl2'].includes(sample.game.backend) ||
          !Number.isInteger(sample.game.tier) ||
          sample.game.tier < 0 ||
          sample.game.tier > 4)
      )
        invalid.push('Invalid renderer backend or tier');
      if (sample.visibility === 'visible' && meta.role === 'phone-controller' && !sample.controller)
        missing.push('Visible controller sample lacks controller diagnostics');
    }
    // Hidden windows are intentionally sparse; visible sustained windows need regular snapshots.
    for (let i = 1; i < snapshots.length; i++)
      if (
        visibleSegments.some(
          ([from, to]) => Math.min(to, snapshots[i].atMs) - Math.max(from, snapshots[i - 1].atMs) > 5000,
        )
      )
        missing.push('Visible snapshot gap exceeds five seconds');
  }
  for (const metric of ['cpuUtilization', 'gpuUtilization', 'inputToPhotonMs', 'workerMemoryBytes']) {
    if (report.unavailable?.[metric] !== null)
      invalid.push(`${metric} must remain unavailable; attach independently measured evidence separately`);
  }
  if (!Array.isArray(report.errors)) missing.push('Page error capture');
  if (report.errors?.length) invalid.push('Page errors occurred during capture');
  if (meta.scenario === 'thermal') {
    if (report.elapsedMs < 900000 || visibleSegments.reduce((sum, [from, to]) => sum + to - from, 0) < 900000)
      missing.push('Thermal scenario requires 15 visible minutes');
    if (meta.role !== 'phone-controller') {
      const visible = (Array.isArray(snapshots) ? snapshots : []).filter((x) => x.visibility === 'visible');
      const activeFraction =
        visible.filter((x) => x.game?.phase === 'play').length / Math.max(1, visible.length);
      if (activeFraction < 0.9)
        missing.push('Thermal workload requires at least 90% visible snapshots in active play');
    }
    if (meta.role !== 'phone-controller')
      for (let from = 0; from + 60000 <= report.elapsedMs; from += 60000) {
        if (
          !Array.isArray(snapshots) ||
          !snapshots.some(
            (x) =>
              x.atMs >= from &&
              x.atMs < from + 60000 &&
              x.visibility === 'visible' &&
              x.game?.phase === 'play',
          )
        )
          missing.push('Thermal game scenario needs observed active play in every full minute');
      }
    for (const key of [
      'batteryStart',
      'batteryEnd',
      'charging',
      'brightness',
      'ambient',
      'thermalObservation',
    ])
      if (!text(meta[key])) missing.push(`Thermal metadata ${key}`);
  }
  return {
    status: invalid.length ? 'invalid' : missing.length ? 'incomplete' : 'review-required',
    exitCode: invalid.length ? 1 : missing.length ? 2 : 3,
    physicalAcceptance: 'not-certified',
    activeSnapshotFraction: Array.isArray(snapshots)
      ? snapshots.filter((x) => x.visibility === 'visible' && x.game?.phase === 'play').length /
        Math.max(1, snapshots.filter((x) => x.visibility === 'visible').length)
      : null,
    invalid: [...new Set(invalid)],
    missing: [...new Set(missing)],
    limitations,
    trends: invalid.length ? [] : summarizeDevice(report),
  };
}
