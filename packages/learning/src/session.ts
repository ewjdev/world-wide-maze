/**
 * One play-through of an activity as a pure state machine, shared by the lesson page and the game so a round
 * behaves the same everywhere: wrong answers climb the hint ladder, a correct answer locks the round, help on
 * a trick round unlocks its follow-up, and bonus rounds are offered, never required.
 */

import { presentRound } from './present.ts';
import { type Activity, checkRound, type Round } from './schema.ts';
import { lineId, roundScript, type ScriptLine } from './script.ts';

export type Phase = 'intro' | 'round' | 'bonus-offer' | 'done';
/** What the page should show alongside the voice. */
export type Show = 'pulse' | 'match' | 'worked' | 'celebrate' | 'retry' | null;

export interface MotionEffect {
  token: string;
  purpose: 'intro' | 'explain' | 'hint' | 'worked' | 'replay';
}
export interface LessonState {
  effect?: MotionEffect;
  effectSequence?: number;
  runId?: number;
  demoSeen?: boolean;
  activityId: string;
  phase: Phase;
  /** Index into `activity.rounds` of the current (or just finished) round. */
  index: number;
  hintLevel: number;
  misses: number;
  /** Rounds where the child reached the strategy level (hint ≥ 2 or the match tool). */
  helped: string[];
  choice: string | null;
  result: 'correct' | 'try-again' | null;
  solved: boolean;
  /** Required rounds solved so far: the bridge's built planks (follow-ups and bonus rounds don't add one). */
  built: number;
  /** Answer positions are shuffled per play-through from this seed (0 = as written). */
  seed: number;
  shuffle: 'positions' | 'none';
  /** Rounds solved in this play-through, in order. */
  played: string[];
}

export type LessonEvent =
  | { type: 'start' }
  | { type: 'effect-complete'; token: string }
  | { type: 'replay-effect' }
  | { type: 'answer'; choice: string }
  | { type: 'hint' }
  | { type: 'match' }
  | { type: 'next' }
  | { type: 'bonus'; accept: boolean }
  /** Games (Phase 22): start a specific round, e.g. the round a level's step puts behind a gate. */
  | { type: 'play'; roundId: string };

export interface Step {
  state: LessonState;
  /** Script line ids to play, in order (replacing whatever is playing). */
  say: string[];
  show: Show;
}

export function initialState(
  activity: Activity,
  options: { seed?: number; shuffle?: 'positions' | 'none' } = {},
): LessonState {
  return {
    ...(activity.demonstration ? { runId: randomSeed(), effectSequence: 0, demoSeen: false } : {}),
    seed: options.seed ?? 0,
    shuffle: options.shuffle ?? 'positions',
    played: [],
    activityId: activity.id,
    phase: 'intro',
    index: 0,
    hintLevel: 0,
    misses: 0,
    helped: [],
    choice: null,
    result: null,
    solved: false,
    built: 0,
  };
}

/** The current round as shown in this play-through (positions shuffled from the session seed). */
export function currentRound(activity: Activity, state: LessonState): Round {
  return presentRound(activity.rounds[state.index] as Round, state.seed, state.shuffle);
}

/** A fresh random seed for a play-through (never 0, which means "as written"). */
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 0xfffffffe);
}

const opening = (activity: Activity, round: Round) => [
  lineId.prompt(activity.id, round.id),
  lineId.callout(activity.id, round.id),
];

/**
 * The follow-up round a game should play right after `roundId` is solved, if its trigger fired (e.g. r3b after
 * r3 needed the strategy), else null.
 */
export function followUpAfter(activity: Activity, state: LessonState, roundId: string): string | null {
  const at = activity.rounds.findIndex((round) => round.id === roundId);
  const next = activity.rounds[at + 1];
  if (!next?.onlyAfterHelpOn || next.onlyAfterHelpOn !== roundId) return null;
  return state.helped.includes(roundId) && !state.played.includes(next.id) ? next.id : null;
}

const isRequired = (round: Round) => !round.optional && !round.onlyAfterHelpOn;

/** Rounds on the main path, the bridge's planks (bonus and conditional follow-ups excluded). */
export function requiredRounds(activity: Activity): number {
  return activity.rounds.filter(isRequired).length;
}

const hasIslands = (round: Round) => round.kind === 'compare' || round.kind === 'difference';

function freshRound(state: LessonState, index: number, phase: Phase = 'round'): LessonState {
  return {
    ...state,
    effect: undefined,
    phase,
    index,
    hintLevel: 0,
    misses: 0,
    choice: null,
    result: null,
    solved: false,
  };
}

/** Lines for climbing to `level` of the ladder; the worked example counts both islands first. */
function hintLines(activity: Activity, round: Round, level: number): { say: string[]; show: Show } {
  const top = round.hints.length;
  const at = Math.min(level, top);
  const say = [lineId.hint(activity.id, round.id, at)];
  if (at === top && top >= 3 && hasIslands(round))
    return {
      say: [lineId.count(activity.id, round.id, 'a'), lineId.count(activity.id, round.id, 'b'), ...say],
      show: 'worked',
    };
  if (at === top && top >= 2) return { say, show: 'worked' };
  if (at === 2 && hasIslands(round))
    return { say: [...say, lineId.match(activity.id, round.id)], show: 'match' };
  return { say, show: 'pulse' };
}

function markHelped(state: LessonState, round: Round, level: number): string[] {
  return level >= 2 && !state.helped.includes(round.id) ? [...state.helped, round.id] : state.helped;
}

/** The next round to play after `from`, skipping follow-ups whose trigger round went smoothly. */
function nextIndex(activity: Activity, state: LessonState, from: number): number {
  for (let i = from + 1; i < activity.rounds.length; i++) {
    const round = activity.rounds[i] as Round;
    if (round.onlyAfterHelpOn && !state.helped.includes(round.onlyAfterHelpOn)) continue;
    return i;
  }
  return -1;
}

function withEffect(state: LessonState, purpose: MotionEffect['purpose']): LessonState {
  const sequence = (state.effectSequence ?? 0) + 1;
  return { ...state, effectSequence: sequence, effect: { token: `${state.runId}.${sequence}`, purpose } };
}

export function step(activity: Activity, state: LessonState, event: LessonEvent): Step {
  const round = currentRound(activity, state);
  const none: Step = { state, say: [], show: null };
  if (state.effect) {
    if (event.type === 'replay-effect')
      return {
        state: withEffect(state, state.effect.purpose),
        say:
          state.effect.purpose === 'intro'
            ? [lineId.intro(activity.id), lineId.demonstration(activity.id)]
            : state.effect.purpose === 'explain' || state.effect.purpose === 'replay'
              ? [lineId.success(activity.id, round.id)]
              : [lineId.hint(activity.id, round.id, state.hintLevel)],
        show: null,
      };
    if (event.type !== 'effect-complete' || event.token !== state.effect.token) return none;
    const cleared = { ...state, effect: undefined };
    if (state.effect.purpose === 'intro')
      return { state: { ...cleared, demoSeen: true }, say: opening(activity, round), show: null };
    if (state.effect.purpose === 'explain') {
      const fresh = !state.played.includes(round.id);
      return {
        state: {
          ...cleared,
          solved: true,
          built: state.built + (fresh && isRequired(round) ? 1 : 0),
          played: fresh ? [...state.played, round.id] : state.played,
        },
        say: [],
        show: 'celebrate',
      };
    }
    return { state: cleared, say: [], show: state.effect.purpose === 'worked' ? 'worked' : null };
  }
  switch (event.type) {
    case 'effect-complete':
      return none;
    case 'replay-effect':
      return round.kind === 'predict-motion' && state.solved
        ? { state: withEffect(state, 'replay'), say: [lineId.success(activity.id, round.id)], show: null }
        : none;
    case 'start': {
      if (state.phase !== 'intro') return none;
      if (activity.demonstration)
        return {
          state: withEffect(freshRound(state, 0), 'intro'),
          say: [lineId.intro(activity.id), lineId.demonstration(activity.id)],
          show: null,
        };
      return {
        state: freshRound(state, 0),
        say: [lineId.intro(activity.id), ...opening(activity, activity.rounds[0] as Round)],
        show: null,
      };
    }
    case 'answer': {
      // A solved round is locked: a stray tap can't undo a success.
      if (state.phase !== 'round' || state.solved) return none;
      if (checkRound(round, event.choice) === 'correct' && round.kind === 'predict-motion')
        return {
          state: withEffect({ ...state, choice: event.choice, result: 'correct' }, 'explain'),
          say: [lineId.success(activity.id, round.id)],
          show: null,
        };
      if (checkRound(round, event.choice) === 'correct')
        return {
          state: {
            ...state,
            choice: event.choice,
            result: 'correct',
            solved: true,
            built: state.built + (isRequired(round) ? 1 : 0),
            played: [...state.played, round.id],
          },
          say: [lineId.success(activity.id, round.id)],
          show: 'celebrate',
        };
      const level = Math.min(round.hints.length, state.hintLevel + 1);
      const hint = hintLines(activity, round, level);
      return {
        state:
          round.kind === 'predict-motion' && level >= 2
            ? withEffect(
                {
                  ...state,
                  choice: event.choice,
                  result: 'try-again',
                  misses: state.misses + 1,
                  hintLevel: level,
                  helped: markHelped(state, round, level),
                },
                level === 3 ? 'worked' : 'hint',
              )
            : {
                ...state,
                choice: event.choice,
                result: 'try-again',
                misses: state.misses + 1,
                hintLevel: level,
                helped: markHelped(state, round, level),
              },
        say: hint.say,
        show: hint.show === 'pulse' ? 'retry' : hint.show,
      };
    }
    case 'hint': {
      if (state.phase !== 'round' || state.solved) return none;
      const level = Math.min(round.hints.length, state.hintLevel + 1);
      const hint = hintLines(activity, round, level);
      return {
        state:
          round.kind === 'predict-motion' && level >= 2
            ? withEffect(
                { ...state, hintLevel: level, helped: markHelped(state, round, level) },
                level === 3 ? 'worked' : 'hint',
              )
            : { ...state, hintLevel: level, helped: markHelped(state, round, level) },
        say: hint.say,
        show: hint.show,
      };
    }
    case 'match': {
      if (state.phase !== 'round' || !hasIslands(round)) return none;
      const level = Math.max(state.hintLevel, Math.min(2, round.hints.length));
      return {
        state: {
          ...state,
          hintLevel: level,
          helped: state.solved ? state.helped : markHelped(state, round, 2),
        },
        say: [lineId.match(activity.id, round.id)],
        show: 'match',
      };
    }
    case 'next': {
      if (state.phase !== 'round' || !state.solved) return none;
      const next = nextIndex(activity, state, state.index);
      if (next < 0)
        return { state: { ...state, phase: 'done' }, say: [lineId.finale(activity.id)], show: 'celebrate' };
      const upcoming = activity.rounds[next] as Round;
      if (upcoming.optional && !round.optional)
        return { state: { ...freshRound(state, next, 'bonus-offer') }, say: [lineId.bonus], show: null };
      return { state: freshRound(state, next), say: opening(activity, upcoming), show: null };
    }
    case 'bonus': {
      if (state.phase !== 'bonus-offer') return none;
      if (!event.accept)
        return { state: { ...state, phase: 'done' }, say: [lineId.finale(activity.id)], show: 'celebrate' };
      return { state: { ...state, phase: 'round' }, say: opening(activity, round), show: null };
    }
    case 'play': {
      if (activity.demonstration && !state.demoSeen)
        return {
          state: withEffect(freshRound(state, 0), 'intro'),
          say: [lineId.intro(activity.id), lineId.demonstration(activity.id)],
          show: null,
        };
      const index = activity.rounds.findIndex((candidate) => candidate.id === event.roundId);
      if (index < 0) throw new Error(`Unknown round ${event.roundId}.`);
      const target = activity.rounds[index] as Round;
      if (target.kind === 'predict-motion' && state.played.includes(target.id))
        return {
          state: withEffect(
            { ...freshRound(state, index), solved: true, result: 'correct', choice: target.answer },
            'replay',
          ),
          say: [lineId.success(activity.id, target.id)],
          show: null,
        };
      const intro = state.phase === 'intro' ? [lineId.intro(activity.id)] : [];
      return { state: freshRound(state, index), say: [...intro, ...opening(activity, target)], show: null };
    }
  }
}

/**
 * The script for this moment of a play-through: every line (from `scriptIndex(path)`), with the current round's
 * lines as shown (shuffled positions change count and callout texts; clips are found by text).
 */
export function sessionScript(
  index: ReadonlyMap<string, ScriptLine>,
  activity: Activity,
  state: LessonState,
): Map<string, ScriptLine> {
  const lines = new Map(index);
  for (const line of roundScript(activity, currentRound(activity, state))) lines.set(line.id, line);
  return lines;
}
