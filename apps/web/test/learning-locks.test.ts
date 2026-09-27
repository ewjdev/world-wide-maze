/**
 * Phase 22 M3: binding a level's steps to a maze (locks.ts), missions, level resolution, and the session's lock
 * behaviour through a fake LockPort.
 *
 * - Property tests: the binding invariants (a) cuts ≥ j closed → host j reachable, (b) cut j closed → goal
 *   unreachable, (c) all open → every island reachable, (d) liveness, plus "the configuration is honoured exactly",
 *   on random island graphs (fast-check) and on real stages built from the capture fixtures (the batch-eval set).
 * - `WWM_LOCK_COVERAGE=1` runs the whole batch-eval set (every capture × slice × easy/normal/hard × seeds 1–3) and
 *   writes the coverage report to /tmp/wwm-p22-coverage.json; the default run takes a small sample.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Engine } from '@wwm/engine';
import {
  type Activity,
  baselinePath,
  type LearningPath,
  levelPlan,
  levelsFor,
  type PlanStep,
  parseLearningPath,
  type ResolvedLocks,
  resolveLocks,
  systemLineId,
} from '@wwm/learning';
import { type Difficulty, type StageData, sliceCount } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { listCaptureSlugs, loadCapture } from '@wwm/stage-builder/node';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { SimDriver } from '../src/game/sim-driver.ts';
import { GUARD_LINE_MS, LearningGates, LOCKED_LINE_MS, lockedLine } from '../src/learning/gates.ts';
import { missionHref, parseLearningHref } from '../src/learning/href.ts';
import { gameLevels, levelSummaries, pickLevel, SUPPORTS } from '../src/learning/levels.ts';
import { type LoadedLesson, lessonFromBaseline } from '../src/learning/load.ts';
import {
  allowedIslands,
  bindLevel,
  checkBinding,
  cutChain,
  islandGraph,
  islandPath,
  type LockBinding,
  minCut,
} from '../src/learning/locks.ts';
import { collectCount, gemsByIsland, islandLetters, resolveReach } from '../src/learning/missions.ts';
import type { GateSpot } from '../src/learning/placement.ts';
import { createLockPort, FakeLockPort } from '../src/learning/port.ts';

const HANDMADE = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;

const activity = (id: string) => {
  const a = baselinePath.activities.find((x) => x.id === id);
  if (!a) throw new Error(id);
  return a;
};
const compare = activity('compare-groups');
const level = (a: Activity, id: string) => {
  const l = levelsFor(a).find((x) => x.id === id);
  if (!l) throw new Error(id);
  return l;
};
const bind = (a: Activity, id: string, stage = HANDMADE) =>
  bindLevel(stage, levelPlan(a, level(a, id)), resolveLocks(level(a, id)));

/** Every level's configuration is honoured exactly (plan Acceptance, "Lock configuration is honoured"). */
function honoured(b: LockBinding, config: Pick<ResolvedLocks, 'mode' | 'connectors' | 'goal'>): string[] {
  const out: string[] = [];
  const kinds = new Set(b.locks.map((l) => l.kind));
  if (config.mode === 'none' && b.locks.length > 0) out.push('mode none locked something');
  if (config.mode === 'goal' && b.locks.some((l) => l.kind !== 'goal')) out.push('mode goal locked the way');
  if (kinds.has('elevator') && !config.connectors.includes('elevator')) out.push('an elevator lock');
  if (kinds.has('bridge') && !config.connectors.includes('bridge')) out.push('a bridge lock');
  for (const s of b.steps) {
    if (s.step.lock === 'none' && (s.lockIds.length > 0 || s.goal)) out.push(`step ${s.index}: none locked`);
    if (s.step.lock === 'goal' && s.lockIds.length > 0) out.push(`step ${s.index}: goal locked the way`);
    if (s.step.lock === 'path' && s.spot && s.lockIds.length === 0 && !s.goal)
      out.push(`step ${s.index}: a path step dropped silently`);
  }
  const needsGoal = b.steps.some((s) => s.goal);
  if (needsGoal !== (b.goalLockId !== null)) out.push('goal lock mismatch');
  if (
    !config.goal &&
    b.steps.every((s) => s.fallback === null) &&
    b.steps.every((s) => s.step.lock !== 'goal')
  )
    if (b.goalLockId !== null) out.push('goal: false still locked the finish');
  return out;
}

// ── the practice stage ────────────────────────────────────────────────────────────────────────────────────

describe('the island graph (practice stage)', () => {
  test('graph, BFS path, min cuts and the chain', () => {
    const g = islandGraph(HANDMADE);
    expect(g.islands).toEqual([0, 1, 2, 3]);
    expect(g.edges.map((e) => `${e.kind}${e.id}:${e.a}-${e.b}`)).toEqual([
      'bridge0:0-1',
      'bridge1:0-1',
      'bridge2:0-1',
      'bridge3:1-2',
      'elevator0:2-3',
    ]);
    expect(islandPath(g)).toEqual([0, 1, 2, 3]);
    // three parallel bridges: the cut closest to the start is all three
    const all = () => true;
    expect(minCut(g, new Set([0]), 3, all)?.edges).toEqual([0, 1, 2]);
    // bridges only: the lift can't be cut, so the cut is still in front of it
    const bridges = (e: { kind: string }) => e.kind === 'bridge';
    expect(minCut(g, new Set([0, 1, 2]), 3, bridges)).toBeNull();
    expect(cutChain(g, all).map((c) => c.edges)).toEqual([[0, 1, 2], [3], [4]]);
    expect(cutChain(g, bridges).map((c) => c.edges)).toEqual([[0, 1, 2], [3]]);
    expect(minCut(g, new Set([3]), 3, all)).toBeNull();
  });

  test('gated: every step has a lock (bridge, lift, or the finish when the chokepoints run out)', () => {
    const b = bind(compare, 'gated');
    expect(checkBinding(b)).toEqual([]);
    // three chokepoints (the three parallel bridges are one link), four steps: the last one keeps the finish shut
    expect(b.steps.map((s) => [s.lock, s.spot?.islandId, s.fallback])).toEqual([
      ['path', 0, null],
      ['path', 1, null],
      ['path', 2, null],
      ['goal', 3, 'no-cut'],
    ]);
    expect(b.locks).toEqual([
      { id: 0, kind: 'bridge', targetId: 0, islandId: 0 },
      { id: 1, kind: 'bridge', targetId: 1, islandId: 0 },
      { id: 2, kind: 'bridge', targetId: 2, islandId: 0 },
      { id: 3, kind: 'bridge', targetId: 3, islandId: 1 },
      { id: 4, kind: 'elevator', targetId: 0, islandId: 2 },
      { id: 5, kind: 'goal', targetId: 0, islandId: 3 },
    ]);
    expect(b.coverage).toEqual({ path: 4, physical: 3, fallback: 1, unplaced: 0 });
    // the region guard's allowed islands follow the closed locks
    expect([...allowedIslands(b, new Set([0, 1, 2, 3, 4]))].sort()).toEqual([0]);
    expect([...allowedIslands(b, new Set([3, 4]))].sort()).toEqual([0, 1]);
    expect([...allowedIslands(b, new Set([4]))].sort()).toEqual([0, 1, 2]);
    expect([...allowedIslands(b, new Set())].sort()).toEqual([0, 1, 2, 3]);
  });

  test('each level of every baseline lesson: sound and honoured', () => {
    for (const a of baselinePath.activities)
      for (const l of levelsFor(a)) {
        const b = bind(a, l.id);
        expect(checkBinding(b), `${a.id}/${l.id}`).toEqual([]);
        expect(honoured(b, resolveLocks(l)), `${a.id}/${l.id}`).toEqual([]);
      }
  });

  test('mode none locks nothing; mode goal only the finish; bridges-only never locks a lift', () => {
    expect(bind(compare, 'explore').locks).toEqual([]);
    expect(bind(compare, 'goal-only').locks.map((l) => l.kind)).toEqual(['goal']);
    const m = bind(compare, 'mission');
    expect(m.locks.some((l) => l.kind === 'elevator')).toBe(false);
    // r2 is `lock: none`, the reach mission `lock: goal`
    expect(m.steps[1]).toMatchObject({ lock: 'none', lockIds: [], goal: false });
    expect(m.steps[4]).toMatchObject({ lock: 'goal', lockIds: [], goal: true });
  });

  test('goal: false leaves the finish open when every locking step got a physical lock', () => {
    const plan: PlanStep[] = [{ index: 0, kind: 'round', roundId: 'r1', lock: 'path' }];
    const open = bindLevel(HANDMADE, plan, { mode: 'path', connectors: ['bridge', 'elevator'], goal: false });
    expect(open.goalLockId).toBeNull();
    expect(open.coverage.physical).toBe(1);
    // …but a step that couldn't get a cut still locks the finish (never silently dropped)
    const many = [0, 1, 2, 3, 4].map(
      (index): PlanStep => ({ index, kind: 'round', roundId: `r${index}`, lock: 'path' }),
    );
    const b = bindLevel(HANDMADE, many, { mode: 'path', connectors: ['bridge'], goal: false });
    expect(b.coverage.fallback).toBeGreaterThan(0);
    expect(b.goalLockId).not.toBeNull();
    expect(checkBinding(b)).toEqual([]);
  });

  test('start and goal on one island: every path step falls back to the finish', () => {
    const one: StageData = { ...HANDMADE, goal: { ...HANDMADE.goal, islandId: 0, pos: [300, 170] } };
    const b = bind(compare, 'gated', one);
    expect(b.chain).toBe(0);
    expect(b.steps.every((s) => !s.spot || s.fallback === 'no-cut')).toBe(true);
    expect(b.locks.every((l) => l.kind === 'goal')).toBe(true);
  });
});

// ── random island graphs (fast-check) ─────────────────────────────────────────────────────────────────────

interface Synthetic {
  stage: StageData;
  spots: GateSpot[];
}

/** A random connected island multigraph (a spanning tree plus extra edges), with a few gate spots per island. */
const synthetic = fc
  .record({
    n: fc.integer({ min: 1, max: 14 }),
    parents: fc.array(fc.nat(), { minLength: 14, maxLength: 14 }),
    extra: fc.array(fc.tuple(fc.nat(), fc.nat(), fc.boolean()), { maxLength: 10 }),
    lifts: fc.array(fc.boolean(), { minLength: 14, maxLength: 14 }),
    rooms: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 14, maxLength: 14 }),
    goal: fc.nat(),
    orphan: fc.boolean(),
  })
  .map(({ n, parents, extra, lifts, rooms, goal, orphan }): Synthetic => {
    const bridges: StageData['bridges'] = [];
    const elevators: StageData['elevators'] = [];
    const link = (a: number, b: number, lift: boolean) => {
      if (lift)
        elevators.push({
          id: elevators.length,
          islandFrom: a,
          islandTo: b,
        } as StageData['elevators'][number]);
      else bridges.push({ id: bridges.length, from: a, to: b } as StageData['bridges'][number]);
    };
    for (let i = 1; i < n; i++) link((parents[i] as number) % i, i, !!lifts[i]);
    for (const [a, b, lift] of extra) link(a % n, b % n, lift);
    // an island nobody can reach is ignored
    const islands = Array.from({ length: n + (orphan ? 1 : 0) }, (_, id) => ({ id }));
    const spots: GateSpot[] = [];
    for (let i = 0; i < n; i++)
      for (let k = 0; k < (rooms[i] as number); k++)
        spots.push({ islandId: i, pos: [i * 1000 + k * 200, 0], progress: (i + k / 4) / n });
    const stage = {
      ...HANDMADE,
      islands,
      bridges,
      elevators,
      start: { pos: [0, 0], islandId: 0 },
      goal: { pos: [0, 0], islandId: goal % n, radius: 12 },
    } as unknown as StageData;
    return { stage, spots };
  });

const stepLock = fc.constantFrom<PlanStep['lock']>('path', 'goal', 'none');
const plan = fc.array(fc.tuple(fc.boolean(), stepLock), { minLength: 1, maxLength: 10 });
const config = fc.record({
  mode: fc.constantFrom<ResolvedLocks['mode']>('none', 'goal', 'path'),
  connectors: fc.constantFrom<ResolvedLocks['connectors']>(['bridge'], ['elevator'], ['bridge', 'elevator']),
  goal: fc.boolean(),
});

/** Steps consistent with the level (what `playIssues` enforces for authored levels). */
function planFor(raw: [boolean, PlanStep['lock']][], c: Pick<ResolvedLocks, 'mode' | 'goal'>): PlanStep[] {
  return raw.map(([mission, lock], index) => {
    const allowed: PlanStep['lock'] =
      c.mode === 'none' ? 'none' : c.mode === 'goal' ? (lock === 'path' ? 'goal' : lock) : lock;
    const fixed = allowed === 'goal' && c.mode === 'path' && !c.goal ? 'path' : allowed;
    return mission
      ? { index, kind: 'mission', mission: { kind: 'collect', count: 2 }, lock: fixed }
      : { index, kind: 'round', roundId: `r${index}`, lock: fixed };
  });
}

describe('binding invariants on random island graphs', () => {
  test('(a)–(d) hold and the configuration is honoured', () => {
    fc.assert(
      fc.property(synthetic, plan, config, ({ stage, spots }, raw, c) => {
        const cfg = {
          ...c,
          connectors: c.mode === 'path' ? c.connectors : [],
          goal: c.mode === 'goal' || (c.mode === 'path' && c.goal),
        };
        const b = bindLevel(stage, planFor(raw, cfg), cfg, spots);
        expect(checkBinding(b)).toEqual([]);
        expect(honoured(b, cfg)).toEqual([]);
        // gates and posts never crowd a stage, and each stands on an island the ball can reach
        for (const s of b.steps) if (s.spot) expect(b.graph.adj.has(s.spot.islandId)).toBe(true);
        expect(b.coverage.physical + b.coverage.fallback).toBeLessThanOrEqual(b.coverage.path);
        // deterministic
        expect(bindLevel(stage, planFor(raw, cfg), cfg, spots)).toEqual(b);
      }),
      { numRuns: 600 },
    );
  });
});

// ── real stages: the batch-eval capture set ───────────────────────────────────────────────────────────────

const FULL = process.env.WWM_LOCK_COVERAGE === '1';
const SAMPLE = ['hn-front', 'eval-debian', 'govuk-card-grid', 'eval-python-home', 'wikipedia-article'];

function* realStages(): Generator<{ key: string; stage: StageData }> {
  const slugs = FULL ? listCaptureSlugs() : SAMPLE.filter((s) => listCaptureSlugs().includes(s));
  const difficulties: Difficulty[] = FULL ? ['easy', 'normal', 'hard'] : ['normal'];
  const seeds = FULL ? [1, 2, 3] : [1];
  for (const slug of slugs) {
    const { capture, image } = loadCapture(slug);
    const slices = FULL ? sliceCount(capture) : 1;
    for (let slice = 0; slice < slices; slice++)
      for (const difficulty of difficulties)
        for (const seed of seeds) {
          try {
            const { stage } = buildStage({ capture, image, sliceIndex: slice, seed, difficulty });
            yield { key: `${slug}#${slice}:${difficulty}:${seed}`, stage };
          } catch {
            // a slice the builder rejects isn't a stage the game plays
          }
        }
  }
}

describe('binding invariants on built stages (batch-eval captures)', () => {
  test(
    FULL ? 'the whole batch-eval set, with the coverage report' : 'a sample of the batch-eval set',
    () => {
      const levels = baselinePath.activities.flatMap((a) => levelsFor(a).map((l) => ({ a, l })));
      const gated = level(compare, 'gated');
      const report = {
        stages: 0,
        withPath: 0,
        gatedSteps: 0,
        gatedPhysical: 0,
        gatedFallback: 0,
        gatedUnplaced: 0,
        allPhysical: 0,
        anyFallback: 0,
        chain: [] as number[],
        failures: [] as string[],
      };
      for (const { key, stage } of realStages()) {
        report.stages++;
        for (const { a, l } of levels) {
          const b = bindLevel(stage, levelPlan(a, l), resolveLocks(l));
          const issues = [...checkBinding(b), ...honoured(b, resolveLocks(l))];
          if (issues.length) report.failures.push(`${key} ${a.id}/${l.id}: ${issues.join('; ')}`);
        }
        const g = bindLevel(stage, levelPlan(compare, gated), resolveLocks(gated));
        if (g.path.length > 0) report.withPath++;
        report.chain.push(g.chain);
        report.gatedSteps += g.coverage.path;
        report.gatedPhysical += g.coverage.physical;
        report.gatedFallback += g.coverage.fallback;
        report.gatedUnplaced += g.coverage.unplaced;
        if (g.coverage.physical === g.coverage.path) report.allPhysical++;
        if (g.coverage.fallback > 0) report.anyFallback++;
      }
      if (FULL) {
        writeFileSync(
          '/tmp/wwm-p22-coverage.json',
          JSON.stringify({ ...report, chain: undefined, chainHistogram: histogram(report.chain) }, null, 2),
        );
        console.log(
          JSON.stringify({ ...report, chain: histogram(report.chain), failures: report.failures.length }),
        );
      }
      expect(report.stages).toBeGreaterThan(0);
      expect(report.failures).toEqual([]);
    },
    FULL ? 3_600_000 : 60_000,
  );
});

function histogram(values: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[String(v)] = (out[String(v)] ?? 0) + 1;
  return out;
}

// ── missions ──────────────────────────────────────────────────────────────────────────────────────────────

describe('missions', () => {
  test('gems per island, lowered counts, letters', () => {
    const counts = gemsByIsland(HANDMADE, new Set([0]), new Set([0, 1]));
    expect([...counts]).toEqual([
      [0, 3],
      [1, 7],
    ]);
    expect(collectCount(4, 10)).toEqual({ count: 4, lowered: false });
    expect(collectCount(4, 2)).toEqual({ count: 2, lowered: true });
    expect([...islandLetters(HANDMADE)]).toEqual([
      [0, 'A'],
      [1, 'B'],
      [2, 'C'],
      [3, 'D'],
    ]);
  });

  test('reach: most / fewest, ties fall back to a letter, letter targets', () => {
    const letters = new Map([
      [1, 'B'],
      [2, 'C'],
      [3, 'D'],
    ]);
    const counts = new Map([
      [1, 5],
      [2, 2],
      [3, 5],
    ]);
    expect(resolveReach('fewest-gems', counts, letters)).toEqual({
      islandId: 2,
      letter: 'C',
      by: 'fewest-gems',
      tie: false,
    });
    expect(resolveReach('most-gems', counts, letters)).toEqual({
      islandId: 1,
      letter: 'B',
      by: 'letter',
      tie: true,
    });
    expect(resolveReach({ letter: 'D' }, counts, letters)?.islandId).toBe(3);
    expect(resolveReach('most-gems', new Map(), letters)).toBeNull();
  });

  test('mission post hrefs', () => {
    const href = missionHref('compare-groups', 2, '#3BC6D2');
    expect(href).toBe('wwm-learning:compare-groups/m2#3bc6d2');
    expect(parseLearningHref(href)).toEqual({ kind: 'post', n: 2 });
    expect(parseLearningHref('wwm-learning:compare-groups/3#aabbcc')).toEqual({ kind: 'gate', n: 3 });
    expect(parseLearningHref('https://example.com/')).toBeNull();
  });
});

// ── levels ────────────────────────────────────────────────────────────────────────────────────────────────

describe('levels', () => {
  test('the game supports every baseline level', () => {
    for (const a of baselinePath.activities) expect(gameLevels(a)).toEqual(levelsFor(a));
    expect([...SUPPORTS]).toContain('mission.reach');
  });

  test('the grown-up’s choice, else the author’s default; a session choice wins; unknown ids fall back', () => {
    expect(pickLevel(baselinePath, compare).id).toBe('gated');
    const family = { ...baselinePath, family: { levels: { 'compare-groups': 'mission' }, tapOnly: false } };
    expect(pickLevel(family, compare).id).toBe('mission');
    expect(pickLevel(family, compare, 'explore').id).toBe('explore');
    expect(pickLevel(family, compare, 'nope').id).toBe('mission');
    const summaries = levelSummaries(compare);
    expect(summaries.map((s) => s.id)).toEqual(['explore', 'goal-only', 'gated', 'mission']);
    expect(summaries.find((s) => s.isDefault)?.id).toBe('gated');
    expect(summaries.find((s) => s.id === 'gated')?.description).toMatch(/Bridges and lifts stay locked/);
  });
});

// ── the session with a fake port ──────────────────────────────────────────────────────────────────────────

const silent = () => ({
  play: async () => {},
  stop: () => {},
  unlock: () => {},
  preload: () => {},
  sourceFor: () => 'silent' as const,
});

function session(
  opts: {
    level?: string;
    lesson?: LoadedLesson;
    seed?: number;
    device?: { keyboard: boolean; tilt: boolean };
  } = {},
) {
  const port = new FakeLockPort();
  let clock = 0;
  const closed: [number, string][] = [];
  const g = new LearningGates({
    muted: () => true,
    onClose: (id, how) => closed.push([id, how]),
    voice: silent,
    locks: port,
    seed: () => opts.seed ?? 0,
    now: () => clock,
    device: () => opts.device ?? { keyboard: true, tilt: false },
  });
  g.use(opts.lesson ?? lessonFromBaseline('compare-groups'));
  if (opts.level) g.setLevel(opts.level);
  const stage = g.decorate(HANDMADE);
  g.stageReady(stage);
  const said = () => g.debug().said;
  const tick = (ms: number) => {
    clock += ms;
  };
  return { g, port, stage, closed, said, tick };
}

/** A copy of the baseline with one more compare-groups level. */
function withLevel(extra: NonNullable<Activity['play']>['levels'][number], family?: LearningPath['family']) {
  const path = structuredClone(baselinePath) as LearningPath;
  const a = path.activities.find((x) => x.id === 'compare-groups') as Activity;
  a.play?.levels.push(extra);
  if (family) path.family = family;
  const parsed = parseLearningPath(path);
  return {
    path: parsed,
    activity: parsed.activities.find((x) => x.id === 'compare-groups') as Activity,
    source: { kind: 'baseline' as const },
  };
}

describe('the session: locks (fake port)', () => {
  test('ranked play is untouched: no lesson, no locks', () => {
    const g = new LearningGates({ muted: () => true, onClose: () => {}, voice: silent });
    expect(g.decorate(HANDMADE)).toBe(HANDMADE);
    expect(g.locksFor(HANDMADE)).toBeUndefined();
    const explore = session({ level: 'explore' });
    expect(explore.g.locksFor(explore.stage)).toBeUndefined();
  });

  test('gated: locks load closed; solving a gate opens its lock with Pip’s line; the finish opens last', () => {
    const { g, port, stage, said } = session();
    expect(g.level?.id).toBe('gated');
    expect(g.locksFor(stage)?.map((l) => l.kind)).toEqual([
      'bridge',
      'bridge',
      'bridge',
      'bridge',
      'elevator',
      'goal',
    ]);
    const show = port.calls.find((c) => c.call === 'show');
    expect(show?.call === 'show' && show.visuals.map((v) => [v.label, v.icon])).toEqual([
      ['Pip gate 1', 'pip'],
      ['Pip gate 1', 'pip'],
      ['Pip gate 1', 'pip'],
      ['Pip gate 2', 'pip'],
      ['Pip gate 3', 'pip'],
      ['Finish', 'pip'],
    ]);
    expect(g.goalLocked()).toBe(true);
    // gate 1 asks r1 (its own step)
    expect(g.open(0, 0)).toBe(true);
    expect(g.getView().gate).toMatchObject({ stepIndex: 0, locking: true, number: 1 });
    g.answer('b');
    for (const id of [0, 1, 2]) {
      expect(port.open.get(id)).toBe(true);
      expect(port.state.get(id)).toBe('opening');
    }
    expect(port.open.get(3)).toBeUndefined();
    expect(said()).toContain(systemLineId.unlockedBridge);
    expect(g.getView().steps.map((s) => s.done)).toEqual([true, false, false, false]);
    g.proceed();
    expect(g.isOpen).toBe(false);
    // gate 3 asks r3 (its own step), not r2
    g.open(2, 0);
    expect(g.getView().gate?.round.id).toBe('r3');
    g.answer('b');
    expect(said()).toContain(systemLineId.unlockedLift);
    expect(g.goalLocked()).toBe(true);
    g.proceed();
    g.open(1, 0);
    g.answer('a');
    g.proceed();
    // gate 4: a fallback step (no chokepoint left), it keeps the finish shut
    g.open(3, 0);
    g.answer('same');
    expect(g.goalLocked()).toBe(false);
    expect(port.open.get(2)).toBe(true);
    expect(said()).toContain(systemLineId.unlockedGoal);
    // the last round offers the bonus in the same card
    expect(g.getView().gate?.next).toBe('more');
    g.proceed();
    expect(g.getView().gate?.mode).toBe('bonus-offer');
  });

  test('a closed lock: banner, Pip’s line (at most every 8 s), the beacon over its gate, a pulse', () => {
    const { g, port, said, tick } = session();
    g.locked(1);
    expect(g.getView().banner).toMatchObject({ kind: 'gate', n: 1 });
    expect(said()).toEqual([systemLineId.lockedGate(1)]);
    expect(g.debug().binding?.steps[0]?.island).toBe(0);
    expect(port.beam).not.toBeNull();
    expect(port.calls.filter((c) => c.call === 'pulse')).toHaveLength(1);
    tick(1000);
    g.locked(3);
    expect(g.getView().banner).toMatchObject({ kind: 'gate', n: 2, seq: 2 });
    expect(said()).toHaveLength(1); // rate-limited
    tick(LOCKED_LINE_MS);
    g.locked(4);
    expect(said().at(-1)).toBe(systemLineId.lockedLift);
    // the finish points at the first step it still waits for
    g.locked(5);
    expect(g.getView().banner).toMatchObject({ kind: 'gate', n: 1 });
    // opening the gate clears the beacon
    g.open(0, 0);
    expect(port.beam).toBeNull();
  });

  test('signals off really remove each signal; override none hides the grown-up override', () => {
    const quiet = withLevel({
      id: 'quiet',
      label: 'Quiet',
      steps: 'rounds',
      locks: {
        mode: 'path',
        connectors: ['bridge'],
        goal: true,
        signals: { banner: false, voice: false, beacon: false },
        override: 'none',
      },
    });
    const { g, port, said } = session({ lesson: quiet, level: 'quiet' });
    g.locked(0);
    expect(g.getView().banner).toBeNull();
    expect(said()).toEqual([]);
    expect(port.beam).toBeNull();
    expect(port.calls.filter((c) => c.call === 'pulse')).toHaveLength(1);
    expect(g.getView().canOverride).toBe(false);
    expect(g.overrideNext()).toBe(false);
  });

  test('the grown-up override opens the next lock', () => {
    const { g, port } = session();
    expect(g.getView().canOverride).toBe(true);
    expect(g.overrideNext()).toBe(true);
    expect(port.open.get(0)).toBe(true);
    expect(g.debug().overridden).toEqual([0]);
    expect(g.overrideNext()).toBe(true); // the lift
    expect(g.overrideNext()).toBe(true); // step 3 (the finish waits for it)
    expect(g.overrideNext()).toBe(true); // step 4
    expect(g.goalLocked()).toBe(false);
    expect(g.getView().canOverride).toBe(false);
  });

  test('region guard: an island beyond a closed lock sends the ball back (and Pip says oops)', () => {
    const { g, said, tick } = session();
    expect(g.island(0)).toBe(false);
    expect(g.island(1)).toBe(true);
    expect(said()).toEqual([systemLineId.oopsGate(1)]);
    expect(g.getView().banner).toMatchObject({ kind: 'gate', n: 1 });
    g.overrideNext();
    expect(g.island(1)).toBe(false);
    tick(GUARD_LINE_MS);
    expect(g.island(2)).toBe(true);
    expect(g.getView().banner).toMatchObject({ kind: 'gate', n: 2 });
    expect(g.debug().guards).toBe(2);
  });

  test('region guard: a hop between neighbouring islands around the lock (the L1 spike’s main bypass)', () => {
    // the practice stage's islands 0 and 2 have no connector between them, but a real site's blocks often sit
    // under a metre apart: a hop from 0 lands on 2, past gate 1's bridges and gate 2's bridge
    const { g, port, said, tick } = session();
    expect(g.debug().binding?.locks.filter((l) => !l.open).length).toBe(6);
    // `island` (first contact) and `landed` (a hop back onto a known island) both run the guard
    expect(g.island(2)).toBe(true);
    // it names the first lock it went around, lights its gate, and Pip says oops only every few seconds
    expect(g.getView().banner).toMatchObject({ kind: 'gate', n: 1 });
    expect(port.beam).not.toBeNull();
    tick(1000);
    expect(g.guard(2)).toBe(true);
    expect(g.guard(3)).toBe(true);
    expect(said().filter((l) => l.startsWith('pip.oops'))).toHaveLength(1);
    // the same banner isn't restarted while it still shows (the physics reports a pressed lock every second)
    expect(g.getView().banner?.seq).toBe(1);
    tick(GUARD_LINE_MS);
    expect(g.guard(2)).toBe(true);
    expect(said().filter((l) => l.startsWith('pip.oops'))).toHaveLength(2);
    expect(g.getView().banner?.seq).toBe(2);
    expect(g.debug().guards).toBe(4);
    // once gate 1 is solved, the island behind its bridges is fine; the one behind gate 2's bridge is not
    g.open(0, 0);
    g.answer('b');
    g.proceed();
    expect(g.guard(1)).toBe(false);
    expect(g.guard(2)).toBe(true);
    // the goal lock never fences an island (the goal island is reached through the lift lock)
    g.overrideNext();
    g.overrideNext();
    expect(g.guard(3)).toBe(false);
  });

  test('done steps stay open on the next attempt (their gates used)', () => {
    const { g, port, stage } = session();
    g.open(0, 0);
    g.answer('b');
    g.proceed();
    port.calls.length = 0;
    expect(g.stageReady(stage)).toEqual([0]);
    expect(port.calls).toContainEqual({ call: 'setLockState', id: 0, state: 'open' });
  });
});

describe('the session: missions (fake port)', () => {
  test('collect: counts pickups aloud after the post, opens its lock at N; lowered when the stage has fewer', () => {
    const lesson = withLevel({
      id: 'collect',
      label: 'Collect',
      steps: [{ mission: 'collect', count: 3 }, { round: 'r1' }],
      locks: { mode: 'path', connectors: ['bridge'], goal: true },
    });
    const { g, port, stage, said } = session({ lesson, level: 'collect' });
    const post = (stage.portals ?? []).find((p) => parseLearningHref(p.href)?.kind === 'post');
    expect(post?.label).toBe('Mission: 3 gems');
    expect(g.isPost(post?.id ?? -1)).toBe(true);
    const b = g.debug().binding;
    expect(b?.steps[0]).toMatchObject({ kind: 'mission', lock: 'path' });
    const lockId = b?.steps[0]?.lockIds[0] as number;
    // pickups before the post don't count
    g.item(0);
    expect(said()).toEqual([]);
    g.post(post?.id ?? -1);
    expect(said()).toEqual([systemLineId.missionPost, systemLineId.collect(3)]);
    expect(g.getView().mission).toMatchObject({ kind: 'collect', count: 3, have: 0 });
    g.locked(lockId);
    expect(g.getView().banner).toMatchObject({ kind: 'collect', count: 3, have: 0 });
    expect(said().at(-1)).toBe(systemLineId.lockedCollect(3));
    g.item(1);
    g.item(2);
    expect(said().slice(-1)).toEqual([systemLineId.number(2)]);
    expect(port.open.get(lockId)).toBeUndefined();
    g.item(3);
    expect(port.open.get(lockId)).toBe(true);
    expect(said().slice(-3)).toEqual([
      systemLineId.number(3),
      systemLineId.collectDone,
      systemLineId.unlockedBridge,
    ]);
    expect(g.getView().mission).toBeNull();

    // the same level on a stage with only two gems left where the ball can go: Pip asks for two
    const few = session({ lesson, level: 'collect' });
    for (const item of HANDMADE.items.filter((i) => i.islandId <= 1).slice(2)) few.g.item(item.id);
    const post2 = (few.stage.portals ?? []).find((p) => parseLearningHref(p.href)?.kind === 'post');
    few.g.post(post2?.id ?? -1);
    expect(few.g.getView().mission).toMatchObject({ count: 2 });
    expect(few.g.debug().notes.some((n) => n.startsWith('collect lowered'))).toBe(true);
    expect(few.said()).toContain(systemLineId.collect(2));
  });

  test('reach most-gems: resolved when the mission starts, done on arrival', () => {
    const { g, stage, said } = session({ level: 'mission' });
    const reach = g.debug().binding?.steps.find((s) => s.kind === 'mission' && s.index === 4);
    const post = reach?.portalId as number;
    expect(g.isPost(post)).toBe(true);
    expect(stage.portals?.find((p) => p.id === post)?.label).toBe('Mission: most gems');
    // open the way (the reach post stands behind r1's and the collect mission's locks)
    g.overrideNext();
    g.overrideNext();
    g.post(post);
    const m = g.getView().mission;
    expect(m?.kind).toBe('reach');
    const target = g.debug().missions.find((x) => x.index === 4)?.goal?.islandId as number;
    expect(target).toBeGreaterThanOrEqual(0);
    expect(said()).toContain(
      m?.by === 'letter' ? systemLineId.reachLetter(m.letter ?? 'A') : systemLineId.reachMost,
    );
    g.island(target);
    expect(said()).toContain(systemLineId.reachDone);
    expect(g.debug().done).toContain(4);
  });
});

describe('the session: input policy, shuffling and the card flow', () => {
  const key = (code: string, k: string) =>
    ({ code, key: k, repeat: false, preventDefault() {}, target: null }) as unknown as KeyboardEvent;

  test('a letter-key round shows badges, voices the invite, nudges a tap twice, then accepts', () => {
    const { g, said } = session({ level: 'explore' });
    g.open(0, 0);
    g.answer('b');
    g.proceed();
    g.open(1, 0); // r2 invites letter keys
    const gate = g.getView().gate;
    expect(gate?.round.id).toBe('r2');
    expect(gate?.policy).toMatchObject({ badges: true, promptLine: 'pip.input.letter-key' });
    const at = said().indexOf('compare-groups.r2.callout');
    expect(said()[at + 1]).toBe('pip.input.letter-key');
    g.tap('a');
    expect(g.getView().gate).toMatchObject({ nudges: 1, nudgeSeq: 1 });
    expect(said().at(-1)).toBe('pip.nudge.letter-key');
    g.tap('a');
    expect(g.getView().gate?.state.solved).toBe(false);
    g.tap('a'); // third time: accepted
    expect(g.getView().gate?.state.solved).toBe(true);
  });

  test('letter keys answer directly; tap-only turns the variety off', () => {
    const { g } = session({ level: 'explore' });
    g.open(0, 0);
    g.answer('b');
    g.proceed();
    g.open(1, 0);
    expect(g.key(key('KeyA', 'a'))).toBe(true);
    expect(g.getView().gate?.state.solved).toBe(true);

    const tapOnly = withLevel(
      { id: 'x', label: 'X', steps: 'rounds', locks: { mode: 'none' } },
      { levels: {}, tapOnly: true },
    );
    const t = session({ lesson: tapOnly, level: 'explore' });
    t.g.open(0, 0);
    t.g.answer('b');
    t.g.proceed();
    t.g.open(1, 0);
    expect(t.g.getView().gate?.policy.badges).toBe(false);
    t.g.tap('a');
    expect(t.g.getView().gate?.state.solved).toBe(true);
  });

  test('a touch-only device: a letter round falls back to tap; with a paired phone it invites tilt', () => {
    const { g } = session({ level: 'explore', device: { keyboard: false, tilt: false } });
    g.open(0, 0);
    g.tap('b');
    g.proceed();
    g.open(1, 0);
    expect(g.getView().gate?.policy).toMatchObject({ badges: false, invited: ['tap'] });
    g.tap('a');
    expect(g.getView().gate?.state.solved).toBe(true);

    const phone = session({ level: 'explore', device: { keyboard: false, tilt: true } });
    phone.g.open(0, 0);
    phone.g.answer('b');
    phone.g.proceed();
    phone.g.open(1, 0);
    // tilting is how phone play answers anyway, so Pip doesn't announce it
    expect(phone.g.getView().gate?.policy).toMatchObject({
      badges: false,
      invited: ['tilt'],
      promptLine: null,
    });
  });

  test('shuffled positions: the same seed shows the same round; the answer follows', () => {
    const shown = (seed: number) => {
      const { g } = session({ level: 'explore', seed });
      g.open(0, 0);
      return g.getView().gate?.round;
    };
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const answers = seeds.map((s) => shown(s)?.kind === 'compare' && (shown(s) as { answer: string }).answer);
    expect(new Set(answers).size).toBe(2); // island A on some play-throughs, island B on others
    expect(shown(5)).toEqual(shown(5));
    for (const s of seeds) {
      const { g } = session({ level: 'explore', seed: s });
      g.open(0, 0);
      const r = g.getView().gate?.round as { answer: string };
      g.answer(r.answer);
      expect(g.getView().gate?.state.solved).toBe(true);
    }
  });

  test('a helped trick round continues with its follow-up in the same card', () => {
    const { g } = session({ level: 'explore' });
    for (const [gate, answer] of [
      [0, 'b'],
      [1, 'a'],
    ] as const) {
      g.open(gate, 0);
      g.answer(answer);
      g.proceed();
    }
    g.open(2, 0);
    expect(g.getView().gate?.round.id).toBe('r3');
    g.hint();
    g.hint();
    g.answer('b');
    expect(g.getView().gate?.next).toBe('follow-up');
    g.proceed();
    expect(g.getView().gate?.round.id).toBe('r3b');
    g.answer('a');
    expect(g.getView().gate?.next).toBe('roll-on');
  });

  test('a locking step offers “Later” (the gate stays open), an optional stop “Skip”', () => {
    const { g, closed } = session();
    g.open(0, 0);
    g.skip();
    expect(closed).toEqual([[0, 'later']]);
    const e = session({ level: 'explore' });
    e.g.open(0, 0);
    e.g.skip();
    expect(e.closed).toEqual([[0, 'skipped']]);
  });

  test('the lock line names the right thing', () => {
    const owner = { number: 3, step: { index: 0, kind: 'round', roundId: 'r1', lock: 'path' } } as const;
    expect(lockedLine({ kind: 'bridge' }, owner, 0)).toBe(systemLineId.lockedGate(3));
    expect(lockedLine({ kind: 'elevator' }, owner, 0)).toBe(systemLineId.lockedLift);
    expect(lockedLine({ kind: 'goal' }, owner, 0)).toBe(systemLineId.lockedGoal);
  });
});

describe('the lock port', () => {
  test('forwards to the current driver and engine; does nothing before they exist', () => {
    const none = createLockPort(
      () => null,
      () => null,
    );
    expect(none.physics).toBe(false);
    expect(none.engine).toBe(false);
    none.setLock(0, true);
    none.show([]);
    none.beacon([1, 2]);
    const calls: string[] = [];
    const driver = { setLock: (id: number, open: boolean) => calls.push(`lock ${id} ${open}`) };
    const engine = {
      setLocks: () => calls.push('setLocks'),
      setLockState: (id: number, s: string) => calls.push(`state ${id} ${s}`),
      pulseLock: (id: number) => calls.push(`pulse ${id}`),
      setBeacon: (p: unknown) => calls.push(`beacon ${JSON.stringify(p)}`),
    };
    const port = createLockPort(
      () => driver as unknown as SimDriver,
      () => engine as unknown as Engine,
    );
    expect(port.physics && port.engine).toBe(true);
    port.show([]);
    port.setLock(2, true);
    port.setLockState(2, 'opening');
    port.pulse(2);
    port.beacon([1, 2]);
    port.beacon(null);
    expect(calls).toEqual([
      'setLocks',
      'lock 2 true',
      'state 2 opening',
      'pulse 2',
      'beacon [1,2]',
      'beacon null',
    ]);
  });
});
