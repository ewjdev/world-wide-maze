import '@fontsource-variable/figtree';
import '@fontsource-variable/unbounded';
import '@wwm/learning/scene.css';
import './style.css';
import './rocket.css';
import {
  createVoicePlayer,
  currentRound,
  initialState,
  type LessonEvent,
  lineId,
  motionEffectMs,
  type Orientation,
  readGuidedLearningDocument,
  runMotionEffect,
  scriptIndex,
  step,
} from '@wwm/learning';
import { hydrateSceneBlock, sceneBlock } from './render.ts';
import { rocketPortableHtml } from './rocket-render.ts';
import { download, element } from './storage.ts';

const path = readGuidedLearningDocument(document);
const activity = path.activities[0];
if (!activity) throw new Error('Rocket Lab is missing.');
const lesson = activity;
let state = initialState(lesson, { shuffle: 'none' });
let cancelEffect: (() => void) | undefined;
let cursor = -1;
let narrationToken: string | undefined;
let narrationDone = true;
let muted = false;
try {
  muted = localStorage.getItem('wwm-learning.muted') === '1';
} catch {
  /* Storage is optional. */
}
const voice = createVoicePlayer({ clips: path.voice?.clips ?? [], muted: () => muted });
const lines = scriptIndex(path);
const orientation = (): Orientation => (window.matchMedia('(max-width: 640px)').matches ? 'tall' : 'wide');
const button = (id: string) => element<HTMLButtonElement>(`#${id}`);
function say(ids: string[]): void {
  const token = state.effect?.token;
  narrationToken = token;
  narrationDone = false;
  void voice
    .play(
      ids.flatMap((id) => {
        const line = lines.get(id);
        return line ? [line] : [];
      }),
    )
    .then(() => {
      if (narrationToken === token) narrationDone = true;
    });
}
function render(): void {
  cancelEffect?.();
  cancelEffect = undefined;
  const round = currentRound(lesson, state);
  const busy = !!state.effect;
  const intro = state.effect?.purpose === 'intro';
  element('#intro').hidden = state.phase !== 'intro';
  element('#stage').hidden = state.phase === 'intro' || state.phase === 'done';
  element('#end').hidden = state.phase !== 'done';
  element('#stage').dataset.learningRound = round.id;
  element('#stage').dataset.effect = state.effect?.purpose ?? '';
  element('#stage').dataset.solved = String(state.solved);
  element('#prompt').textContent = intro
    ? 'Watch the air. Watch the balloon.'
    : state.phase === 'bonus-offer'
      ? 'One more discovery: a push in space?'
      : round.prompt;
  element('#scene').outerHTML = sceneBlock(path.theme, lesson, round, {
    orientation: orientation(),
    built: state.built,
    enabled: state.phase === 'round' && !busy && !state.solved,
    preview: state.phase === 'bonus-offer',
  });
  hydrateSceneBlock(element('#scene'));
  const feedback = intro
    ? lesson.introduction
    : state.result === 'correct' || state.solved
      ? round.success
      : state.hintLevel
        ? (round.hints[state.hintLevel - 1] ?? '')
        : '';
  element('#feedback').textContent = feedback;
  element('#experiment-status').textContent = busy
    ? 'Watch the experiment…'
    : state.phase === 'round'
      ? `${state.built} of 4 discoveries`
      : '';
  button('next').hidden = !state.solved;
  button('next').disabled = busy;
  button('hint').hidden = state.solved || state.phase !== 'round';
  button('hint').disabled = busy;
  button('bonus-play').hidden = state.phase !== 'bonus-offer';
  button('bonus-skip').hidden = state.phase !== 'bonus-offer';
  if (state.hintLevel === 3 && !intro)
    element('#scene').querySelector(`[data-choice-mark="${round.answer}"]`)?.classList.add('is-glow');
  if (state.solved)
    element('#scene').querySelector(`[data-choice-mark="${round.answer}"]`)?.classList.add('is-correct');
  if (state.effect && round.kind === 'predict-motion') {
    const effect = state.effect;
    const scene = effect.purpose === 'intro' ? (lesson.demonstration?.scene ?? round.scene) : round.scene;
    cancelEffect = runMotionEffect(
      element('#scene'),
      scene,
      () => {
        if (!narrationDone) voice.stop();
        dispatch({ type: 'effect-complete', token: effect.token });
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      motionEffectMs(lesson, state, path.voice?.clips),
      () => narrationToken === effect.token && narrationDone,
    );
  }
  if (state.phase === 'done') element('#end-heading').focus({ preventScroll: true });
}
function dispatch(event: LessonEvent): void {
  const result = step(lesson, state, event);
  if (result.state === state) return;
  state = result.state;
  cursor = -1;
  render();
  if (result.say.length) say(result.say);
}
button('pip-start').addEventListener('click', () => {
  voice.unlock();
  dispatch({ type: 'start' });
});
button('next').addEventListener('click', () => dispatch({ type: 'next' }));
button('hint').addEventListener('click', () => dispatch({ type: 'hint' }));
button('bonus-play').addEventListener('click', () => dispatch({ type: 'bonus', accept: true }));
button('bonus-skip').addEventListener('click', () => dispatch({ type: 'bonus', accept: false }));
button('again').addEventListener('click', () => {
  voice.stop();
  state = initialState(lesson, { shuffle: 'none' });
  render();
  element('#pip-start').focus();
});
button('replay').addEventListener('click', () => {
  if (state.effect || state.solved) {
    dispatch({ type: 'replay-effect' });
  } else say([lineId.prompt(lesson.id, currentRound(lesson, state).id)]);
});
function updateMute(): void {
  button('mute').textContent = muted ? 'Unmute Pip' : 'Mute Pip';
  button('mute').setAttribute('aria-pressed', String(muted));
}
button('mute').addEventListener('click', () => {
  muted = !muted;
  voice.stop();
  try {
    localStorage.setItem('wwm-learning.muted', muted ? '1' : '0');
  } catch {
    /* Storage is optional. */
  }
  updateMute();
});
button('download-rocket').addEventListener('click', () =>
  download('pip-rocket-lab.html', rocketPortableHtml(), 'text/html'),
);
element('#stage').addEventListener('click', (event) => {
  const choice = (event.target as Element).closest<HTMLElement>('[data-answer]')?.dataset.answer;
  if (choice) dispatch({ type: 'answer', choice });
});
document.addEventListener('keydown', (event) => {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing ||
    state.effect ||
    state.phase !== 'round'
  )
    return;
  if (state.solved && event.key === 'Enter') {
    event.preventDefault();
    dispatch({ type: 'next' });
    return;
  }
  const round = currentRound(lesson, state);
  if (round.kind !== 'predict-motion') return;
  if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    cursor = Math.max(
      0,
      Math.min(
        round.options.length - 1,
        cursor + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1),
      ),
    );
    element('#scene')
      .querySelectorAll('.is-focus')
      .forEach((el) => {
        el.classList.remove('is-focus');
      });
    element('#scene')
      .querySelector(`[data-choice-mark="${round.options[cursor]?.id}"]`)
      ?.classList.add('is-focus');
  } else if (event.key === 'Enter' && cursor >= 0) {
    event.preventDefault();
    dispatch({ type: 'answer', choice: round.options[cursor]?.id ?? '' });
  }
});
window.addEventListener('resize', render);
window.addEventListener('pagehide', () => {
  cancelEffect?.();
  voice.stop();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    render();
    if (state.effect) dispatch({ type: 'replay-effect' });
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) voice.stop();
  else if (state.effect) {
    render();
    const r = currentRound(lesson, state);
    say(
      state.effect.purpose === 'intro'
        ? [lineId.intro(lesson.id), lineId.demonstration(lesson.id)]
        : state.effect.purpose === 'explain' || state.effect.purpose === 'replay'
          ? [lineId.success(lesson.id, r.id)]
          : [lineId.hint(lesson.id, r.id, state.hintLevel)],
    );
  }
});
updateMute();
render();
