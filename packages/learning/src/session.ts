/**
 * One play-through of an activity as a pure state machine, shared by the lesson page and the game so a round
 * behaves the same everywhere: wrong answers climb the hint ladder, a correct answer locks the round, help on
 * a trick round unlocks its follow-up, and bonus rounds are offered, never required.
 */

import { type Activity, checkRound, type Round } from './schema.ts';
import { lineId } from './script.ts';

export type Phase = 'intro' | 'round' | 'bonus-offer' | 'done';
/** What the page should show alongside the voice. */
export type Show = 'pulse' | 'match' | 'worked' | 'celebrate' | 'retry' | null;

export interface LessonState {
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
}

export type LessonEvent =
  | { type: 'start' }
  | { type: 'answer'; choice: string }
  | { type: 'hint' }
  | { type: 'match' }
  | { type: 'next' }
  | { type: 'bonus'; accept: boolean };

export interface Step {
  state: LessonState;
  /** Script line ids to play, in order (replacing whatever is playing). */
  say: string[];
  show: Show;
}

export function initialState(activity: Activity): LessonState {
  return {
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

export function currentRound(activity: Activity, state: LessonState): Round {
  return activity.rounds[state.index] as Round;
}

const isRequired = (round: Round) => !round.optional && !round.onlyAfterHelpOn;

/** Rounds on the main path, the bridge's planks (bonus and conditional follow-ups excluded). */
export function requiredRounds(activity: Activity): number {
  return activity.rounds.filter(isRequired).length;
}

const hasIslands = (round: Round) => round.kind !== 'choose';

function freshRound(state: LessonState, index: number, phase: Phase = 'round'): LessonState {
  return { ...state, phase, index, hintLevel: 0, misses: 0, choice: null, result: null, solved: false };
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

export function step(activity: Activity, state: LessonState, event: LessonEvent): Step {
  const round = currentRound(activity, state);
  const none: Step = { state, say: [], show: null };
  switch (event.type) {
    case 'start': {
      if (state.phase !== 'intro') return none;
      return {
        state: freshRound(state, 0),
        say: [lineId.intro(activity.id), lineId.prompt(activity.id, activity.rounds[0]?.id ?? '')],
        show: null,
      };
    }
    case 'answer': {
      // A solved round is locked: a stray tap can't undo a success.
      if (state.phase !== 'round' || state.solved) return none;
      if (checkRound(round, event.choice) === 'correct')
        return {
          state: {
            ...state,
            choice: event.choice,
            result: 'correct',
            solved: true,
            built: state.built + (isRequired(round) ? 1 : 0),
          },
          say: [lineId.success(activity.id, round.id)],
          show: 'celebrate',
        };
      const level = Math.min(round.hints.length, state.hintLevel + 1);
      const hint = hintLines(activity, round, level);
      return {
        state: {
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
        state: { ...state, hintLevel: level, helped: markHelped(state, round, level) },
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
      return { state: freshRound(state, next), say: [lineId.prompt(activity.id, upcoming.id)], show: null };
    }
    case 'bonus': {
      if (state.phase !== 'bonus-offer') return none;
      if (!event.accept)
        return { state: { ...state, phase: 'done' }, say: [lineId.finale(activity.id)], show: 'celebrate' };
      return { state: { ...state, phase: 'round' }, say: [lineId.prompt(activity.id, round.id)], show: null };
    }
  }
}
