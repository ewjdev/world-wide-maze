/**
 * Enhances a generated lesson page: the shared state machine (`step`) decides what happens, Pip's voice plays
 * the lines it returns, and word cues light gems, draw match lines and pulse the choices Pip names on the
 * trusted scene SVG.
 *
 * Phase 22: each play-through shuffles answer positions from its own seed, and each round invites a way to
 * answer (tap, a letter or number key, the arrows) with gentle nudges, unless a grown-up chose tapping only.
 *
 * Phase 31 M2: the lesson is played as `expandActivity` draws it (fresh examples after the written rounds), for
 * the child playing. With two or more children on this device, a picture-only picker asks who's playing first;
 * with one, that child is chosen silently; with none (or no IndexedDB) nothing is saved and nothing changes.
 * Each solved round then adds one evidence event to this device's store.
 */
import '@fontsource-variable/figtree';
import '@fontsource-variable/unbounded';
import '@wwm/learning/scene.css';
import './style.css';
import {
  type Activity,
  type Cue,
  choiceKeys,
  choicesInOrder,
  createVoicePlayer,
  currentRound,
  DEFAULT_AUDIO_BASE,
  type DeviceInputs,
  expandActivity,
  type InputMode,
  type InputPolicy,
  initialState,
  inputPolicy,
  judgeInput,
  keyToChoice,
  type LessonEvent,
  type LessonState,
  learningScript,
  lineId,
  nudgeLine,
  type Orientation,
  type Profile,
  pairUp,
  type Round,
  type RoundOrigin,
  randomSeed,
  readLearningDocument,
  requiredRounds,
  roundEvidence,
  type ScriptLine,
  type Show,
  sceneLayout,
  scriptIndex,
  sessionScript,
  step,
  withPractice,
} from '@wwm/learning';
import { syncNow } from './account-sync.ts';
import { holdToActivate } from './hold.ts';
import {
  avatarSvg,
  type DeviceProgress,
  openProgress,
  pickedThisVisit,
  rememberPick,
  speakNickname,
} from './profiles.ts';
import {
  bridgeSvg,
  escapeHtml,
  gameLevelText,
  inputHintHtml,
  planksBuilt,
  practiceHtml,
  sceneBlock,
  spokenHtml,
} from './render.ts';
import { element, readFamily } from './storage.ts';

const MUTE_KEY = 'wwm-learning.muted';
const KEYBOARD_KEY = 'wwm-learning.keyboard';
/** How long a named choice stays lit while Pip says it. */
const CALLOUT_MS = 600;
const NUDGE_MS = 900;

const baseline = readLearningDocument(document);
const current = readFamily(baseline);
const path = current.path;
const article = element('[data-learning-activity]');
const activityId = article.dataset.learningActivity;
const found = path.activities.find((candidate) => candidate.id === activityId);
if (!found) throw new Error('Activity not found in the learning document.');
/** The lesson as written; `lesson` is the play-through as drawn (fresh examples included). */
const written: Activity = found;
let lesson: Activity = written;
/** Where each round of `lesson` came from: what its evidence says. */
let origins = new Map<string, RoundOrigin>();
element('#wwm-learning').outerHTML = learningScript(path);
element('[data-learning-field="introduction"]').textContent = written.introduction;
element('#lesson-version').textContent =
  current.warning ??
  (current.fork ? 'Your family version · saved in this browser' : 'Original learning path');
element('#game-level').textContent = [current.settingsWarning, gameLevelText(path, lesson)]
  .filter(Boolean)
  .join(' ');

const allLines = scriptIndex(path);
let planks = requiredRounds(lesson);
const narrow = window.matchMedia('(max-width: 640px)');
let orientation: Orientation = narrow.matches ? 'tall' : 'wide';

/** `?seed=` replays a play-through exactly (0 shows the rounds as written); otherwise every visit is new. */
function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const seed = Number(raw);
  return seed <= 0xffffffff ? seed : null;
}
function newPlayThrough(seed: number): LessonState {
  article.dataset.seed = String(seed);
  return initialState(lesson, { seed, shuffle: path.play?.shuffle ?? 'positions' });
}
let state: LessonState = newPlayThrough(seedFromUrl() ?? randomSeed());

// ── who's playing (Phase 31 M2) ─────────────────────────────────────────────────────────────────────────

/** This device's store and profiles; null when this browser can't keep progress (nothing is then saved). */
let progress: DeviceProgress | null = null;
/** The child playing, or null: no profile means no evidence. */
let player: Profile | null = null;
/** When the current round started (for the evidence's duration bucket). */
let roundStartedAt = 0;

/**
 * Draw the play-through for this seed and child: their unseen fresh examples, after the written rounds. If the
 * draw can't run (no Web Crypto outside a secure context), the written rounds play and no evidence is recorded.
 */
async function prepare(seed: number): Promise<void> {
  let seen: ReadonlySet<string> = new Set();
  if (progress && player) seen = await progress.store.seenItems(player.id).catch(() => new Set<string>());
  try {
    const expanded = await expandActivity(path, written, { seed, seen });
    lesson = expanded.activity;
    origins = expanded.origins;
  } catch {
    lesson = written;
    origins = new Map();
  }
  planks = requiredRounds(lesson);
  state = newPlayThrough(seed);
  marks.clear();
  enterRound();
  element('.end-bridge').innerHTML = bridgeSvg(path.theme, lesson);
}

/** One evidence event for the round just solved, if a child is playing. Never blocks or breaks play. */
function record(mode: InputMode): void {
  if (!progress || !player) return;
  const round = lesson.rounds[state.index];
  const origin = round ? origins.get(round.id) : undefined;
  if (!origin) return;
  try {
    const event = roundEvidence({
      profile: player.id,
      activity: lesson,
      state,
      origin,
      surface: 'lesson',
      input: mode,
      durationMs: performance.now() - roundStartedAt,
    });
    void progress.store.appendEvidence(event).catch(() => {});
  } catch {
    // an event that can't be made is skipped; the lesson carries on
  }
}
/** This moment's lines: the current round as shown (count lines and callouts follow the shuffle). */
let script = sessionScript(allLines, lesson, state);
let muted = readMuted();

const intro = element('#intro');
const stage = element('#stage');
const end = element('#end');
const prompt = element('#prompt');
const inputHint = element('#input-hint');
const feedback = element('#feedback');
const nextButton = element<HTMLButtonElement>('#next');
const hintButton = element<HTMLButtonElement>('#hint');
const matchButton = document.querySelector<HTMLButtonElement>('#match');
const bonusPlay = element<HTMLButtonElement>('#bonus-play');
const bonusSkip = element<HTMLButtonElement>('#bonus-skip');
const replay = element<HTMLButtonElement>('#replay');
const mute = element<HTMLButtonElement>('#mute');
const pipStart = element<HTMLButtonElement>('#pip-start');

// ── how the child may answer ──────────────────────────────────────────────────────────────────────────────

const finePointer = window.matchMedia('(any-pointer: fine)');
let keyPressed = readFlag(KEYBOARD_KEY);

/** A keyboard is assumed with a fine pointer, or as soon as any key is pressed this session. */
function device(): DeviceInputs {
  return { tap: true, keyboard: finePointer.matches || keyPressed, tilt: false };
}

let policy: InputPolicy = roundPolicy();
/** Nudges towards the invited input this round (after two, any answer is accepted). */
let nudges = 0;
/** The arrow-key cursor: an index into the choices in on-screen order (-1: none yet). */
let cursor = -1;

function roundPolicy(): InputPolicy {
  return inputPolicy(path, lesson, currentRound(lesson, state), device());
}

/** Key badges are shown while a round invites letter or number keys. */
function shownKeys(): Record<string, string> | undefined {
  return state.phase === 'round' && !state.solved && policy.badges
    ? choiceKeys(currentRound(lesson, state))
    : undefined;
}

function renderInputHint(): void {
  const html =
    state.phase === 'round' && !state.solved
      ? inputHintHtml(
          currentRound(lesson, state),
          policy,
          choiceKeys(currentRound(lesson, state)),
          orientation,
        )
      : '';
  inputHint.innerHTML = html;
  inputHint.hidden = !html;
}

/** A new round (or a new play-through): fresh input policy, nudges and cursor, and the lines as shown. */
function enterRound(): void {
  script = sessionScript(allLines, lesson, state);
  policy = roundPolicy();
  nudges = 0;
  cursor = -1;
}

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

/**
 * A class held for a fixed time (not remembered, and independent of animations, so it still shows with
 * reduced motion). Re-applying restarts it.
 */
const held = new Map<Element, ReturnType<typeof setTimeout>>();
function hold(nodes: Iterable<Element>, className: string, ms: number): void {
  for (const node of nodes) {
    clearTimeout(held.get(node));
    if (node.classList.contains(className)) {
      node.classList.remove(className);
      void node.getBoundingClientRect();
    }
    node.classList.add(className);
    held.set(
      node,
      setTimeout(() => {
        node.classList.remove(className);
        held.delete(node);
      }, ms),
    );
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
  else if (cue.type === 'choice') {
    // Pip names a choice: it pulses, and its key badge grows, while the word is spoken
    const id = CSS.escape(cue.id);
    hold(
      scene().querySelectorAll(`[data-choice-mark="${id}"], [data-key-badge="${id}"]`),
      'is-callout',
      CALLOUT_MS,
    );
  } else for (const selector of leftoverSelectors(currentRound(lesson, state))) mark(selector, 'is-leftover');
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
  onUnavailable: (line) => {
    if (line.language !== 'es-ES') return;
    const status = document.querySelector('#practice-status');
    if (status)
      status.textContent =
        'Spanish audio is unavailable on this device. Read the word together with a Spanish-speaking grown-up. You can still play.';
  },
});

function say(ids: readonly string[]): void {
  const lines = withPractice(ids, lesson, currentRound(lesson, state))
    .map((id) => script.get(id))
    .filter((line): line is ScriptLine => line !== undefined);
  playing.lines = lines;
  playing.index = -1;
  voice.preload(lines);
  void voice.play(lines);
}

/** The input line ("Press the letter!") follows the round's callout whenever Pip opens a round. */
function withInputLine(ids: readonly string[]): string[] {
  if (state.phase !== 'round' || !policy.promptLine) return [...ids];
  const callout = lineId.callout(lesson.id, currentRound(lesson, state).id);
  const at = ids.indexOf(callout);
  return at < 0 ? [...ids] : [...ids.slice(0, at + 1), policy.promptLine, ...ids.slice(at + 1)];
}

// ── what the page shows ───────────────────────────────────────────────────────────────────────────────────

function promptLineId(): string {
  if (state.phase === 'bonus-offer') return lineId.bonus;
  if (state.phase === 'done') return lineId.finale(lesson.id);
  return lineId.prompt(lesson.id, currentRound(lesson, state).id);
}

/**
 * The spoken lines of a step, written out. The prompt is already on screen as the question, and the input
 * line as the "Press A or B" hint under it.
 */
function setFeedback(ids: readonly string[], success: boolean): void {
  const promptId = promptLineId();
  const lines = ids
    .filter((id) => (id !== promptId || state.phase === 'bonus-offer') && id !== policy.promptLine)
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
    Math.max(px(feedbackStyle.minHeight), feedback.getBoundingClientRect().height) +
    px(feedbackStyle.marginTop) +
    px(controls.marginTop) +
    Math.max(px(getComputedStyle(nextButton).minHeight), px(getComputedStyle(hintButton).minHeight)) +
    12;
  document.body.style.setProperty('--chrome', `${Math.ceil(top + below)}px`);
}

function renderScene(): void {
  const round = currentRound(lesson, state);
  const built = planksBuilt(lesson, state.index, state.solved);
  const keys = shownKeys();
  scene().outerHTML = sceneBlock(path.theme, lesson, round, {
    orientation,
    built,
    enabled: true,
    preview: state.phase === 'bonus-offer',
    ...(keys ? { keys } : {}),
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
  stage.dataset.practice = String(!!round.practice);
  prompt.innerHTML = state.phase === 'bonus-offer' ? spokenHtml('Bonus round!') : spokenHtml(round.prompt);
  element('#practice').innerHTML = state.phase === 'bonus-offer' ? '' : practiceHtml(round, true);
  renderInputHint();
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

/** `mode` is how an answer was given (for evidence); a button pressed directly counts as a tap. */
function dispatch(event: LessonEvent, mode: InputMode = 'tap'): void {
  const before = state;
  const result = step(lesson, state, event);
  if (result.state === before) return; // ignored: e.g. a tap on a locked (solved) round
  state = result.state;
  const moved = before.index !== state.index || before.phase !== state.phase;
  if (moved) {
    marks.clear();
    enterRound();
    if (state.phase === 'round') roundStartedAt = performance.now();
  }
  if (event.type === 'answer' && state.solved && !before.solved) record(mode);
  updateControls();

  if (state.phase === 'done') {
    // With a family account, send this lesson's practice now; without one this is a no-op.
    if (progress) void syncNow(progress.store).catch(() => {});
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
    unmark('is-focus');
    for (const button of scene().querySelectorAll<HTMLButtonElement>('[data-answer]'))
      delete button.dataset.result;
    mark(`[data-choice-mark="${state.choice}"]`, 'is-correct');
    const builtBefore = planksBuilt(lesson, state.index, false);
    renderInputHint();
    renderScene();
    celebrate(builtBefore);
  } else applyShow(result.show, event);

  const lines = withInputLine(result.say);
  setFeedback(lines, state.result === 'correct');
  fitScene();
  say(lines);

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

/**
 * Every answer passes the round's input policy. An answer in a way the round doesn't invite (a tap in a
 * letter-key round) gets a nudge instead: Pip says which way to try and the key badges flash. After two
 * nudges the answer is accepted, so no child is ever blocked.
 */
function answer(choice: string, mode: InputMode): void {
  if (state.phase !== 'round' || state.solved) return;
  if (judgeInput(policy, mode, nudges) === 'accept') {
    dispatch({ type: 'answer', choice }, mode);
    return;
  }
  nudges++;
  const ids = [nudgeLine(policy), lineId.callout(lesson.id, currentRound(lesson, state).id)];
  setFeedback(ids, false);
  say(ids);
  hold(scene().querySelectorAll('[data-key-badge]'), 'is-nudge', NUDGE_MS);
  hold([inputHint], 'is-nudge', NUDGE_MS);
}

// Answer buttons are re-rendered with the scene: listen on the stage.
stage.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-answer]');
  const choice = button?.dataset.answer;
  if (!button || !choice || button.disabled || state.solved) return;
  // A button pressed from the keyboard or by assistive technology (no pointer: detail 0) always answers:
  // screen readers and switch users answer with the buttons, never through a nudge.
  if (event.detail === 0) dispatch({ type: 'answer', choice });
  else answer(choice, 'tap');
});

function moveCursor(by: number): void {
  const order = choicesInOrder(currentRound(lesson, state), orientation);
  if (!order.length) return;
  cursor =
    cursor < 0 ? (by > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, cursor + by));
  unmark('is-focus');
  mark(`[data-choice-mark="${CSS.escape(order[cursor] as string)}"]`, 'is-focus');
}

const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (!keyPressed) {
    keyPressed = true;
    writeFlag(KEYBOARD_KEY);
    // a keyboard turned up: this round may now invite keys after all
    if (state.phase === 'round' && !state.solved && !nudges) {
      const next = roundPolicy();
      if (next.badges !== policy.badges || next.promptLine !== policy.promptLine) {
        policy = next;
        renderInputHint();
        renderScene();
      }
    }
  }
  if (state.phase !== 'round' || state.solved) return;
  const target = event.target as Element | null;
  // keys belong to the lesson only while focus is on the page or in the stage (not in the grown-up notes)
  if (target && target !== document.body && target !== document.documentElement && !stage.contains(target))
    return;
  const onControl = !!target?.closest('button, a, input, textarea, select, summary');
  const round = currentRound(lesson, state);
  const move = ARROWS[event.key];
  if (move !== undefined) {
    event.preventDefault();
    moveCursor(move);
    return;
  }
  if (event.key === 'Enter') {
    // a focused button answers or helps by itself; Enter answers the arrow cursor only
    if (onControl || cursor < 0) return;
    event.preventDefault();
    const choice = choicesInOrder(round, orientation)[cursor];
    if (choice) answer(choice, 'arrows');
    return;
  }
  if (event.key.length !== 1 || !policy.badges) return;
  const choice = keyToChoice(round, event.key);
  if (!choice) return;
  event.preventDefault();
  answer(choice, /\d/.test(event.key) ? 'number-key' : 'letter-key');
});

pipStart.addEventListener('click', () => {
  voice.unlock();
  dispatch({ type: 'start' });
});
replay.addEventListener('click', () => {
  if (state.phase !== 'round') {
    say([promptLineId()]);
    return;
  }
  say(withInputLine([promptLineId(), lineId.callout(lesson.id, currentRound(lesson, state).id)]));
});
element('#practice').addEventListener('click', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('#practice-replay')) return;
  voice.unlock();
  say([lineId.practice(lesson.id, currentRound(lesson, state).id)]);
});
hintButton.addEventListener('click', () => dispatch({ type: 'hint' }));
matchButton?.addEventListener('click', () => dispatch({ type: 'match' }));
nextButton.addEventListener('click', () => dispatch({ type: 'next' }));
bonusPlay.addEventListener('click', () => dispatch({ type: 'bonus', accept: true }));
bonusSkip.addEventListener('click', () => dispatch({ type: 'bonus', accept: false }));
element('#again').addEventListener('click', async () => {
  voice.stop();
  // a new play-through: new positions, and fresh examples this child hasn't met yet
  await prepare(randomSeed());
  feedback.textContent = '';
  renderStage();
  dispatch({ type: 'start' });
});

// ── remembered flags (mute, keyboard seen) ────────────────────────────────────────────────────────────────

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
function readFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string): void {
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    // storage unavailable: remembered for this page only
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
  cursor = -1;
  unmark('is-focus');
  if (state.phase === 'round' || state.phase === 'bonus-offer') {
    renderInputHint();
    renderScene();
  }
});

window.addEventListener('resize', fitScene);
void document.fonts.ready.then(fitScene);
window.addEventListener('pagehide', () => voice.stop());

// ── the picker: who's playing, by picture ──────────────────────────────────────────────────────────────

const picker = element('#picker');
const pickerChoices = element('#picker-choices');
const playerBar = element('#player-bar');
const byName = (x: Profile, y: Profile) => x.nickname.localeCompare(y.nickname) || x.id.localeCompare(y.id);

/**
 * Show Pip avatars, big and picture-only, and wait for a tap. Choosing says "Hi, <nickname>!" in the browser's
 * own voice (never the studio voice), remembers the child for this visit, and brings back "Tap Pip to start".
 */
function pick(profiles: readonly Profile[]): Promise<Profile> {
  intro.hidden = true;
  picker.hidden = false;
  pickerChoices.innerHTML = profiles
    .map(
      (profile) =>
        `<button class="picker-choice" type="button" data-pick="${escapeHtml(profile.id)}" aria-label="${escapeHtml(profile.nickname)}">${avatarSvg(path.theme, profile.avatar, 112)}</button>`,
    )
    .join('');
  return new Promise((resolve) => {
    const choose = (event: Event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-pick]');
      const chosen = profiles.find((profile) => profile.id === button?.dataset.pick);
      if (!chosen) return;
      pickerChoices.removeEventListener('click', choose);
      picker.hidden = true;
      intro.hidden = false;
      rememberPick(chosen.id);
      void progress?.store.setActiveProfile(chosen.id).catch(() => {});
      if (!muted) speakNickname(`Hi, ${chosen.nickname}!`);
      resolve(chosen);
    };
    pickerChoices.addEventListener('click', choose);
  });
}

/** The grown-up line under the lesson: who practice is saved for, and (with two or more) the hold-to-switch. */
function showPlayer(profiles: readonly Profile[]): void {
  playerBar.hidden = !player;
  if (!player) return;
  element('#player-status').innerHTML =
    `${avatarSvg(path.theme, player.avatar, 26, 'player-avatar')}<span>Saving practice for <strong>${escapeHtml(player.nickname)}</strong> on this device.</span>`;
  element('#switch-player').hidden = profiles.length < 2;
}

/** Hold to switch: the picker again, then a new play-through for the child chosen. */
function wireSwitch(profiles: readonly Profile[]): void {
  holdToActivate(element<HTMLButtonElement>('#switch-player'), async () => {
    voice.stop();
    state = newPlayThrough(state.seed);
    updateControls();
    feedback.textContent = '';
    picker.scrollIntoView({ block: 'nearest' });
    player = await pick(profiles);
    await prepare(seedFromUrl() ?? randomSeed());
    showPlayer(profiles);
    renderStage();
    updateControls();
    pipStart.focus({ preventScroll: true });
  });
}

/** Who's playing: none (nothing saved), the only child (silently), or the picker for two or more. */
async function choosePlayer(): Promise<{ profiles: Profile[]; picked: boolean }> {
  progress = await openProgress();
  const profiles = [...(progress?.profiles ?? [])].sort(byName);
  if (!progress || !profiles.length) return { profiles: [], picked: false };
  const only = profiles.length === 1 ? profiles[0] : undefined;
  if (only) {
    player = only;
    void progress.store.setActiveProfile(only.id).catch(() => {});
    return { profiles, picked: false };
  }
  // chosen earlier in this visit: no picker on the next lesson
  const active = await progress.store.activeProfile().catch(() => null);
  const picked = pickedThisVisit();
  player = profiles.find((profile) => profile.id === active && profile.id === picked) ?? null;
  if (player) return { profiles, picked: false };
  mute.disabled = false;
  player = await pick(profiles);
  return { profiles, picked: true };
}

// ready: choose who's playing, draw the play-through, then enable the controls and show the intro
showMuted();
void (async () => {
  const { profiles, picked } = await choosePlayer();
  await prepare(state.seed);
  showPlayer(profiles);
  if (profiles.length > 1) wireSwitch(profiles);
  mute.disabled = false;
  pipStart.disabled = false;
  renderStage();
  updateControls();
  if (picked) pipStart.focus({ preventScroll: true });
})();
