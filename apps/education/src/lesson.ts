/**
 * Enhances a generated lesson page: the shared state machine (`step`) decides what happens, Pip's voice plays
 * the lines it returns, and word cues light gems and draw match lines on the trusted scene SVG.
 */
import '@fontsource-variable/figtree';
import '@fontsource-variable/unbounded';
import './style.css';
import {
  type Activity,
  type Cue,
  createVoicePlayer,
  currentRound,
  DEFAULT_AUDIO_BASE,
  initialState,
  type LessonEvent,
  type LessonState,
  learningScript,
  lineId,
  type Orientation,
  pairUp,
  type Round,
  readLearningDocument,
  requiredRounds,
  type ScriptLine,
  type Show,
  sceneLayout,
  scriptIndex,
  step,
} from '@wwm/learning';
import { planksBuilt, sceneBlock, spokenHtml } from './render.ts';
import { element, readFork } from './storage.ts';

const MUTE_KEY = 'wwm-learning.muted';

const baseline = readLearningDocument(document);
const current = readFork(baseline);
const path = current.path;
const activityId = element('[data-learning-activity]').dataset.learningActivity;
const found = path.activities.find((candidate) => candidate.id === activityId);
if (!found) throw new Error('Activity not found in the learning document.');
const lesson: Activity = found;
element('#wwm-learning').outerHTML = learningScript(path);
element('[data-learning-field="introduction"]').textContent = lesson.introduction;
element('#lesson-version').textContent =
  current.warning ??
  (current.fork ? 'Your family version · saved in this browser' : 'Original learning path');

const script = scriptIndex(path);
const planks = requiredRounds(lesson);
const narrow = window.matchMedia('(max-width: 640px)');
let orientation: Orientation = narrow.matches ? 'tall' : 'wide';
let state: LessonState = initialState(lesson);
let muted = readMuted();

const intro = element('#intro');
const stage = element('#stage');
const end = element('#end');
const prompt = element('#prompt');
const feedback = element('#feedback');
const nextButton = element<HTMLButtonElement>('#next');
const hintButton = element<HTMLButtonElement>('#hint');
const matchButton = document.querySelector<HTMLButtonElement>('#match');
const bonusPlay = element<HTMLButtonElement>('#bonus-play');
const bonusSkip = element<HTMLButtonElement>('#bonus-skip');
const replay = element<HTMLButtonElement>('#replay');
const mute = element<HTMLButtonElement>('#mute');
const pipStart = element<HTMLButtonElement>('#pip-start');

// ── marks: classes on scene elements, remembered so a re-render (new plank, rotation) keeps them ──────────

const marks = new Map<string, Set<string>>();
const scene = () => element('#scene');

function mark(selector: string, className: string): void {
  const set = marks.get(selector) ?? new Set<string>();
  set.add(className);
  marks.set(selector, set);
  for (const node of scene().querySelectorAll(selector)) node.classList.add(className);
}

function unmark(className: string): void {
  for (const [selector, set] of marks) {
    set.delete(className);
    if (!set.size) marks.delete(selector);
  }
  for (const node of scene().querySelectorAll(`.${className}`)) node.classList.remove(className);
}

/** A one-off animation class (not remembered): removed and re-added so it plays again. */
function flash(selector: string, className: string): void {
  for (const node of scene().querySelectorAll(selector)) {
    node.classList.remove(className);
    void (node as SVGElement).getBoundingClientRect();
    node.classList.add(className);
    node.addEventListener('animationend', () => node.classList.remove(className), { once: true });
  }
}

// ── the voice ─────────────────────────────────────────────────────────────────────────────────────────────

let spokenTarget: HTMLElement | null = null;

function highlight(line: ScriptLine | null, word = -1): void {
  for (const node of document.querySelectorAll('.w.is-spoken')) node.classList.remove('is-spoken');
  if (!line) return;
  spokenTarget =
    line.id === promptLineId() && state.phase === 'round'
      ? prompt
      : state.phase === 'done'
        ? element('#finale')
        : feedback.querySelector<HTMLElement>(`[data-line="${line.id}"]`);
  if (word >= 0) spokenTarget?.querySelector(`[data-w="${word}"]`)?.classList.add('is-spoken');
}

function leftoverSelectors(round: Round): string[] {
  if (round.kind === 'choose') return [];
  const [a, b] = sceneLayout(round, orientation, planks).islands;
  if (!a || !b) return [];
  const pairing = pairUp(a.layout, b.layout);
  return pairing.extra ? pairing.leftovers.map((index) => `[data-gem="${pairing.extra}-${index}"]`) : [];
}

function applyCue(cue: Cue): void {
  if (state.phase === 'done') return;
  if (cue.type === 'light') mark(`[data-gem="${cue.island}-${cue.index}"]`, 'is-lit');
  else if (cue.type === 'pair') mark(`[data-pair="${cue.index}"]`, 'is-shown');
  else for (const selector of leftoverSelectors(currentRound(lesson, state))) mark(selector, 'is-leftover');
}

const playing: { lines: ScriptLine[]; index: number } = { lines: [], index: -1 };

/** A count starts from one: clear that island's earlier count before lighting it again. */
function resetCount(line: ScriptLine): void {
  const cue = line.cues.find((candidate) => candidate.type === 'light');
  if (cue?.type !== 'light') return;
  const prefix = `[data-gem="${cue.island}-`;
  for (const [selector, set] of marks) if (selector.startsWith(prefix)) set.delete('is-lit');
  for (const node of scene().querySelectorAll(`[data-gem^="${cue.island}-"].is-lit`))
    node.classList.remove('is-lit');
}

const voice = createVoicePlayer({
  audioBase: import.meta.env.VITE_LEARNING_AUDIO_BASE ?? DEFAULT_AUDIO_BASE,
  clips: path.voice?.clips ?? [],
  muted: () => muted,
  onLine: (line) => {
    playing.index = line ? playing.lines.indexOf(line) : -1;
    if (line && state.phase !== 'done') resetCount(line);
    highlight(line);
  },
  onWord: (line, word) => highlight(line, word),
  onCue: (cue) => applyCue(cue),
});

function say(ids: readonly string[]): void {
  const lines = ids.map((id) => script.get(id)).filter((line): line is ScriptLine => line !== undefined);
  playing.lines = lines;
  playing.index = -1;
  voice.preload(lines);
  void voice.play(lines);
}

// ── what the page shows ───────────────────────────────────────────────────────────────────────────────────

function promptLineId(): string {
  if (state.phase === 'bonus-offer') return lineId.bonus;
  if (state.phase === 'done') return lineId.finale(lesson.id);
  return lineId.prompt(lesson.id, currentRound(lesson, state).id);
}

/** The spoken lines of a step, written out (prompts are already on screen as the question). */
function setFeedback(ids: readonly string[], success: boolean): void {
  const promptId = promptLineId();
  const lines = ids
    .filter((id) => id !== promptId || state.phase === 'bonus-offer')
    .map((id) => script.get(id))
    .filter((line): line is ScriptLine => line !== undefined);
  if (!lines.length && !success) {
    feedback.textContent = '';
    feedback.classList.remove('is-success');
    return;
  }
  if (!lines.length) return;
  feedback.innerHTML = lines
    .map((line) => `<span data-line="${line.id.replace(/"/g, '')}">${spokenHtml(line.text)}</span>`)
    .join(' ');
  feedback.classList.toggle('is-success', success);
}

/**
 * Size the scene so the question, the scene, the feedback and the Next button share the first viewport: the
 * vertical space around the scene is measured (the prompt may wrap to several lines) rather than guessed.
 */
function fitScene(): void {
  if (stage.hidden) return;
  const px = (value: string) => Number.parseFloat(value) || 0;
  const top = scene().getBoundingClientRect().top + window.scrollY;
  const feedbackStyle = getComputedStyle(feedback);
  const controls = getComputedStyle(element('#controls'));
  const below =
    px(feedbackStyle.minHeight) +
    px(feedbackStyle.marginTop) +
    px(controls.marginTop) +
    Math.max(px(getComputedStyle(nextButton).minHeight), px(getComputedStyle(hintButton).minHeight)) +
    12;
  document.body.style.setProperty('--chrome', `${Math.ceil(top + below)}px`);
}

function renderScene(): void {
  const round = currentRound(lesson, state);
  const built = planksBuilt(lesson, state.index, state.solved);
  scene().outerHTML = sceneBlock(path.theme, lesson, round, {
    orientation,
    built,
    enabled: true,
    preview: state.phase === 'bonus-offer',
  });
  fitScene();
  for (const [selector, classes] of marks)
    for (const node of scene().querySelectorAll(selector)) node.classList.add(...classes);
  for (const button of scene().querySelectorAll<HTMLButtonElement>('[data-answer]')) {
    if (state.solved) button.setAttribute('aria-disabled', 'true');
    const answer = button.dataset.answer;
    if (answer && answer === state.choice)
      button.dataset.result = state.result === 'correct' ? 'correct' : 'retry';
  }
}

function renderStage(): void {
  const round = currentRound(lesson, state);
  stage.dataset.learningRound = round.id;
  stage.dataset.learningKind = round.kind;
  prompt.innerHTML = state.phase === 'bonus-offer' ? spokenHtml('Bonus round!') : spokenHtml(round.prompt);
  renderScene();
}

function updateControls(): void {
  const round = currentRound(lesson, state);
  const inRound = state.phase === 'round';
  intro.hidden = state.phase !== 'intro';
  stage.hidden = state.phase === 'intro' || state.phase === 'done';
  end.hidden = state.phase !== 'done';
  nextButton.hidden = !(inRound && state.solved);
  bonusPlay.hidden = bonusSkip.hidden = state.phase !== 'bonus-offer';
  hintButton.hidden = !inRound || state.solved;
  hintButton.disabled = false;
  if (matchButton) {
    matchButton.hidden =
      !inRound || state.solved || round.kind === 'choose' || !lesson.tools.includes('match');
    matchButton.disabled = false;
  }
  replay.disabled = state.phase === 'intro';
}

// ── the celebration: plank drops in, Pip rolls onto it, then hops ─────────────────────────────────────────

function celebrate(builtBefore: number): void {
  const built = planksBuilt(lesson, state.index, state.solved);
  const pip = scene().querySelector<SVGGElement>('[data-pip]');
  const hop = () => mark('[data-pip]', 'is-happy');
  if (!pip || built <= builtBefore) {
    hop();
    return;
  }
  scene()
    .querySelector(`[data-plank="${built - 1}"]`)
    ?.classList.add('is-new');
  const layout = sceneLayout(currentRound(lesson, state), orientation, planks);
  const dx = layout.pipAt(builtBefore).x - layout.pipAt(built).x;
  pip.style.transition = 'none';
  pip.style.transform = `translateX(${dx}px)`;
  void pip.getBoundingClientRect();
  pip.style.transition = '';
  requestAnimationFrame(() => {
    pip.style.transform = '';
  });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    hop();
  };
  pip.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 1000);
}

// ── events ────────────────────────────────────────────────────────────────────────────────────────────────

function applyShow(show: Show, event: LessonEvent): void {
  const round = currentRound(lesson, state);
  if (event.type === 'answer' && state.result === 'try-again') {
    unmark('is-retry');
    mark(`[data-choice-mark="${event.choice}"]`, 'is-retry');
    for (const button of scene().querySelectorAll<HTMLButtonElement>('[data-answer]'))
      if (button.dataset.answer === event.choice) button.dataset.result = 'retry';
      else delete button.dataset.result;
  }
  switch (show) {
    case 'pulse':
    case 'retry':
      flash('[data-choice-mark]', 'is-pulse');
      break;
    case 'match':
      unmark('is-shown');
      unmark('is-leftover');
      break;
    case 'worked':
      unmark('is-lit');
      mark(`[data-choice-mark="${round.answer}"]`, 'is-glow');
      break;
    default:
      break;
  }
}

function dispatch(event: LessonEvent): void {
  const before = state;
  const result = step(lesson, state, event);
  if (result.state === before) return; // ignored: e.g. a tap on a locked (solved) round
  state = result.state;
  const moved = before.index !== state.index || before.phase !== state.phase;
  if (moved) marks.clear();
  updateControls();

  if (state.phase === 'done') {
    const pip = end.querySelector('[data-pip]');
    pip?.classList.remove('is-happy');
    void pip?.getBoundingClientRect();
    pip?.classList.add('is-happy');
    say(result.say);
    element('#end-heading').focus({ preventScroll: true });
    end.scrollIntoView({ block: 'nearest' });
    return;
  }

  if (moved) renderStage();
  if (result.show === 'celebrate') {
    unmark('is-retry');
    unmark('is-glow');
    for (const button of scene().querySelectorAll<HTMLButtonElement>('[data-answer]'))
      delete button.dataset.result;
    mark(`[data-choice-mark="${state.choice}"]`, 'is-correct');
    const builtBefore = planksBuilt(lesson, state.index, false);
    renderScene();
    celebrate(builtBefore);
  } else applyShow(result.show, event);

  setFeedback(result.say, state.result === 'correct');
  say(result.say);

  if (result.show === 'celebrate') {
    nextButton.focus({ preventScroll: true });
    nextButton.scrollIntoView({ block: 'nearest' });
  } else if (state.phase === 'bonus-offer') {
    bonusPlay.focus({ preventScroll: true });
    bonusSkip.scrollIntoView({ block: 'nearest' });
  } else if (moved) {
    prompt.focus({ preventScroll: true });
    element('.prompt-row').scrollIntoView({ block: 'nearest' });
  }
}

// Answer buttons are re-rendered with the scene: listen on the stage.
stage.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-answer]');
  const choice = button?.dataset.answer;
  if (!button || !choice || button.disabled || state.solved) return;
  dispatch({ type: 'answer', choice });
});
pipStart.addEventListener('click', () => {
  voice.unlock();
  dispatch({ type: 'start' });
});
replay.addEventListener('click', () => say([promptLineId()]));
hintButton.addEventListener('click', () => dispatch({ type: 'hint' }));
matchButton?.addEventListener('click', () => dispatch({ type: 'match' }));
nextButton.addEventListener('click', () => dispatch({ type: 'next' }));
bonusPlay.addEventListener('click', () => dispatch({ type: 'bonus', accept: true }));
bonusSkip.addEventListener('click', () => dispatch({ type: 'bonus', accept: false }));
element('#again').addEventListener('click', () => {
  voice.stop();
  state = initialState(lesson);
  marks.clear();
  feedback.textContent = '';
  renderStage();
  dispatch({ type: 'start' });
});

// ── mute (remembered) ─────────────────────────────────────────────────────────────────────────────────────

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
function showMuted(): void {
  mute.setAttribute('aria-pressed', String(muted));
  mute.classList.toggle('is-muted', muted);
}
mute.addEventListener('click', () => {
  muted = !muted;
  showMuted();
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // storage unavailable: the toggle still works for this visit
  }
  // silence the line now; the rest of the sequence (and its cues) carries on without sound
  if (muted && playing.index >= 0) {
    const rest = playing.lines.slice(playing.index);
    playing.lines = rest;
    void voice.play(rest);
  }
});

// ── layout: tall scenes on narrow screens ─────────────────────────────────────────────────────────────────

narrow.addEventListener('change', () => {
  orientation = narrow.matches ? 'tall' : 'wide';
  if (state.phase === 'round' || state.phase === 'bonus-offer') renderScene();
});

window.addEventListener('resize', fitScene);
void document.fonts.ready.then(fitScene);
window.addEventListener('pagehide', () => voice.stop());

// ready: enable the controls and show the intro
showMuted();
mute.disabled = false;
pipStart.disabled = false;
renderStage();
updateControls();
