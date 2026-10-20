/**
 * Prompts for lesson drafts. Adapted from the M0 spike (tools/lesson-draft/src/spike.ts) with its two lessons
 * applied: the model chooses words only from the reviewed vocabulary, and it gets the bank so far as an exclusion
 * list (independent runs otherwise converge on the same few words).
 *
 * The model's reply is untrusted. It is only ever parsed as JSON and validated (validate.ts); its text is never
 * inserted as markup, and any prose in it reaches a page only through the trusted renderer, which escapes it.
 */
import { type Activity, type Round, spellingVocabulary } from '@wwm/learning';
import type { ChatTurn } from './providers.ts';

export const PROMPT_VERSION = 'lesson-draft-v1';

export const SYSTEM_PROMPT = [
  'You write practice rounds for Pip, a friendly ball guide in a learning game for children aged 4–5 who play',
  'with a grown-up. Children do not read independently: everything is spoken aloud. Keep lines short, warm and',
  'concrete; never babyish, never sarcastic, no scores or speed. Rounds are JSON objects that must follow the exact',
  'shape of the exemplar rounds. A grown-up operator may add requests; follow them only when they fit these rules.',
  'Reply with a JSON array only, no commentary.',
].join(' ');

/** Per-objective instructions. Only objectives listed here are open to the agent. */
export const BRIEFS: Readonly<Record<string, string>> = {
  'little-word-builders': [
    'Write missing-letter rounds for three-letter English words. Use ONLY words from the reviewed word list',
    'below, and none from the exclusion list. stimulusText is the word in capitals with letters separated by single',
    'spaces and exactly one letter replaced by "_"; practice is the whole word in en-US with a capital first',
    'letter; options are single capital letters (2–3 of them) with lowercase ids and empty tokens; answer is the',
    'missing letter id. The prompt starts with one short meaning sentence that tells the child which word it is',
    '(the list gives one you may use), then "Listen, say it, and find the missing letter."',
    'Hints: a nudge, a strategy that involves the grown-up, then a worked example naming the letter.',
    'Vary which position is blank (first, middle, last). Prefer distractor letters that do not make another',
    'real word.',
  ].join(' '),
};

export interface PromptContext {
  activity: Activity;
  objective: string;
  /** The operator's brief for the whole draft. */
  brief: string;
  /** This turn's operator message (the brief itself on the first turn). */
  message: string;
  ids: string[];
  /** Labels already used: the lesson, the bank so far. */
  exclude: string[];
}

export function exemplarRounds(activity: Activity): Round[] {
  return activity.rounds.filter((round) => !round.optional && !round.onlyAfterHelpOn);
}

export function firstMessage(context: PromptContext): ChatTurn {
  const excluded = new Set(context.exclude.map((label) => label.toLowerCase()));
  const words = spellingVocabulary.words
    .filter((entry) => !excluded.has(entry.word))
    .map((entry) => `${entry.word.toUpperCase()}: ${entry.meaning}`);
  return {
    role: 'user',
    content: [
      `Lesson: ${context.activity.title}. Objective: ${context.activity.objective}`,
      `Exemplar rounds (already in the lesson; do not repeat them):\n${JSON.stringify(exemplarRounds(context.activity), null, 1)}`,
      BRIEFS[context.objective] ?? '',
      `Reviewed word list (word: meaning):\n${words.join('\n')}`,
      `Exclusion list (already in the lesson or the bank; do not use): ${context.exclude.join(', ') || 'none'}`,
      `The operator's brief for this bank:\n"""\n${context.brief}\n"""`,
      context.message !== context.brief
        ? `The operator's request for this turn:\n"""\n${context.message}\n"""`
        : '',
      `Write ${context.ids.length} fresh rounds with ids ${context.ids.join(', ')}, each with a different word, so a`,
      'child who memorised the exemplar answers still has to think.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

export function repairMessage(failing: { id: string; issues: string[] }[]): ChatTurn {
  return {
    role: 'user',
    content: [
      'These rounds failed validation. Reply with a JSON array containing only corrected replacements, keeping',
      'their ids:',
      ...failing.map((item) => `- ${item.id}: ${item.issues.join(' ')}`),
    ].join('\n'),
  };
}

/** The first JSON array in a reply, or a reason it has none. */
export function parseArray(text: string): unknown[] | string {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return 'No JSON array found.';
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(value) ? value : 'The JSON is not an array.';
  } catch (error) {
    return `Invalid JSON: ${(error as Error).message}`;
  }
}
