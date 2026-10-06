import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const ids = [
  'rockets',
  'cars',
  'trains',
  'letters',
  'words',
  'shapes',
  'colors',
  'animals',
  'plants',
  'weather',
];
const lessons = ids.flatMap((id) => {
  const file = path.join(root, 'lessons', id, 'lesson.json');
  return fs.existsSync(file) ? [JSON.parse(fs.readFileSync(file, 'utf8'))] : [];
});
for (const lesson of lessons) {
  if (lesson.rounds.length !== 5) throw new Error(`${lesson.id}: expected five rounds`);
  for (const round of lesson.rounds) {
    if (round.choices.length < 2 || round.choices.length > 3)
      throw new Error(`${lesson.id}/${round.id}: expected 2–3 choices`);
    if (
      !round.correctChoiceIds.length ||
      round.correctChoiceIds.some((id) => !round.choices.some((choice) => choice.id === id))
    )
      throw new Error(`${lesson.id}/${round.id}: invalid answer`);
    if (round.hints.length !== 3) throw new Error(`${lesson.id}/${round.id}: expected three hints`);
    if (!fs.existsSync(path.join(root, 'lessons', lesson.id, round.scene)))
      throw new Error(`${lesson.id}/${round.id}: missing scene`);
  }
  if (!fs.existsSync(path.join(root, 'lessons', lesson.id, lesson.conceptImage)))
    throw new Error(`${lesson.id}: missing concept illustration`);
  if (lesson.reviewQuestions.length !== 3) throw new Error(`${lesson.id}: expected three review questions`);
}
const json = JSON.stringify(lessons)
  .replaceAll('<', '\\u003c')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029');
const template = fs.readFileSync(path.join(root, 'index.template.html'), 'utf8');
fs.writeFileSync(path.join(root, 'index.html'), template.replace('/* LESSON_DATA */ []', json));
fs.writeFileSync(
  path.join(root, 'manifest.json'),
  `${JSON.stringify({ date: '2026-09-30', audience: 'Ages 4–6', mode: 'Standalone concept review; no game integration', lessons: lessons.map(({ id, title, rounds }) => ({ id, title, rounds: rounds.length })) }, null, 2)}\n`,
);
const guide = ['# Pip’s next adventures — visual lesson review', '', 'Ten independent lesson concepts for ages 4–6. Each lesson has one generated story illustration, five exact question diagrams, three-stage hints, and three questions for adult review. These are proposals; no game integration or child playtesting is claimed.', ''];
for (const lesson of lessons) {
  const folder = path.join(root, 'lessons', lesson.id);
  guide.push('## ' + lesson.number + '. ' + lesson.title, '', '**Learning goal:** ' + lesson.learningGoal, '', '**A child could say or show:** ' + lesson.childTakeaway, '', '![' + lesson.conceptImageAlt + '](' + path.join(folder, lesson.conceptImage) + ')', '', '**Pip’s introduction:** ' + lesson.introPip, '', '**Story:** ' + lesson.story, '');
  for (const [index, round] of lesson.rounds.entries()) {
    const answer = round.choices.filter(choice => round.correctChoiceIds.includes(choice.id)).map(choice => choice.label).join(' or ');
    guide.push('### Question ' + (index + 1) + ': ' + round.title, '', round.prompt, '', '**Choices:** ' + round.choices.map(choice => choice.label).join(' · '), '', '[View the exact question scene](' + path.join(folder, round.scene) + ')', '', '**Accepted answer:** ' + answer + '. ' + round.success, '', '**Hints:** ' + round.hints.join(' → '), '', '**What it reveals:** ' + round.whyThisRound, '');
  }
  guide.push('### Questions for your review', '', ...lesson.reviewQuestions.map(question => '- ' + question), '', '**Away from the screen:** ' + lesson.offlineActivity, '', '[Complete teaching brief](' + path.join(folder, 'README.md') + ')', '');
}
fs.writeFileSync(path.join(root, 'review-guide.md'), guide.join('\n') + '\n');
console.log(
  `Built review gallery: ${lessons.length}/10 lessons, ${lessons.reduce((total, lesson) => total + lesson.rounds.length, 0)} question scenes.`,
);
