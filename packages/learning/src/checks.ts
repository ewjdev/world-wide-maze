/**
 * Objective checks (Phase 31): facts about a round that the schema's shape can't see. Every round in a document,
 * hand-written, generated or model-written, must pass them. See docs/education/item-bank-spike/2026-10-19/.
 */
import type { Round } from './schema.ts';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const SPANISH_COLORS: Readonly<Record<string, string>> = {
  rojo: 'red',
  azul: 'blue',
  verde: 'green',
  amarillo: 'yellow',
};
const SPANISH_NUMBERS: Readonly<Record<string, number>> = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };

/** Numbers spoken in a line, as numbers ("Five and four." → [5, 4]). */
export function spokenNumbers(text: string): number[] {
  return [
    ...text.toLowerCase().matchAll(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/g),
  ].map(([, token = '']) => (/^\d+$/.test(token) ? Number(token) : NUMBER_WORDS.indexOf(token)));
}

/** Readable problems with one round (empty when it passes). */
export function roundIssues(round: Round): string[] {
  const issues: string[] = [];
  if (round.kind !== 'choose') {
    const [a, b] = round.islands;
    const counts = new Set([a.count, b.count, Math.abs(a.count - b.count)]);
    for (const [field, text] of [
      ['worked-example hint', round.hints.at(-1) ?? ''],
      ['success line', round.success],
    ] as const) {
      // "one" is often an article ("just one more"), so it never counts as a wrong number.
      const wrong = spokenNumbers(text).filter((value) => value !== 1 && !counts.has(value));
      if (wrong.length) issues.push(`The ${field} says ${wrong.join(', ')}, which isn't on the islands.`);
    }
    return issues;
  }
  const answer = round.options.find((option) => option.id === round.answer);
  if (round.stimulusText?.includes('_') && round.practice) {
    const word = round.stimulusText.replace('_', answer?.label ?? '').replaceAll(' ', '');
    if (word.toLowerCase() !== round.practice.text.replaceAll(' ', '').toLowerCase())
      issues.push(`The completed word "${word}" isn't the spoken word "${round.practice.text}".`);
  }
  if (round.practice?.language === 'es-ES') {
    const spoken = round.practice.text.toLowerCase();
    const color = SPANISH_COLORS[spoken];
    if (color && !(answer?.tokens.length && answer.tokens.every((token) => token.color === color)))
      issues.push(`"${round.practice.text}" means ${color}, but the answer isn't ${color}.`);
    const count = SPANISH_NUMBERS[spoken];
    if (count !== undefined && !round.stimulusText && answer?.tokens.length !== count)
      issues.push(
        `"${round.practice.text}" means ${count}, but the answer has ${answer?.tokens.length ?? 0}.`,
      );
  }
  return issues;
}
