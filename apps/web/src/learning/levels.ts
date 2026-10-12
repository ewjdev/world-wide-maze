/**
 * Phase 22 M3 (N): which level of a lesson the game plays. The game declares what it can honour (`SUPPORTS`,
 * plan Principle 2); a level that needs anything else is never offered (fail closed). The grown-up's choice in the
 * document (`family.levels`) wins, else the author's default; a session override comes from the loader strip's
 * Grown-ups control.
 */
import {
  type Activity,
  DEFAULT_LEVELS,
  describeLevel,
  type LearningPath,
  type Level,
  playableLevels,
  resolveLevel,
} from '@wwm/learning';

/** Everything the WWM adapter honours (plan §3 "Capability check"). */
export const SUPPORTS = [
  'locks.goal',
  'locks.path.bridge',
  'locks.path.elevator',
  'mission.collect',
  'mission.reach',
] as const;

export function gameLevels(activity: Activity): Level[] {
  return playableLevels(activity, SUPPORTS);
}

/**
 * The level to play: `override` (a session choice) if playable, else the grown-up's / author's level if playable,
 * else the first playable one, else `explore` (nothing locks: always honourable).
 */
export function pickLevel(
  path: Pick<LearningPath, 'family'>,
  activity: Activity,
  override?: string | null,
): Level {
  const levels = gameLevels(activity);
  if (activity.demonstration && levels.length === 0)
    throw new Error('No supported level for this guided lesson.');
  const chosen = override ? levels.find((level) => level.id === override) : undefined;
  if (chosen) return chosen;
  const resolved = resolveLevel(path, activity);
  return levels.find((level) => level.id === resolved.id) ?? levels[0] ?? (DEFAULT_LEVELS[0] as Level);
}

export interface LevelSummary {
  id: string;
  label: string;
  description: string;
  /** The author's default. */
  isDefault: boolean;
}

export function levelSummaries(activity: Activity): LevelSummary[] {
  const def = activity.play?.defaultLevel ?? 'gated';
  return gameLevels(activity).map((level) => ({
    id: level.id,
    label: level.label,
    description: describeLevel(activity, level),
    isDefault: level.id === def,
  }));
}
