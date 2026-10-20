/**
 * Round generators for parametric objectives (Phase 31). The same spec, seed and id always give the same round,
 * so every consumer draws the same picture, and every generated round passes `roundSchema` and `roundIssues`.
 * The M0 spike found a model adds nothing here: these objectives vary only in counts, colours and layouts.
 */
import { colorRound } from './preschool.ts';
import type { GemGroup, GeneratorSpec, Round, Token } from './schema.ts';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => WORDS[n] ?? String(n);
const Word = (n: number) => word(n).charAt(0).toUpperCase() + word(n).slice(1);
const SPANISH: Record<string, Token['color']> = {
  rojo: 'red',
  azul: 'blue',
  verde: 'green',
  amarillo: 'yellow',
};

/** mulberry32: tiny, seeded, and identical everywhere. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Random = () => number;
const int = (random: Random, min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const pick = <T>(random: Random, values: readonly T[]): T =>
  values[Math.floor(random() * values.length)] as T;
function shuffled<T>(random: Random, values: readonly T[]): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** An everyday layout that fits the island at this count (rows of more than five run off the edge). */
function plainGroup(random: Random, count: number): GemGroup {
  const arrangement = pick(
    random,
    count <= 6 ? (['dice', 'scatter'] as const) : (['scatter', 'tight'] as const),
  );
  return arrangement === 'scatter'
    ? { count, arrangement, size: 'medium', seed: int(random, 1, 9999) }
    : { count, arrangement, size: 'medium' };
}

function compareRound(spec: Extract<GeneratorSpec, { kind: 'compare' }>, random: Random, id: string): Round {
  const roll = random();
  const variant = spec.same && roll < 0.25 ? 'same' : spec.trick && roll < 0.6 ? 'trick' : 'plain';
  const allowSame = spec.same;
  if (variant === 'same') {
    const n = int(random, 2, spec.max);
    const islands: [GemGroup, GemGroup] = shuffled(random, [
      { count: n, arrangement: 'spread', size: n <= 5 ? 'large' : 'medium' },
      { count: n, arrangement: 'tight', size: 'small' },
    ] satisfies GemGroup[]) as [GemGroup, GemGroup];
    return {
      id,
      kind: 'compare',
      prompt: 'Which island has more gems? Or are they the same?',
      islands,
      allowSame,
      answer: 'same',
      hints: [
        'One island looks bigger. Check carefully.',
        'Let’s match them up. One gem from each island, then look for leftovers.',
        `No leftovers! ${Word(n)} and ${word(n)}. They’re the same.`,
      ],
      success: `The same! ${Word(n)} and ${word(n)}. That’s equal, even though one looks bigger.`,
    };
  }
  const small = int(random, 1, spec.max - 1);
  const big = int(random, small + 1, Math.min(spec.max, small + 3));
  const trick = variant === 'trick';
  // A trick spreads the smaller group out (or makes its gems large) and bunches the bigger group up.
  const lesser: GemGroup = trick
    ? { count: small, arrangement: 'spread', size: small <= 5 && random() < 0.5 ? 'large' : 'medium' }
    : plainGroup(random, small);
  const greater: GemGroup = trick
    ? { count: big, arrangement: 'tight', size: 'small' }
    : plainGroup(random, big);
  const bFirst = random() < 0.5;
  return {
    id,
    kind: 'compare',
    prompt: trick
      ? 'Tricky one! Some gems are spread out. Which island has more?'
      : 'Which island has more gems?',
    islands: bFirst ? [lesser, greater] : [greater, lesser],
    allowSame,
    answer: bFirst ? 'b' : 'a',
    hints: [
      trick
        ? 'Spread-out gems can look like a lot. Check carefully.'
        : 'Look at both islands. Take your time.',
      'Let’s match them up. One gem from each island, then look for leftovers.',
      `${Word(big)} and ${word(small)}. The island with leftovers has more.`,
    ],
    success: trick
      ? `You checked! ${Word(big)} is more than ${word(small)}, even bunched up.`
      : `Yes! ${Word(big)} is more than ${word(small)}.`,
  };
}

function differenceRound(
  spec: Extract<GeneratorSpec, { kind: 'difference' }>,
  random: Random,
  id: string,
): Round {
  const small = int(random, 1, spec.max - 1);
  const big = int(random, small + 1, spec.max);
  const answer = big - small;
  const nearby = [answer - 1, answer + 1, answer + 2].filter((value) => value >= 1 && value <= 10);
  const choices = [answer, ...shuffled(random, nearby).slice(0, 2)].sort((x, y) => x - y);
  const bFirst = random() < 0.5;
  const lesser: GemGroup = { count: small, arrangement: 'dice', size: 'medium' };
  const greater: GemGroup =
    big <= 6 ? { count: big, arrangement: 'dice', size: 'medium' } : plainGroup(random, big);
  return {
    id,
    kind: 'difference',
    prompt: `How many more gems are on the island with ${word(big)}?`,
    islands: bFirst ? [lesser, greater] : [greater, lesser],
    choices,
    answer,
    hints: [
      'Match them up, then count only the leftovers.',
      'Let’s match them up. Now count the leftovers.',
      `${Word(answer)} left over. ${Word(big)} is ${word(answer)} more than ${word(small)}.`,
    ],
    success: `Yes! ${Word(answer)} more. ${Word(big)} is ${word(answer)} more than ${word(small)}.`,
  };
}

function countRound(spec: Extract<GeneratorSpec, { kind: 'count' }>, random: Random, id: string): Round {
  const target = pick(random, spec.targets);
  const others = shuffled(
    random,
    [target - 2, target - 1, target + 1, target + 2].filter((n) => n >= 1 && n <= 10),
  ).slice(0, spec.options - 1);
  const gems = (n: number): Token[] => Array.from({ length: n }, () => ({ shape: 'gem', color: 'teal' }));
  const upTo = Array.from({ length: target }, (_, i) => word(i + 1)).join(', ');
  return {
    id,
    kind: 'choose',
    prompt: `Which group has ${word(target)} gems?`,
    stimulus: [],
    options: shuffled(random, [target, ...others]).map((n) => ({
      id: word(n),
      label: `${Word(n)} ${n === 1 ? 'gem' : 'gems'}`,
      tokens: gems(n),
    })),
    answer: word(target),
    hints: [
      'Touch each gem once as you count.',
      `Point and say one number for each gem. Stop after ${word(target)}.`,
      `Look at the glowing group. ${upTo.charAt(0).toUpperCase()}${upTo.slice(1)}!`,
    ],
    success: `${upTo.charAt(0).toUpperCase()}${upTo.slice(1)}. ${Word(target)} gems altogether!`,
  };
}

function spanishColorRound(
  spec: Extract<GeneratorSpec, { kind: 'spanish-color' }>,
  random: Random,
  id: string,
): Round {
  const text = pick(random, spec.words);
  const color = SPANISH[text] as Token['color'];
  const others = shuffled(
    random,
    (['red', 'blue', 'green', 'yellow'] as const).filter((other) => other !== color),
  ).slice(0, spec.options - 1);
  const shape = pick(random, ['circle', 'square', 'triangle'] as const);
  return colorRound(id, text, color, shuffled(random, [color, ...others]), shape);
}

/** One round for `spec`, deterministic in `seed`. */
export function generateRound(spec: GeneratorSpec, seed: number, id: string): Round {
  const random = rng(seed);
  switch (spec.kind) {
    case 'compare':
      return compareRound(spec, random, id);
    case 'difference':
      return differenceRound(spec, random, id);
    case 'count':
      return countRound(spec, random, id);
    case 'spanish-color':
      return spanishColorRound(spec, random, id);
  }
}
