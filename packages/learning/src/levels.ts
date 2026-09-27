/**
 * Game levels (Phase 22): each level is the lesson author's recipe of ordered steps (rounds, missions) plus a lock
 * configuration. A grown-up picks a level; a game binds the steps to its world and enforces exactly that
 * configuration. Nothing here knows about any particular maze.
 */
import {
  type Activity,
  effectiveLock,
  type LearningPath,
  type Level,
  type LockConfig,
  type ReachTarget,
  type StepLock,
} from './schema.ts';

/** When an activity declares no levels: optional stops, and a gated default that locks bridges and lifts. */
export const DEFAULT_LEVELS: Level[] = [
  { id: 'explore', label: 'Explore', steps: 'rounds', locks: { mode: 'none' } },
  {
    id: 'gated',
    label: 'Gated',
    steps: 'rounds',
    locks: { mode: 'path', connectors: ['bridge', 'elevator'], goal: true, override: 'grown-up' },
  },
];
const DEFAULT_LEVEL = 'gated';

export function levelsFor(activity: Activity): Level[] {
  return activity.play?.levels ?? DEFAULT_LEVELS;
}

export function defaultLevelId(activity: Activity): string {
  return activity.play?.defaultLevel ?? DEFAULT_LEVEL;
}

/** The level to play: the grown-up's choice when it exists, else the author's default. */
export function resolveLevel(path: Pick<LearningPath, 'family'>, activity: Activity): Level {
  const levels = levelsFor(activity);
  const chosen = path.family?.levels[activity.id];
  return (
    levels.find((level) => level.id === chosen) ??
    levels.find((level) => level.id === defaultLevelId(activity)) ??
    (levels[0] as Level)
  );
}

export type Mission = { kind: 'collect'; count: number } | { kind: 'reach'; island: ReachTarget };
export type PlanStep =
  | { index: number; kind: 'round'; roundId: string; lock: StepLock }
  | { index: number; kind: 'mission'; mission: Mission; lock: StepLock };

/** A level's steps in order, with each step's effective lock. */
export function levelPlan(activity: Activity, level: Level): PlanStep[] {
  const required = activity.rounds.filter((round) => !round.optional && !round.onlyAfterHelpOn);
  const steps = level.steps === 'rounds' ? required.map((round) => ({ round: round.id })) : level.steps;
  return steps.map((step, index) => {
    const lock = effectiveLock(level, step);
    if ('round' in step) return { index, kind: 'round', roundId: step.round, lock };
    return {
      index,
      kind: 'mission',
      mission:
        step.mission === 'collect'
          ? { kind: 'collect', count: step.count }
          : { kind: 'reach', island: step.island },
      lock,
    };
  });
}

export interface ResolvedLocks {
  mode: LockConfig['mode'];
  connectors: ('bridge' | 'elevator')[];
  goal: boolean;
  signals: { banner: boolean; voice: boolean; beacon: boolean; mapPadlocks: boolean };
  override: 'grown-up' | 'none';
}

/** The lock configuration with every default filled in. */
export function resolveLocks(level: Level): ResolvedLocks {
  const locks = level.locks;
  return {
    mode: locks.mode,
    connectors: locks.mode === 'path' ? [...(locks.connectors ?? [])] : [],
    goal: locks.mode === 'goal' ? true : locks.mode === 'path' ? locks.goal !== false : false,
    signals: {
      banner: locks.signals?.banner !== false,
      voice: locks.signals?.voice !== false,
      beacon: locks.signals?.beacon !== false,
      mapPadlocks: locks.signals?.mapPadlocks !== false,
    },
    override: locks.override ?? 'grown-up',
  };
}

/** Capability names a game must support to offer this level. */
export function levelRequires(activity: Activity, level: Level): string[] {
  const locks = resolveLocks(level);
  const needs = new Set<string>();
  if (locks.goal) needs.add('locks.goal');
  for (const connector of locks.connectors) needs.add(`locks.path.${connector}`);
  // a level that hides padlocks on the map needs a game that can actually hide them (fail closed)
  if (locks.mode !== 'none' && !locks.signals.mapPadlocks) needs.add('signals.hide-map-padlocks');
  for (const step of levelPlan(activity, level))
    if (step.kind === 'mission') needs.add(`mission.${step.mission.kind}`);
  return [...needs].sort();
}

/** Levels a game can honour completely (fail closed: never half-honour a configuration). */
export function playableLevels(activity: Activity, supports: readonly string[]): Level[] {
  return levelsFor(activity).filter((level) =>
    levelRequires(activity, level).every((need) => supports.includes(need)),
  );
}

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

function missionWords(mission: Mission): string {
  if (mission.kind === 'collect') return `collect ${mission.count} ${mission.count === 1 ? 'gem' : 'gems'}`;
  if (mission.island === 'most-gems') return 'find the island with the most gems';
  if (mission.island === 'fewest-gems') return 'find the island with the fewest gems';
  return `roll to island ${mission.island.letter}`;
}

/** A plain-words description of a level for grown-ups, generated from its configuration. */
export function describeLevel(activity: Activity, level: Level): string {
  const locks = resolveLocks(level);
  const plan = levelPlan(activity, level);
  const missions = plan.flatMap((step) => (step.kind === 'mission' ? [missionWords(step.mission)] : []));
  const sentences: string[] = [];
  if (locks.mode === 'none') sentences.push('Pip’s gates are optional stops. Nothing is locked.');
  else if (locks.mode === 'goal')
    sentences.push('Nothing on the way is locked, but the finish waits until Pip’s steps are done.');
  else {
    const what =
      locks.connectors.length === 2
        ? 'Bridges and lifts'
        : locks.connectors[0] === 'bridge'
          ? 'Bridges'
          : 'Lifts';
    const until = missions.length
      ? 'Pip’s question is answered or mission is done'
      : 'Pip’s question is answered';
    sentences.push(`${what} stay locked until ${until}.`);
    if (locks.goal) sentences.push('The finish waits too.');
  }
  if (missions.length) sentences.push(`Missions: ${list(missions)}.`);
  const open = plan.filter((step) => step.lock === 'none').length;
  if (locks.mode !== 'none' && open)
    sentences.push(`${open} ${open === 1 ? 'step is an optional stop' : 'steps are optional stops'}.`);
  if (locks.mode !== 'none') {
    const hidden: string[] = [];
    if (!locks.signals.beacon) hidden.push('no light points to the gate');
    if (!locks.signals.banner && !locks.signals.voice) hidden.push('locks don’t explain themselves');
    if (hidden.length) sentences.push(`Harder: ${list(hidden)}.`);
    sentences.push(
      locks.override === 'grown-up' ? 'A grown-up can open a lock.' : 'Locks can’t be opened early.',
    );
  }
  return sentences.join(' ');
}

export interface FamilySettings {
  levels: Record<string, string>;
  tapOnly: boolean;
}

/** Apply a grown-up's choices to a path; unknown activities or levels are rejected (fail closed). */
export function applyFamilySettings(path: LearningPath, settings: FamilySettings): LearningPath {
  for (const [activityId, levelId] of Object.entries(settings.levels)) {
    const activity = path.activities.find((candidate) => candidate.id === activityId);
    if (!activity) throw new Error(`Unknown activity "${activityId}".`);
    if (!levelsFor(activity).some((level) => level.id === levelId))
      throw new Error(`"${activity.title}" has no level "${levelId}".`);
  }
  return { ...path, family: { levels: { ...settings.levels }, tapOnly: settings.tapOnly } };
}
