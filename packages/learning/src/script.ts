/**
 * Everything Pip says, as data. Counting and matching lines are generated from the round's gem counts, so a
 * changed number can never leave the voice saying the wrong one. Cues tie spoken words to what lights up.
 */
import { layoutGroup, pairUp } from './layout.ts';
import type { Activity, Round, Theme } from './schema.ts';

export type Cue =
  | { word: number; type: 'light'; island: 'a' | 'b'; index: number }
  | { word: number; type: 'pair'; index: number }
  | { word: number; type: 'leftovers' };

export interface ScriptLine {
  /** Stable id, e.g. `compare-groups.r3.prompt`; clip lookup key. */
  id: string;
  text: string;
  cues: Cue[];
}

export const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
export const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

/** Whitespace-separated words with their character ranges (the unit voice timings use). */
export function wordsOf(text: string): { word: string; start: number; end: number }[] {
  return [...text.matchAll(/\S+/g)].map((match) => ({
    word: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

const plain = (id: string, text: string): ScriptLine => ({ id, text, cues: [] });

function countLine(id: string, island: 'a' | 'b', count: number): ScriptLine {
  // "One, two, three. Three gems."
  const counting = Array.from({ length: count }, (_, i) =>
    i === 0 ? capital(numberWord(1)) : numberWord(i + 1),
  );
  const text = `${counting.map((word, i) => `${word}${i === count - 1 ? '.' : ','}`).join(' ')} ${capital(numberWord(count))} ${count === 1 ? 'gem' : 'gems'}.`;
  return { id, text, cues: counting.map((_, index) => ({ word: index, type: 'light', island, index })) };
}

function matchLine(id: string, round: Extract<Round, { islands: unknown }>): ScriptLine {
  const pairing = pairUp(layoutGroup(round.islands[0]), layoutGroup(round.islands[1]));
  const matches = pairing.pairs.map(
    (_, i) => `${i === 0 ? 'Match' : 'match'}${i === pairing.pairs.length - 1 ? '.' : ','}`,
  );
  const tail =
    pairing.leftovers.length === 0
      ? 'No leftovers. They’re the same!'
      : `${capital(numberWord(pairing.leftovers.length))} left over!`;
  const cues: Cue[] = pairing.pairs.map((_, index) => ({ word: index, type: 'pair', index }));
  cues.push({ word: matches.length, type: 'leftovers' });
  return { id, text: `${matches.join(' ')} ${tail}`, cues };
}

export const lineId = {
  hello: 'pip.hello',
  bonus: 'pip.bonus',
  gate: 'pip.gate',
  rollOn: 'pip.roll-on',
  intro: (activity: string) => `${activity}.intro`,
  finale: (activity: string) => `${activity}.finale`,
  prompt: (activity: string, round: string) => `${activity}.${round}.prompt`,
  hint: (activity: string, round: string, level: number) => `${activity}.${round}.hint${level}`,
  success: (activity: string, round: string) => `${activity}.${round}.success`,
  count: (activity: string, round: string, island: 'a' | 'b') => `${activity}.${round}.count-${island}`,
  match: (activity: string, round: string) => `${activity}.${round}.match`,
};

export function roundScript(activity: Activity, round: Round): ScriptLine[] {
  const lines = [
    plain(lineId.prompt(activity.id, round.id), round.prompt),
    ...round.hints.map((hint, i) => plain(lineId.hint(activity.id, round.id, i + 1), hint)),
    plain(lineId.success(activity.id, round.id), round.success),
  ];
  if (round.kind !== 'choose') {
    lines.push(
      countLine(lineId.count(activity.id, round.id, 'a'), 'a', round.islands[0].count),
      countLine(lineId.count(activity.id, round.id, 'b'), 'b', round.islands[1].count),
      matchLine(lineId.match(activity.id, round.id), round),
    );
  }
  return lines;
}

export function activityScript(activity: Activity): ScriptLine[] {
  return [
    plain(lineId.intro(activity.id), activity.introduction),
    ...activity.rounds.flatMap((round) => roundScript(activity, round)),
    plain(lineId.finale(activity.id), activity.finale),
  ];
}

export function themeScript(theme: Theme): ScriptLine[] {
  const lines = theme.guide.lines;
  return [
    plain(lineId.hello, lines.hello),
    plain(lineId.bonus, lines.bonus),
    plain(lineId.gate, lines.gate),
    plain(lineId.rollOn, lines.rollOn),
  ];
}

/** Every line of a path, deduplicated by id: what the voice tool generates and the tests check. */
export function pathScript(path: { theme: Theme; activities: Activity[] }): ScriptLine[] {
  const byId = new Map<string, ScriptLine>();
  for (const line of [...themeScript(path.theme), ...path.activities.flatMap(activityScript)])
    byId.set(line.id, line);
  return [...byId.values()];
}

/** Look up one line by id (throws for an unknown id: a programming error, not a content problem). */
export function scriptIndex(path: { theme: Theme; activities: Activity[] }): Map<string, ScriptLine> {
  return new Map(pathScript(path).map((line) => [line.id, line]));
}
