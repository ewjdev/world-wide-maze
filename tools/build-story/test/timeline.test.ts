import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { contractVersions, gateOf, mergedPhase, parseGitLog } from '../src/git.ts';
import { gaps, lanes, maxConcurrency, total, union } from '../src/intervals.ts';
import { countLines, linesByPackage } from '../src/lines.ts';
import { logWindows } from '../src/logs.ts';
import { extractSession, ownerText, wordCount } from '../src/session.ts';
import { buildTimeline, type TimelineInputs } from '../src/timeline.ts';

/** The fixture is readable text; turn it into what `git log --format=GIT_LOG_FORMAT` prints. */
const fixtureLog = readFileSync(new URL('./fixtures/git-log.txt', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((l) => l.split(' | ').join('\x1f'))
  .join('\x1e\n');
const commits = parseGitLog(fixtureLog);

const t = (hhmm: string) => `2026-09-25T${hhmm}:00Z`;

const row = (r: Record<string, unknown>) => JSON.stringify(r);
const mainJsonl = [
  row({ type: 'queue-operation', operation: 'dequeue', timestamp: t('07:15') }),
  row({
    type: 'user',
    timestamp: t('07:15'),
    message: { content: 'I want to learn everything about this old game, please' },
  }),
  row({ type: 'user', isMeta: true, timestamp: t('07:15'), message: { content: 'skill text, not typed' } }),
  row({
    type: 'user',
    timestamp: t('07:16'),
    message: { content: [{ type: 'tool_result', content: 'ls output' }] },
  }),
  row({ type: 'system', subtype: 'stop_hook_summary', timestamp: t('07:20') }),
  row({ type: 'queue-operation', operation: 'dequeue', timestamp: t('07:30') }),
  row({ type: 'user', timestamp: t('07:30'), message: { content: [{ type: 'text', text: 'yes, go' }] } }),
  row({ type: 'system', subtype: 'stop_hook_summary', timestamp: t('07:35') }),
  // a finish notice attached to another message, and a monitor event
  row({
    type: 'attachment',
    timestamp: t('08:10'),
    attachment: {
      prompt: '<task-notification>\n<task-id>aaa</task-id>\n<status>completed</status>\n</task-notification>',
    },
  }),
  row({
    type: 'user',
    origin: { kind: 'task-notification' },
    timestamp: t('08:30'),
    message: {
      content:
        '<task-notification><task-id>mon1</task-id><summary>Monitor event: "iPhone controller room events"</summary></task-notification>',
    },
  }),
  row({ type: 'user', timestamp: t('10:45'), message: { content: 'going to bed now' } }),
  row({
    type: 'user',
    timestamp: t('11:40'),
    message: {
      content:
        '<command-message>thought-partner</command-message>\n<command-name>/thought-partner</command-name>\n<command-args>list features</command-args>',
    },
  }),
].join('\n');

const agentJsonl = (from: string, to: string) =>
  [row({ type: 'user', timestamp: t(from) }), row({ type: 'assistant', timestamp: t(to) })].join('\n');
const session = extractSession('s1', mainJsonl, [
  {
    id: 'aaa',
    meta: { description: 'Phase 01 reference spec', worktreePath: '/w/aaa' },
    jsonl: agentJsonl('07:40', '08:10'),
  },
  {
    id: 'bbb',
    meta: { description: 'Phase 03 stage builder', worktreePath: '/w/bbb' },
    jsonl: agentJsonl('08:00', '08:40'),
  },
  {
    id: 'ccc',
    meta: { description: 'Helper audit', inheritedWorktreePath: '/w/bbb', worktreePath: '/w/bbb' },
    jsonl: agentJsonl('08:10', '08:20'),
  },
  {
    id: 'ddd',
    meta: { description: 'Builder/physics fixes from solver', worktreePath: '/w/ddd' },
    jsonl: agentJsonl('10:30', '11:30'),
  },
  {
    id: 'eee',
    meta: { description: 'Phase 13 link portals', worktreePath: '/w/eee' },
    jsonl: agentJsonl('11:10', '11:20'),
  },
]);

const phase01md = [
  '# Build log: Phase 01 (Reference)',
  '- **Agent:** Claude Opus 5.5 (1M context), run as a sub-agent.',
  '- **Start / end:** 2026-09-25 about 07:38Z → about 08:12Z.',
  '## Attempts that failed',
  '- one',
  '- two',
  '## Manual human interventions',
  'None.',
].join('\n');

const inputs: TimelineInputs = {
  commits,
  contractVersions: [{ version: '0.1.0', at: commits[0]?.at ?? '', sha: 'c01aaaa' }],
  session,
  births: { root: '~/x', method: 'stat', files: [{ path: '.', born: t('07:10') }] },
  tests: { commit: 'c09aaaa', command: 'vitest', passed: 12, skipped: 1, failed: 0, files: 3, byProject: [] },
  lines: [{ dir: 'packages/a', files: 2, sourceLines: 100, testLines: 40 }],
  logs: [{ slug: 'phase-01', md: phase01md }],
};
const timeline = buildTimeline(inputs);

describe('git log', () => {
  test('parses records, merges, gates', () => {
    expect(commits).toHaveLength(9);
    expect(commits[2]?.parents).toHaveLength(2);
    expect(commits.map(mergedPhase).filter(Boolean)).toEqual(['01', '03', '03b/05b']);
    expect(commits.map(gateOf).filter(Boolean)).toEqual(['G0', 'G1']);
  });
  test('contract versions: first appearance of each', () => {
    const v = contractVersions(commits, (sha) => (sha < 'c04' ? '0.1.0' : sha < 'c08' ? '0.2.1' : '0.2.2'));
    expect(v.map((x) => [x.version, x.sha])).toEqual([
      ['0.1.0', 'c01aaaa'],
      ['0.2.1', 'c04aaaa'],
      ['0.2.2', 'c08aaaa'],
    ]);
  });
});

describe('intervals', () => {
  const list = [
    { start: 0, end: 10 },
    { start: 5, end: 20 },
    { start: 20, end: 25 },
    { start: 40, end: 50 },
  ];
  test('union, gaps, concurrency, lanes', () => {
    expect(union(list)).toEqual([
      { start: 0, end: 25 },
      { start: 40, end: 50 },
    ]);
    expect(total(union(list))).toBe(35);
    expect(gaps(list, -5, 60, 6)).toEqual([
      { start: 25, end: 40 },
      { start: 50, end: 60 },
    ]);
    // back-to-back (20 → 20) is not an overlap
    expect(maxConcurrency(list)).toEqual({ max: 2, at: 5 });
    expect(lanes(list)).toEqual([0, 1, 0, 0]);
  });
});

describe('session extract', () => {
  test('keeps only what the owner typed, as counts', () => {
    expect(session.ownerMessages.map((m) => [m.at, m.words])).toEqual([
      [t('07:15'), 10],
      [t('07:30'), 2],
      [t('10:45'), 4],
      [t('11:40'), 2],
    ]);
    expect(JSON.stringify(session)).not.toContain('learn everything');
    expect(ownerText({ type: 'user', message: { content: '<task-notification>x' } })).toBeNull();
    expect(wordCount('yes — go, now!')).toBe(3);
  });
  test('turns, notifications attached to other messages, monitor events, helpers', () => {
    expect(session.turns).toEqual([
      { start: t('07:15'), end: t('07:20') },
      { start: t('07:30'), end: t('07:35') },
    ]);
    expect(session.agents.find((a) => a.id === 'aaa')?.notifiedAt).toBe(t('08:10'));
    expect(session.monitorEvents).toHaveLength(1);
    expect(session.agents.find((a) => a.id === 'ccc')).toMatchObject({ depth: 2, parentId: 'bbb' });
  });
});

describe('buildTimeline', () => {
  test('snapshot, start and wall clock', () => {
    expect(timeline.asOf.sha).toBe('c09aaaa');
    expect(timeline.start).toMatchObject({ at: t('07:10'), what: 'Project folder created' });
    expect(timeline.wallClock.min).toBe(230); // 07:10Z → 04:00 PT (11:00Z)
  });
  test('runs: exact spans, labels, running at the snapshot, merges, log windows', () => {
    expect(timeline.runs.map((r) => [r.phase, r.kind, r.span.min, r.running])).toEqual([
      ['01', 'phase', 30, false],
      ['03', 'phase', 40, false],
      ['03', 'helper', 10, false],
      ['03b/05b', 'follow-up', 30, true], // clipped at the snapshot
    ]);
    const p1 = timeline.runs[0];
    expect(p1?.merge?.sha).toBe('c03aaaa');
    expect(p1?.logWindow).toMatchObject({ start: t('07:38'), end: t('08:12'), min: 34, approx: true });
    expect(p1?.failedAttempts).toBe(2);
    expect(timeline.runs[3]?.merge?.sha).toBe('c08aaaa');
    expect(timeline.runs.map((r) => r.lane)).toEqual([0, 1, 0, 0]);
  });
  test('agent time, concurrency, active and idle time', () => {
    expect(timeline.agents).toMatchObject({
      runs: 4,
      helperRuns: 1,
      agentMin: 110,
      orchestratorMin: 10,
      maxConcurrent: 2,
      maxConcurrentAt: t('08:00'),
    });
    expect(timeline.active.min).toBe(100);
    expect(timeline.idle).toMatchObject({ min: 110, thresholdMin: 30 });
    expect(timeline.idle.spans[0]).toMatchObject({ start: t('08:40'), end: t('10:30') });
  });
  test('owner touchpoints inside the snapshot', () => {
    expect(timeline.owner).toMatchObject({ messages: 3, words: 16 });
    expect(timeline.owner.longestAway).toMatchObject({ start: t('07:30'), end: t('10:45'), min: 195 });
    expect(timeline.owner.agentMinWhileAway).toBe(95); // 30 + 40 + 10 + 15
    expect(timeline.owner.touchpoints.map((p) => p.kind)).toContain('device test');
  });
  test('git counts, gates, pre-git files, logs', () => {
    expect(timeline.git).toMatchObject({ commits: 9, merges: 3, phaseMerges: 3 });
    expect(timeline.gates.map((g) => g.id)).toEqual(['G0', 'G1']);
    expect(timeline.preGit.map((f) => f.path)).toEqual(['.']);
    expect(timeline.buildLogs).toMatchObject({ files: 1, failedAttempts: 2, humanInterventions: 0 });
    expect(timeline.agents.model).toBe('Claude Opus 5.5 (1M context)');
  });
});

describe('segments', () => {
  const tl = buildTimeline({
    ...inputs,
    segments: [
      { id: 'night-1', label: 'Night 1', short: 'a', what: 'up to G0', endsAt: 'Schema 0.2.1' },
      { id: 'day-2', label: 'Day 2', short: 'b', what: 'the rest', endsAt: null },
      {
        id: 'later',
        label: 'Later',
        short: 'c',
        what: 'not reached yet',
        endsAt: 'A commit that does not exist',
      },
    ],
    segmentLines: { 'night-1': [{ dir: 'packages/a', files: 1, sourceLines: 50, testLines: 5 }] },
    segmentTests: { 'night-1': { ...inputs.tests, commit: 'c04aaaa', passed: 3 } },
  });
  test('each stretch is measured like the whole, and they add up to it', () => {
    expect(tl.segments.map((s) => [s.id, s.end.sha, s.wallClock.start, s.wallClock.end])).toEqual([
      ['night-1', 'c04aaaa', t('07:10'), '2026-09-25T08:06:25Z'],
      ['day-2', 'c09aaaa', '2026-09-25T08:06:25Z', t('11:00')],
    ]);
    const [a, b] = tl.segments;
    // runs that start inside; agent time clipped: 07:40→08:06:25 (26.4) + 08:00→08:06:25 (6.4)
    expect(a?.agents).toMatchObject({ runs: 2, agentMin: 32.8, maxConcurrent: 2 });
    expect(b?.agents).toMatchObject({ runs: 2, helperRuns: 1 });
    expect((a?.agents.agentMin ?? 0) + (b?.agents.agentMin ?? 0)).toBeCloseTo(tl.agents.agentMin, 5);
    expect([a?.git.commits, b?.git.commits]).toEqual([4, 5]);
    expect([a?.owner.messages, b?.owner.messages]).toEqual([2, 1]);
    expect(a?.idle.min).toBe(0);
    expect(b?.idle.spans[0]).toMatchObject({ start: t('08:40'), end: t('10:30') });
    // earlier stretches take their counts at their own closing commit; the last one the snapshot's
    expect(a?.lines).toEqual({ source: 50, test: 5, files: 1 });
    expect(a?.tests?.passed).toBe(3);
    expect(b?.lines.source).toBe(100);
    expect(b?.tests?.passed).toBe(12);
  });
  test('a closing commit needs its line counts', () => {
    expect(() =>
      buildTimeline({
        ...inputs,
        segments: [{ id: 'x', label: 'X', short: 'x', what: '', endsAt: 'Schema 0.2.1' }],
      }),
    ).toThrow(/no line counts/);
  });
});

describe('build logs and lines', () => {
  test('every window in a log, in order', () => {
    const w = logWindows(
      '- **Start / end:** 2026-09-25 ~07:20Z → ~07:45Z.\n\n# Phase 02b\n- **Start / end:** 2026-09-25 ~07:50Z → ~08:10Z.\n- **Time:** 2026-09-25, about 23:50Z to 00:20Z.\n- **Start / end:** 2026-09-25 ~09:58 → ~10:45 PDT.',
    );
    expect(w.map((x) => [x.start, x.end])).toEqual([
      [t('07:20'), t('07:45')],
      [t('07:50'), t('08:10')],
      [t('23:50'), '2026-09-26T00:20:00Z'],
      [t('16:58'), t('17:45')],
    ]);
  });
  test('lines of code per package, tests apart, fixtures skipped', () => {
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
    expect(
      linesByPackage([
        { path: 'packages/a/src/x.ts', text: 'a\nb\n' },
        { path: 'packages/a/test/x.test.ts', text: 'a\n' },
        { path: 'packages/a/README.md', text: 'doc\n' },
        { path: 'fixtures/x.ts', text: 'a\n' },
        { path: 'apps/web/src/pages/x.css', text: 'a\nb\nc\nd\n' },
        { path: 'apps/web/fixtures/y.ts', text: 'a\n' },
      ]),
    ).toEqual([
      { dir: 'apps/web', files: 1, sourceLines: 4, testLines: 0 },
      { dir: 'packages/a', files: 2, sourceLines: 2, testLines: 1 },
    ]);
  });
});
