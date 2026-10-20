/**
 * Learning evidence and progress (Phase 31, CCR-31-2). One event per solved round, the same from the lesson page
 * and the maze. Events carry no free text, audio, names or device details, and never go to an analytics provider.
 * Progress is a plain-language state per objective, never a score: one play-through is practice, not mastery.
 */
import { z } from 'zod';
import type { RoundOrigin } from './banks.ts';
import { type Activity, INPUT_MODES, type InputMode } from './schema.ts';
import type { LessonState } from './session.ts';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const evidenceSchema = z
  .object({
    v: z.literal(1),
    /** UUIDv7 made on the device; the deduplication key. */
    id: uuid,
    /** Opaque child-profile id, never a name. */
    profile: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    /** Minute precision. */
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/),
    activity: id,
    objective: id,
    round: id,
    /** `roundHash` of the round as written. */
    item: z.string().regex(/^[a-f0-9]{32}$/),
    source: z.enum(['lesson', 'bank', 'generator']),
    /** The child hadn't met this item before. */
    fresh: z.boolean(),
    outcome: z.enum(['first-try', 'after-retry']),
    /** Highest hint step used: 0 none, 1 nudge, 2 strategy, 3 worked example. */
    helpLevel: z.number().int().min(0).max(3),
    surface: z.enum(['lesson', 'maze']),
    input: z.enum(INPUT_MODES),
    duration: z.enum(['lt10s', 'lt30s', 'lt2m', 'ge2m']),
  })
  .strict();
export type LearningEvidence = z.infer<typeof evidenceSchema>;

/** A UUIDv7: millisecond time first, so ids sort by when they were made. */
export function evidenceId(now = Date.now(), random = crypto.getRandomValues(new Uint8Array(10))): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff;
  bytes.set(random, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function durationBucket(ms: number): LearningEvidence['duration'] {
  return ms < 10_000 ? 'lt10s' : ms < 30_000 ? 'lt30s' : ms < 120_000 ? 'lt2m' : 'ge2m';
}

/** The event for the round just solved in `state` (call it when `state.solved` turns true). */
export function roundEvidence(input: {
  profile: string;
  activity: Activity;
  state: LessonState;
  origin: RoundOrigin;
  surface: 'lesson' | 'maze';
  input: InputMode;
  durationMs: number;
  now?: number;
}): LearningEvidence {
  const { activity, state, origin } = input;
  const round = activity.rounds[state.index];
  if (!round || !state.solved) throw new Error('Evidence is recorded for a solved round.');
  const now = input.now ?? Date.now();
  return evidenceSchema.parse({
    v: 1,
    id: evidenceId(now),
    profile: input.profile,
    at: new Date(Math.floor(now / 60_000) * 60_000).toISOString(),
    activity: activity.id,
    objective: origin.objective,
    round: round.id,
    item: origin.item,
    source: origin.source,
    fresh: origin.fresh,
    outcome: state.misses === 0 ? 'first-try' : 'after-retry',
    helpLevel: Math.min(3, state.hintLevel),
    surface: input.surface,
    input: input.input,
    duration: durationBucket(input.durationMs),
  });
}

// ── progress ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Proposed thresholds, pending educator review (plan §3). "Got it on new examples": first try, with at most a
 * nudge, on this many different fresh items, on this many different days.
 */
export const PROGRESS_RULES = { freshItems: 2, days: 2, maxHelpLevel: 1 } as const;

export type ProgressState = 'not-started' | 'practising' | 'with-help' | 'got-it';
export interface ObjectiveProgress {
  objective: string;
  state: ProgressState;
  /** Rounds solved. */
  rounds: number;
  /** Solved first try with at most a nudge. */
  solo: number;
  /** Solved after a retry or with the strategy or worked example. */
  helped: number;
  lastAt?: string;
}

const solo = (event: LearningEvidence) =>
  event.outcome === 'first-try' && event.helpLevel <= PROGRESS_RULES.maxHelpLevel;

/**
 * Each objective's state from one child's events. Days are counted in `timeZone` (the family's), so two evening
 * sessions aren't split or merged by UTC midnight.
 */
export function objectiveProgress(
  events: readonly LearningEvidence[],
  objectives: readonly string[],
  options: { timeZone?: string } = {},
): ObjectiveProgress[] {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: options.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return objectives.map((objective) => {
    const mine = events
      .filter((event) => event.objective === objective)
      .sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id));
    const last = mine.at(-1);
    if (!last) return { objective, state: 'not-started', rounds: 0, solo: 0, helped: 0 };
    const qualifying = mine.filter((event) => event.fresh && solo(event));
    const gotIt =
      new Set(qualifying.map((event) => event.item)).size >= PROGRESS_RULES.freshItems &&
      new Set(qualifying.map((event) => day.format(new Date(event.at)))).size >= PROGRESS_RULES.days;
    const soloCount = mine.filter(solo).length;
    return {
      objective,
      state: gotIt ? 'got-it' : solo(last) ? 'practising' : 'with-help',
      rounds: mine.length,
      solo: soloCount,
      helped: mine.length - soloCount,
      lastAt: last.at,
    };
  });
}
