/**
 * How a round is shown and answered in one play-through (Phase 22): answer positions are shuffled per session
 * (deterministically from a seed) so the right answer isn't always on the same side, and each round invites a
 * way to answer (tap, a letter key, a number key, arrows, tilt) with device fallbacks and gentle nudges.
 */
import type { Activity, InputMode, LearningPath, Round } from './schema.ts';

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

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

/**
 * The round as shown in this session. Compare islands may swap (the answer follows); choose options are permuted.
 * Difference choices stay in counting order. `shuffle: 'none'` (or seed 0) shows the round as written.
 */
export function presentRound(round: Round, seed: number, shuffle: 'positions' | 'none' = 'positions'): Round {
  if (shuffle === 'none' || seed === 0) return round;
  const random = rng(seed ^ hash(round.id));
  if (round.kind === 'compare') {
    if (random() < 0.5) return round;
    const answer = round.answer === 'a' ? 'b' : round.answer === 'b' ? 'a' : 'same';
    return { ...round, islands: [round.islands[1], round.islands[0]], answer };
  }
  if (round.kind === 'choose') {
    const options = [...round.options];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [options[i], options[j]] = [
        options[j] as (typeof options)[number],
        options[i] as (typeof options)[number],
      ];
    }
    return { ...round, options };
  }
  return round;
}

// ── keys ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The key badge for each choice: A/B (S for "same") on islands, A/B/C… on options, digits on numbers. */
export function choiceKeys(round: Round): Record<string, string> {
  if (round.kind === 'compare') return round.allowSame ? { a: 'A', same: 'S', b: 'B' } : { a: 'A', b: 'B' };
  if (round.kind === 'difference')
    return Object.fromEntries(round.choices.map((value) => [String(value), String(value)]));
  return Object.fromEntries(round.options.map((option, i) => [option.id, String.fromCharCode(65 + i)]));
}

/** Which choice a key press names, if any (`KeyboardEvent.key`, case-insensitive). */
export function keyToChoice(round: Round, key: string): string | null {
  const wanted = key.toUpperCase();
  for (const [choice, badge] of Object.entries(choiceKeys(round))) if (badge === wanted) return choice;
  return null;
}

// ── input policy ──────────────────────────────────────────────────────────────────────────────────────────

export interface DeviceInputs {
  /** A pointer or touch screen. */
  tap: boolean;
  /** A physical keyboard (letter, number and arrow keys). */
  keyboard: boolean;
  /** A tilting controller (the WWM phone). */
  tilt: boolean;
}

export interface InputPolicy {
  /** What this round invites, after device fallbacks and the grown-up's tap-only setting. */
  invited: InputMode[];
  /** Pip's line explaining the invited input (null when tapping is invited). */
  promptLine: string | null;
  /** Show key badges on the choices. */
  badges: boolean;
}

const DEFAULT_INPUT: InputMode[] = ['tap', 'arrows', 'tilt'];
const NEEDS: Record<InputMode, keyof DeviceInputs> = {
  tap: 'tap',
  'letter-key': 'keyboard',
  'number-key': 'keyboard',
  arrows: 'keyboard',
  tilt: 'tilt',
};

export const inputLineId = {
  prompt: (mode: InputMode) => `pip.input.${mode}`,
  nudge: (mode: InputMode) => `pip.nudge.${mode}`,
};

export function inputPolicy(
  path: Pick<LearningPath, 'play' | 'family'>,
  activity: Pick<Activity, 'input'>,
  round: Round,
  device: DeviceInputs,
): InputPolicy {
  const fallback: InputMode[] = [
    ...(device.tap ? (['tap'] as const) : []),
    ...(device.keyboard ? (['arrows'] as const) : []),
    ...(device.tilt ? (['tilt'] as const) : []),
  ];
  if (path.family?.tapOnly) return { invited: fallback, promptLine: null, badges: false };
  const declared = round.input ?? activity.input ?? path.play?.input ?? DEFAULT_INPUT;
  const possible = declared.filter((mode) => device[NEEDS[mode]]);
  const invited = possible.length ? possible : fallback;
  const lead = invited.find((mode) => mode === 'letter-key' || mode === 'number-key');
  const tapInvited = invited.includes('tap') || (invited.includes('tilt') && device.tilt);
  return {
    invited,
    promptLine: lead
      ? inputLineId.prompt(lead)
      : !tapInvited && invited[0]
        ? inputLineId.prompt(invited[0])
        : null,
    badges: invited.includes('letter-key') || invited.includes('number-key'),
  };
}

/**
 * Accept the answer, or nudge towards the invited input first. After two nudges the answer is accepted anyway:
 * the variety invites, it never blocks a child who can't find the key.
 */
export function judgeInput(policy: InputPolicy, mode: InputMode, nudges: number): 'accept' | 'nudge' {
  if (policy.invited.includes(mode) || nudges >= 2) return 'accept';
  return 'nudge';
}

/** The nudge line for a policy (towards its first keyed or tilt mode). */
export function nudgeLine(policy: InputPolicy): string {
  const toward = policy.invited.find((mode) => mode !== 'tap') ?? 'arrows';
  return inputLineId.nudge(toward);
}
