/**
 * Everything Pip says, as data. Counting, matching and callout lines are generated from the round data, so a
 * changed number or a shuffled position can never leave the voice saying the wrong thing. Cues tie spoken words
 * to what lights up. Clips are looked up by text (voice.ts), so a line keeps its clip wherever it's used.
 */
import { layoutGroup, pairUp } from './layout.ts';
import type { Activity, Round, Theme } from './schema.ts';

export type Cue =
  | { word: number; type: 'light'; island: 'a' | 'b'; index: number }
  | { word: number; type: 'pair'; index: number }
  | { word: number; type: 'leftovers' }
  /** Phase 22: the choice being named in a callout pulses (`[data-choice-mark].is-callout`). */
  | { word: number; type: 'choice'; id: string };

export interface ScriptLine {
  /** Stable id, e.g. `compare-groups.r3.prompt`. */
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

/** Counting and comparison options keep neutral names ("Group A") so a label never gives the answer away. */
export function neutralLabels(activity: Pick<Activity, 'domain'>): boolean {
  return activity.domain === 'counting' || activity.domain === 'comparison';
}

export const lineId = {
  hello: 'pip.hello',
  bonus: 'pip.bonus',
  gate: 'pip.gate',
  rollOn: 'pip.roll-on',
  intro: (activity: string) => `${activity}.intro`,
  finale: (activity: string) => `${activity}.finale`,
  prompt: (activity: string, round: string) => `${activity}.${round}.prompt`,
  callout: (activity: string, round: string) => `${activity}.${round}.callout`,
  hint: (activity: string, round: string, level: number) => `${activity}.${round}.hint${level}`,
  success: (activity: string, round: string) => `${activity}.${round}.success`,
  count: (activity: string, round: string, island: 'a' | 'b') => `${activity}.${round}.count-${island}`,
  match: (activity: string, round: string) => `${activity}.${round}.match`,
};

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

/**
 * "Island A… or island B?", "Group A, group B, or group C?", "Square, circle, or triangle?", "Two, three, or
 * four?": Pip names the choices in on-screen order and each one pulses as it's said. It names positions, not
 * answers, so a shuffled round never makes it wrong.
 */
export function calloutLine(activity: Activity, round: Round): ScriptLine {
  const names: { id: string; words: string[] }[] =
    round.kind === 'compare'
      ? [
          { id: 'a', words: ['island', 'A'] },
          { id: 'b', words: ['island', 'B'] },
          ...(round.allowSame ? [{ id: 'same', words: ['the', 'same'] }] : []),
        ]
      : round.kind === 'difference'
        ? round.choices.map((value) => ({ id: String(value), words: [numberWord(value)] }))
        : round.options.map((option, i) => ({
            id: option.id,
            words: neutralLabels(activity)
              ? ['group', String.fromCharCode(65 + i)]
              : option.label.toLowerCase().split(/\s+/),
          }));
  const words: string[] = [];
  const cues: Cue[] = [];
  names.forEach((name, i) => {
    const last = i === names.length - 1;
    if (last && names.length > 1) words.push('or');
    cues.push({ word: words.length, type: 'choice', id: name.id });
    const phrase = [...name.words];
    phrase[phrase.length - 1] = `${phrase.at(-1)}${last ? '?' : names.length === 2 ? '…' : ','}`;
    words.push(...phrase);
  });
  words[0] = capital(words[0] ?? '');
  return { id: lineId.callout(activity.id, round.id), text: words.join(' '), cues };
}

export function roundScript(activity: Activity, round: Round): ScriptLine[] {
  const lines = [
    plain(lineId.prompt(activity.id, round.id), round.prompt),
    calloutLine(activity, round),
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

// ── Phase 22: inputs, missions, locks ─────────────────────────────────────────────────────────────────────

export const MAX_GATE_NUMBER = 8;
export const MISSION_LETTERS = 'ABCDEFGHIJ';

export const systemLineId = {
  number: (n: number) => `pip.number.${n}`,
  collect: (n: number) => `pip.mission.collect.${n}`,
  collectDone: 'pip.mission.collect.done',
  reachMost: 'pip.mission.reach.most-gems',
  reachFewest: 'pip.mission.reach.fewest-gems',
  reachLetter: (letter: string) => `pip.mission.reach.letter.${letter.toLowerCase()}`,
  reachDone: 'pip.mission.reach.done',
  lockedGate: (gate: number) => `pip.locked.gate.${gate}`,
  lockedCollect: (n: number) => `pip.locked.collect.${n}`,
  lockedReach: 'pip.locked.reach',
  lockedLift: 'pip.locked.lift',
  lockedGoal: 'pip.locked.goal',
  unlockedBridge: 'pip.unlocked.bridge',
  unlockedLift: 'pip.unlocked.lift',
  unlockedGoal: 'pip.unlocked.goal',
  oops: 'pip.oops',
  missionPost: 'pip.mission.post',
};

/** Lines every lesson may need in a game: input prompts and nudges, missions, locks. Generated, English. */
export function systemScript(): ScriptLine[] {
  const lines: ScriptLine[] = [
    plain('pip.input.letter-key', 'Press the letter!'),
    plain('pip.input.number-key', 'Type the number!'),
    plain('pip.input.arrows', 'Use the arrows, then press enter!'),
    plain('pip.input.tilt', 'Tilt to choose, then jump!'),
    plain('pip.input.tap', 'Tap your answer!'),
    plain('pip.nudge.letter-key', 'Try pressing the letter!'),
    plain('pip.nudge.number-key', 'Try typing the number!'),
    plain('pip.nudge.arrows', 'Try the arrow keys!'),
    plain('pip.nudge.tilt', 'Try tilting to choose!'),
    plain('pip.nudge.tap', 'Try tapping your answer!'),
    plain(systemLineId.collectDone, 'That’s all the gems Pip needs. Thank you!'),
    plain(systemLineId.reachMost, 'Roll to the island with the most gems!'),
    plain(systemLineId.reachFewest, 'Roll to the island with the fewest gems!'),
    plain(systemLineId.reachDone, 'You found it!'),
    plain(systemLineId.lockedReach, 'This bridge opens when you find the island!'),
    plain(systemLineId.lockedLift, 'This lift is locked. Help Pip first!'),
    plain(systemLineId.lockedGoal, 'The finish is locked. Pip still needs your help!'),
    plain(systemLineId.unlockedBridge, 'The bridge is open!'),
    plain(systemLineId.unlockedLift, 'The lift is working!'),
    plain(systemLineId.unlockedGoal, 'The finish is open!'),
    plain(systemLineId.oops, 'Oops! Pip’s gate first.'),
    plain(systemLineId.missionPost, 'A Pip mission! Listen closely.'),
  ];
  for (let n = 1; n <= 10; n++) {
    const gems = n === 1 ? 'gem' : 'gems';
    lines.push(plain(systemLineId.number(n), `${capital(numberWord(n))}!`));
    lines.push(plain(systemLineId.collect(n), `Bring Pip ${numberWord(n)} ${gems}!`));
    lines.push(
      plain(systemLineId.lockedCollect(n), `This bridge opens when Pip has ${numberWord(n)} ${gems}!`),
    );
  }
  for (const letter of MISSION_LETTERS)
    lines.push(plain(systemLineId.reachLetter(letter), `Roll to island ${letter}!`));
  for (let gate = 1; gate <= MAX_GATE_NUMBER; gate++)
    lines.push(
      plain(
        systemLineId.lockedGate(gate),
        `This bridge is locked. Solve Pip gate ${numberWord(gate)} first!`,
      ),
    );
  return lines;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/** Callouts for every order a shuffled round can be shown in (named options only; others never change). */
function calloutVariants(activity: Activity, round: Round): ScriptLine[] {
  if (round.kind !== 'choose' || neutralLabels(activity)) return [];
  const base = calloutLine(activity, round);
  return permutations(round.options)
    .map((options, k) => ({ ...calloutLine(activity, { ...round, options }), id: `${base.id}.v${k}` }))
    .filter((line) => line.text !== base.text);
}

/**
 * Every distinct line of a path (theme, system, activities, and shuffled-callout variants): what the voice tool
 * generates and the tests check. Deduplicated by id.
 */
export function pathScript(path: { theme: Theme; activities: Activity[] }): ScriptLine[] {
  const byId = new Map<string, ScriptLine>();
  const all = [
    ...themeScript(path.theme),
    ...systemScript(),
    ...path.activities.flatMap((activity) => [
      ...activityScript(activity),
      ...activity.rounds.flatMap((round) => calloutVariants(activity, round)),
    ]),
  ];
  for (const line of all) byId.set(line.id, line);
  return [...byId.values()];
}

/** Every line by id, as written (use `sessionScript` for the round as shown in a play-through). */
export function scriptIndex(path: { theme: Theme; activities: Activity[] }): Map<string, ScriptLine> {
  return new Map(pathScript(path).map((line) => [line.id, line]));
}
