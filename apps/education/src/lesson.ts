import '@fontsource-variable/figtree';
import '@fontsource-variable/unbounded';
import './style.css';
import { checkAnswer, learningScript, readLearningDocument } from '@wwm/learning';
import { activityHtml } from './render.ts';
import { element, readFork } from './storage.ts';

const baseline = readLearningDocument(document);
const current = readFork(baseline);
const id = element('[data-learning-activity]').dataset.learningActivity;
const activity = current.path.activities.find((candidate) => candidate.id === id);
if (!activity) throw new Error('Activity not found in the learning document.');
const lesson = activity;
element('#activity-root').innerHTML = activityHtml(lesson);
element('#wwm-learning').outerHTML = learningScript(current.path);
element('#lesson-version').textContent =
  current.warning ??
  (current.fork ? 'Your family version · saved in this browser' : 'Original learning path');

function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.85;
  utterance.onerror = () => {
    element('#feedback').textContent = 'Audio is unavailable. A grown-up can read the words with you.';
  };
  window.speechSynthesis.speak(utterance);
}

const listen = element<HTMLButtonElement>('[data-listen]');
if (!('speechSynthesis' in window)) {
  listen.disabled = true;
  listen.textContent = 'Read together — audio unavailable';
}
listen.addEventListener('click', () => speak(`${lesson.introduction} ${lesson.prompt}`));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-answer]')) {
  button.disabled = false;
  button.addEventListener('click', () => {
    const answer = button.dataset.answer;
    if (!answer) return;
    const correct = checkAnswer(lesson, answer) === 'correct';
    const message = correct ? lesson.explanation : `Let’s look again. ${lesson.hint}`;
    for (const choice of document.querySelectorAll('[data-answer]')) choice.removeAttribute('data-result');
    button.dataset.result = correct ? 'correct' : 'retry';
    element('#feedback').textContent = message;
    element('#feedback').classList.toggle('success', correct);
    // Speak only after the child/parent has requested audio in this page session.
    if (audioRequested) speak(message);
  });
}
let audioRequested = false;
listen.addEventListener('click', () => {
  audioRequested = true;
});
const hint = element<HTMLButtonElement>('[data-hint]');
hint.disabled = false;
hint.addEventListener('click', () => {
  element('#feedback').classList.remove('success');
  element('#feedback').textContent = lesson.hint;
  if (audioRequested) speak(lesson.hint);
});
window.addEventListener('pagehide', () => {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
});
