import { describe, expect, test } from 'vitest';
import {
  type Activity,
  AUTHORING_OBJECTIVES,
  bankFileSchema,
  baselinePath,
  commonThreeLetterWords,
  type Round,
  reviewedBankReport,
  reviewedBanks,
  roundIssues,
  roundSchema,
  spellingBankRound,
  spellingFlags,
  spellingIssues,
  spellingVocabulary,
} from '../src/index.ts';

const lesson = baselinePath.activities.find((activity) => activity.id === 'little-word-builders') as Activity;
const entry = (word: string) =>
  spellingVocabulary.words.find((candidate) => candidate.word === word) ?? { word, meaning: 'x' };
const item = (id: string, word: string, blank = 1, letters?: string[]) => {
  const answer = word[blank]?.toUpperCase() ?? '';
  return spellingBankRound(id, entry(word), blank, letters ?? [answer, answer === 'U' ? 'O' : 'U']);
};

describe('reviewed vocabulary', () => {
  test('a reviewed list of 40–80 three-letter CVC words, each with a short meaning', () => {
    const { words } = spellingVocabulary;
    expect(spellingVocabulary.reviewStatus).toBe('reviewed');
    // Removed in review (2026-10-20): a choking risk, a sharp object, and words that assume a family shape.
    for (const removed of ['gum', 'pin', 'mom', 'dad'])
      expect(words.map((w) => w.word)).not.toContain(removed);
    expect(words.length).toBeGreaterThanOrEqual(40);
    expect(words.length).toBeLessThanOrEqual(80);
    expect(new Set(words.map((w) => w.word)).size).toBe(words.length);
    for (const { word, meaning } of words) {
      expect(word).toMatch(/^[b-df-hj-np-tv-z][aeiou][b-df-hj-np-tv-z]$/);
      expect(meaning.length).toBeLessThanOrEqual(90);
      expect(meaning).toMatch(/[.!]$/);
    }
    for (const round of lesson.rounds)
      expect(words.some((w) => w.word === round.practice?.text.toLowerCase())).toBe(true);
  });

  test('every word builds a valid item in each blank position', () => {
    for (const { word } of spellingVocabulary.words)
      for (const blank of [0, 1, 2]) {
        const round = item(`w-${word}-${blank}`, word, blank, [
          word[blank]?.toUpperCase() ?? '',
          blank === 1 ? 'Y' : 'Q',
        ]);
        expect(roundSchema.parse(round)).toEqual(round);
        expect(roundIssues(round)).toEqual([]);
        expect(spellingIssues(round)).toEqual([]);
      }
  });
});

describe('spelling checks', () => {
  test('the authored lesson passes; its real-word distractors are flagged for review (M0 finding)', () => {
    for (const round of lesson.rounds) expect(spellingIssues(round)).toEqual([]);
    const flagged = lesson.rounds.flatMap(spellingFlags).join(' ');
    expect(flagged).toContain('CAP');
    expect(flagged).toContain('MOP');
  });

  test('a word off the reviewed list, a wrong spoken word and a missing worked example all fail', () => {
    const offList = {
      ...item('x', 'pig'),
      stimulusText: 'B _ S',
      practice: { text: 'Bis', language: 'en-US' as const },
    };
    expect(spellingIssues(offList as Round)).toContain('"BIS" is not on the reviewed word list.');
    expect(spellingIssues({ ...item('x', 'pig'), practice: { text: 'Pug', language: 'en-US' } })).toContain(
      'practice.text must be the completed word "PIG".',
    );
    expect(spellingIssues({ ...item('x', 'pig'), hints: ['Look.', 'Ask.', 'Try again.'] })).toContain(
      'The last hint must name the letter.',
    );
    expect(spellingIssues({ ...item('x', 'pig'), stimulusText: 'P _ _' })[0]).toMatch(/exactly one "_"/);
  });

  test('the common-word list is only for flags, never to accept a word', () => {
    expect(commonThreeLetterWords.has('cap')).toBe(true);
    expect(spellingVocabulary.words.some((w) => w.word === 'sum')).toBe(false);
    expect(spellingFlags(item('x', 'pig', 1, ['I', 'E']))[0]).toContain('PEG');
  });
});

describe('reviewedBankReport', () => {
  const objective = 'little-word-builders';
  test('a fresh bank of reviewed words passes', () => {
    const report = reviewedBankReport(baselinePath, {
      objective,
      items: [item('a', 'pig'), item('b', 'hen')],
    });
    expect(report.issues).toEqual([]);
  });

  test.each([
    ['an unknown objective', { objective: 'flying', items: [item('a', 'pig')] }, 'Unknown objective'],
    [
      'a generator objective',
      { objective: 'count-three', items: [item('a', 'pig')] },
      'already has a generator bank',
    ],
    ['a closed objective', { objective: 'spanish-word-builders', items: [item('a', 'pig')] }, 'not open'],
    [
      'a lesson repeat',
      { objective, items: [{ ...(lesson.rounds[0] as Round), id: 'a' }] },
      'repeats a round in the lesson',
    ],
    [
      'a duplicate item',
      { objective, items: [item('a', 'pig'), item('b', 'pig')] },
      'duplicates another item',
    ],
    ['a duplicate id', { objective, items: [item('a', 'pig'), item('a', 'hen')] }, 'duplicate id'],
    ['a bonus round', { objective, items: [{ ...item('a', 'pig'), optional: true }] }, 'plain rounds'],
    [
      'an off-list word',
      {
        objective,
        items: [
          {
            ...item('a', 'pig'),
            stimulusText: 'Z _ G',
            practice: { text: 'Zig', language: 'en-US' as const },
          },
        ],
      },
      'not on the reviewed word list',
    ],
  ])('refuses %s', (_name, bank, message) => {
    expect(reviewedBankReport(baselinePath, bank).issues.join(' ')).toContain(message);
  });

  test('only the spelling objective is open to the agent, and no bank is imported yet', () => {
    expect(Object.keys(AUTHORING_OBJECTIVES)).toEqual(['little-word-builders']);
    expect(reviewedBanks).toEqual([]);
    expect(baselinePath.banks?.map((bank) => bank.objective)).not.toContain('little-word-builders');
  });

  test('the export format is strict', () => {
    const file = {
      format: 'wwm-learning-bank/1',
      objective,
      items: [item('a', 'pig')],
      provenance: { draft: 'd-1', revision: '0'.repeat(32), approvedAt: '2026-10-19T00:00:00Z', note: 'ok' },
    };
    expect(bankFileSchema.parse(file)).toEqual(file);
    expect(
      bankFileSchema.safeParse({ ...file, provenance: { ...file.provenance, email: 'a@b.c' } }).success,
    ).toBe(false);
    expect(bankFileSchema.safeParse({ ...file, format: 'wwm-learning-bank/2' }).success).toBe(false);
  });
});
