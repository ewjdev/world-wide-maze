/**
 * buildTimeline(): git history + build logs + the session extract + file birth times + a Vitest report → the
 * Timeline. Pure: every input is passed in, so the tests can feed fixtures and get the same numbers every time.
 */
import { OWNER_LABELS, RUN_LABELS, type RunLabel, TIME_ZONE, UNKNOWNS } from './annotations.ts';
import { gateOf, mergedPhase } from './git.ts';
import {
  clip,
  gaps,
  type Interval,
  iso,
  lanes,
  maxConcurrency,
  minutes,
  toMs,
  total,
  union,
} from './intervals.ts';
import { logFacts, logWindows } from './logs.ts';
import type {
  Commit,
  FileBirths,
  PackageLines,
  Run,
  SessionExtract,
  Span,
  TestCounts,
  Timeline,
} from './types.ts';

export interface TimelineInputs {
  /** Commits reachable from HEAD, oldest first. */
  commits: Commit[];
  contractVersions: Timeline['contractVersions'];
  session: SessionExtract;
  births: FileBirths;
  tests: TestCounts;
  lines: PackageLines[];
  logs: { slug: string; md: string }[];
  /** A stretch with nothing running for at least this long counts as idle. */
  idleThresholdMin?: number;
}

const span = (i: Interval): Span => ({ start: iso(i.start), end: iso(i.end), min: minutes(i.end - i.start) });

export function buildTimeline(inp: TimelineInputs): Timeline {
  const head = inp.commits[inp.commits.length - 1];
  const first = inp.commits[0];
  if (!head || !first) throw new Error('no commits');
  const asOf = toMs(head.at);
  const threshold = inp.idleThresholdMin ?? 30;

  // ── start: the earliest recorded moment of this project ──
  const folder = inp.births.files.find((f) => f.path === '.');
  const firstMessage = inp.session.ownerMessages[0];
  const candidates = [
    folder && { at: toMs(folder.born), what: 'Project folder created', kind: 'file-birth' as const },
    firstMessage && {
      at: toMs(firstMessage.at),
      what: 'First message to the agent',
      kind: 'session' as const,
    },
    { at: toMs(first.at), what: 'First commit', kind: 'git' as const },
  ].filter((c): c is { at: number; what: string; kind: 'file-birth' | 'session' | 'git' } => !!c);
  const start = candidates.reduce((a, b) => (b.at < a.at ? b : a));
  const wall: Interval = { start: start.at, end: asOf };

  // ── agent runs ──
  const logs = new Map(inp.logs.map((l) => [l.slug, l.md]));
  const facts = logFacts(inp.logs);
  const labelOf = new Map<string, RunLabel>();
  const merges = inp.commits.filter((c) => mergedPhase(c));
  const known = inp.session.agents.filter((a) => toMs(a.start) < asOf);
  const runs: Run[] = known.map((a) => {
    let label: RunLabel = RUN_LABELS[a.description] ?? {
      phase: '?',
      title: a.description,
      wave: -1,
      kind: 'phase',
    };
    if (a.depth > 1) {
      const parent = a.parentId ? labelOf.get(a.parentId) : undefined;
      label = {
        phase: parent?.phase ?? '?',
        title: a.description,
        wave: parent?.wave ?? -1,
        kind: 'helper',
      };
    }
    labelOf.set(a.id, label);
    // still working after the snapshot (its transcript goes on past HEAD's commit time)
    const running = toMs(a.end) > asOf;
    const s = toMs(a.start);
    const e = running ? asOf : Math.min(asOf, toMs(a.end));
    const w = label.log ? logWindows(logs.get(label.log.slug) ?? '')[label.log.window] : undefined;
    const merge = merges.find((c) => mergedPhase(c) === label.phase);
    return {
      phase: label.phase,
      title: label.title,
      wave: label.wave,
      kind: label.kind,
      agentId: a.id,
      span: span({ start: s, end: e }),
      running,
      logWindow: w
        ? { ...span({ start: toMs(w.start), end: toMs(w.end) }), approx: w.approx, text: w.text }
        : null,
      log: label.log?.slug ?? null,
      failedAttempts:
        label.kind === 'phase' && label.log ? (facts.failedBySlug.get(label.log.slug) ?? null) : null,
      merge:
        label.kind === 'helper' || !merge
          ? null
          : { sha: merge.sha.slice(0, 7), at: merge.at, subject: merge.subject },
      lane: 0,
    };
  });
  const runIntervals = runs.map((r) => ({ start: toMs(r.span.start), end: toMs(r.span.end) }));
  lanes(runIntervals).forEach((lane, k) => {
    const r = runs[k];
    if (r) r.lane = lane;
  });

  // ── the orchestrating session ──
  const turns = clip(
    inp.session.turns.map((t) => ({ start: toMs(t.start), end: toMs(t.end) })),
    wall.start,
    asOf,
  );
  const active = union(clip([...runIntervals, ...turns], wall.start, asOf));
  const idle = gaps(active, wall.start, asOf, threshold * 60_000);
  const conc = maxConcurrency(runIntervals);
  const agentMs = total(runIntervals);

  // ── the owner ──
  const msgs = inp.session.ownerMessages.filter((m) => toMs(m.at) >= wall.start && toMs(m.at) <= asOf);
  let away: Interval = { start: wall.start, end: wall.start };
  for (let k = 1; k < msgs.length; k++) {
    const a = toMs(msgs[k - 1]?.at ?? '');
    const b = toMs(msgs[k]?.at ?? '');
    if (b - a > away.end - away.start) away = { start: a, end: b };
  }
  const session = { kind: 'session' as const, ref: 'content/build-story/sources/session.json' };
  const touchpoints: Timeline['owner']['touchpoints'] = msgs.map((m) => {
    const l = OWNER_LABELS[m.at.slice(0, 16)];
    return {
      at: m.at,
      kind: l?.kind ?? 'message',
      label: l?.label ?? 'Message to the orchestrator',
      words: m.words,
      source: session,
    };
  });
  const device = inp.session.monitorEvents.filter((e) => /iphone|controller/i.test(e.summary));
  const firstDevice = device[0];
  if (firstDevice && toMs(firstDevice.at) <= asOf)
    touchpoints.push({
      at: firstDevice.at,
      kind: 'device test',
      label: 'Physical iPhone test: the owner tilts the phone while the relay records 60 Hz input',
      words: null,
      source: { kind: 'build-log', ref: 'docs/build-log/phase-06-device-test.md#results' },
    });
  touchpoints.sort((a, b) => a.at.localeCompare(b.at));

  const gates = inp.commits.flatMap((c) => {
    const g = gateOf(c);
    return g ? [{ id: g, at: c.at, sha: c.sha.slice(0, 7), subject: c.subject }] : [];
  });

  const t = inp.lines.reduce(
    (a, p) => ({ source: a.source + p.sourceLines, test: a.test + p.testLines, files: a.files + p.files }),
    { source: 0, test: 0, files: 0 },
  );

  return {
    schema: 1,
    asOf: { sha: head.sha.slice(0, 7), at: head.at, subject: head.subject },
    timeZone: TIME_ZONE,
    start: {
      at: iso(start.at),
      what: start.what,
      source:
        start.kind === 'file-birth'
          ? { kind: 'file-birth', ref: `${inp.births.method}: ${inp.births.root}` }
          : start.kind === 'session'
            ? session
            : { kind: 'git', ref: first.sha.slice(0, 7) },
    },
    wallClock: span(wall),
    active: {
      min: minutes(total(active)),
      spans: active.map(span),
      source: {
        kind: 'session',
        ref: 'union of sub-agent runs and orchestrator turns, sources/session.json',
      },
    },
    idle: { min: minutes(total(idle)), thresholdMin: threshold, spans: idle.map(span) },
    agents: {
      runs: runs.length,
      phaseRuns: runs.filter((r) => r.kind === 'phase').length,
      followUpRuns: runs.filter((r) => r.kind === 'follow-up').length,
      helperRuns: runs.filter((r) => r.kind === 'helper').length,
      agentMin: minutes(agentMs),
      orchestratorMin: minutes(total(turns)),
      maxConcurrent: conc.max,
      maxConcurrentAt: Number.isNaN(conc.at) ? iso(wall.start) : iso(conc.at),
      meanConcurrency: Math.round((agentMs / Math.max(1, total(union(runIntervals)))) * 100) / 100,
      model: facts.model,
      source: { kind: 'session', ref: 'sources/session.json agents[] (first to last transcript event)' },
    },
    runs,
    orchestratorTurns: turns.map(span),
    owner: {
      messages: msgs.length,
      words: msgs.reduce((a, m) => a + m.words, 0),
      longestAway: span(away),
      agentMinWhileAway: minutes(total(clip(runIntervals, away.start, away.end))),
      touchpoints,
    },
    gates,
    contractVersions: inp.contractVersions,
    preGit: inp.births.files
      .filter((f) => toMs(f.born) < toMs(first.at))
      .map((f) => ({ path: f.path, born: f.born, source: { kind: 'file-birth', ref: inp.births.method } })),
    git: {
      commits: inp.commits.length,
      merges: inp.commits.filter((c) => c.parents.length > 1).length,
      phaseMerges: merges.length,
      firstCommit: { sha: first.sha.slice(0, 7), at: first.at, subject: first.subject },
      source: { kind: 'git', ref: `git log ${head.sha.slice(0, 7)} (${inp.commits.length} commits)` },
    },
    tests: { ...inp.tests, source: { kind: 'vitest', ref: inp.tests.command } },
    lines: {
      total: t,
      byPackage: inp.lines,
      source: {
        kind: 'git',
        ref: 'git ls-files; code files (.ts .tsx .css .mjs .js .html .sql) outside fixtures',
      },
    },
    buildLogs: {
      files: facts.files,
      failedAttempts: facts.failedAttempts,
      humanInterventions: facts.humanInterventions,
      source: {
        kind: 'build-log',
        ref: 'docs/build-log/*.md, parsed by apps/web/src/pages/log/parse-log.ts',
      },
    },
    unknowns: UNKNOWNS,
    estimates: [],
  };
}
