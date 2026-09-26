/**
 * Phase 20 M4b (N): the game side of a lesson ("Pip gates"). The game owns the maze, the pause and the timer
 * (game.ts); this owns the lesson: the document, one `LessonState` for the whole session, the gate card's view,
 * the choice cursor (tilt, arrow keys, number keys, tap) and Pip's voice. The rules of a round are `step()` from
 * @wwm/learning, the same state machine the lesson page runs, so a round behaves the same in both places.
 *
 * Falls, time and maze score are never read here: a gate is practice, not assessment (html-contract).
 */
import {
  type Activity,
  type Cue,
  choicesInOrder,
  createVoicePlayer,
  currentRound,
  DEFAULT_AUDIO_BASE,
  initialState,
  type LearningPath,
  type LessonEvent,
  type LessonState,
  lineId,
  type Round,
  requiredRounds,
  type ScriptLine,
  type Show,
  type Step,
  scriptIndex,
  step,
  type VoicePlayer,
} from '@wwm/learning';
import type { StageData } from '@wwm/schema';
import { learningHref } from './href.ts';
import { type LessonErrorKind, LessonLoadError, type LessonSource, type LoadedLesson } from './load.ts';
import { gatePortals, MAX_GATES, placeGates } from './placement.ts';

export type GateMode = 'round' | 'bonus-offer' | 'done';
export type GateOutcome = 'rolled-on' | 'skipped';

export interface GateView {
  /** The stage portal id, or −1 for the stage-start fallback (a stage with no room for a gate). */
  gateId: number;
  /** 1-based gate number (0 for the fallback). */
  number: number;
  mode: GateMode;
  state: LessonState;
  /** The round on the card (its current or just solved round). */
  round: Round;
  /** Choice ids in on-screen order (tilt/arrow order). */
  choices: string[];
  /** Index into `choices`, or null before the child moved. */
  cursor: number | null;
  /** The last step's effect and a counter that changes with every step (so the same effect replays). */
  show: Show;
  seq: number;
}

export interface LessonSummary {
  title: string;
  activityId: string;
  source: LessonSource;
  /** Gates to place per stage. */
  gates: number;
}

export interface LearningView {
  lesson: LessonSummary | null;
  loading: boolean;
  error: { kind: LessonErrorKind; message: string } | null;
  gate: GateView | null;
  /** Rounds solved this session (Pip's bridge). */
  built: number;
  /** The script line Pip is saying (null when quiet). */
  speaking: string | null;
}

// ── pure glue (unit-tested) ─────────────────────────────────────────────────────────────────────────────

/**
 * Gates per stage: every round on the main path plus the trick follow-ups that may be inserted (so a helped
 * trick round doesn't push the last main round off the stage), capped at MAX_GATES. Extra gates offer the bonus.
 */
export function gatesFor(activity: Activity): number {
  const followUps = activity.rounds.filter((round) => round.onlyAfterHelpOn && !round.optional).length;
  return Math.min(MAX_GATES, requiredRounds(activity) + followUps);
}

/**
 * What opening a gate does to the session: the first gate starts the lesson (Pip introduces it), a gate after a
 * solved round moves on (to the next round, the bonus offer or the finale), an unsolved round is asked again, and
 * after the last round a gate just lets the ball roll on.
 */
export function openStep(activity: Activity, state: LessonState): Step {
  switch (state.phase) {
    case 'intro': {
      const s = step(activity, state, { type: 'start' });
      return { ...s, say: [lineId.gate, ...s.say] };
    }
    case 'round':
      if (state.solved) return step(activity, state, { type: 'next' });
      return { state, say: [lineId.prompt(activity.id, currentRound(activity, state).id)], show: null };
    case 'bonus-offer':
      return { state, say: [lineId.bonus], show: null };
    case 'done':
      return { state, say: [lineId.rollOn], show: null };
  }
}

export function gateMode(state: LessonState): GateMode {
  return state.phase === 'bonus-offer' ? 'bonus-offer' : state.phase === 'done' ? 'done' : 'round';
}

/** Move the cursor one choice left (−1) or right (+1); the first move picks the leftmost / rightmost choice. */
export function moveCursor(cursor: number | null, dir: -1 | 1, count: number): number | null {
  if (count <= 0) return null;
  if (cursor === null) return dir < 0 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, cursor + dir));
}

/** Number keys: a difference round's numbers mean themselves; otherwise 1–3 are the choices left to right. */
export function choiceForDigit(round: Round, choices: readonly string[], digit: number): string | null {
  if (round.kind === 'difference') return choices.includes(String(digit)) ? String(digit) : null;
  return choices[digit - 1] ?? null;
}

/**
 * Tilt → cursor steps, with hysteresis and a repeat delay: tipping past ENGAGE moves once; holding it repeats
 * after REPEAT_FIRST_MS, then every REPEAT_MS; the tilt has to come back inside RELEASE before a new tip counts.
 */
export class TiltStepper {
  static readonly ENGAGE = 0.45;
  static readonly RELEASE = 0.25;
  static readonly REPEAT_FIRST_MS = 900;
  static readonly REPEAT_MS = 650;
  #held: -1 | 0 | 1 = 0;
  #nextAt = 0;

  /** `x`: roll normalized to ±1 (+ = right). Returns the step to take now. */
  update(x: number, now: number): -1 | 0 | 1 {
    const dir: -1 | 1 = x < 0 ? -1 : 1;
    if (this.#held !== 0) {
      if (Math.abs(x) < TiltStepper.RELEASE || dir !== this.#held) {
        this.#held = 0;
      } else if (now >= this.#nextAt) {
        this.#nextAt = now + TiltStepper.REPEAT_MS;
        return this.#held;
      } else return 0;
    }
    if (Math.abs(x) > TiltStepper.ENGAGE) {
      this.#held = dir;
      this.#nextAt = now + TiltStepper.REPEAT_FIRST_MS;
      return dir;
    }
    return 0;
  }

  reset(): void {
    this.#held = 0;
  }
}

// ── the session ───────────────────────────────────────────────────────────────────────────────────────────

export interface LearningGatesOptions {
  /** The game's mute (Pip goes quiet with it; cues keep running on estimated timing). */
  muted: () => boolean;
  /** The card closed: the game resumes play (and marks the gate used). */
  onClose: (gateId: number, outcome: GateOutcome) => void;
  /** Tests: a voice player stand-in. */
  voice?: (path: LearningPath, events: { onCue: (cue: Cue, line: ScriptLine) => void }) => VoicePlayer;
}

/** JUMP only confirms once it was released after the card opened, and not in the first moment. */
const JUMP_GUARD_MS = 350;

export class LearningGates {
  readonly #opts: LearningGatesOptions;
  readonly #listeners = new Set<() => void>();
  readonly #cueListeners = new Set<(cue: Cue, line: ScriptLine) => void>();
  #view: LearningView = { lesson: null, loading: false, error: null, gate: null, built: 0, speaking: null };
  #lesson: LoadedLesson | null = null;
  #state: LessonState | null = null;
  #lines = new Map<string, ScriptLine>();
  #voice: VoicePlayer | null = null;
  #unlocked = false;
  #tilt = new TiltStepper();
  #prevJump = true;
  #openedAt = 0;
  #loadToken = 0;
  /** Engine label for gate n (the UI sets a translated one). */
  label: (n: number) => string = (n) => `Pip gate ${n}`;

  constructor(opts: LearningGatesOptions) {
    this.#opts = opts;
  }

  // ── store ──

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };
  getView = (): LearningView => this.#view;

  #set(p: Partial<LearningView>): void {
    this.#view = { ...this.#view, ...p };
    for (const l of this.#listeners) l();
  }

  /** The card listens for voice cues (a spoken number lights a gem, a spoken "match" draws a line). */
  onCue(fn: (cue: Cue, line: ScriptLine) => void): () => void {
    this.#cueListeners.add(fn);
    return () => this.#cueListeners.delete(fn);
  }

  get active(): boolean {
    return this.#lesson !== null;
  }
  get isOpen(): boolean {
    return this.#view.gate !== null;
  }
  get lesson(): LoadedLesson | null {
    return this.#lesson;
  }

  // ── loading ──

  use(lesson: LoadedLesson): void {
    this.abort();
    this.#voice?.stop();
    this.#loadToken++;
    this.#lesson = lesson;
    this.#state = initialState(lesson.activity);
    this.#lines = scriptIndex(lesson.path);
    const onCue = (cue: Cue, line: ScriptLine) => {
      for (const fn of this.#cueListeners) fn(cue, line);
    };
    this.#voice =
      this.#opts.voice?.(lesson.path, { onCue }) ??
      createVoicePlayer({
        clips: lesson.path.voice?.clips ?? [],
        audioBase: DEFAULT_AUDIO_BASE,
        muted: this.#opts.muted,
        onCue,
        onLine: (line) => {
          if (this.#view.speaking !== (line?.id ?? null)) this.#set({ speaking: line?.id ?? null });
        },
      });
    this.#unlocked = false;
    this.#set({
      lesson: {
        title: lesson.activity.title,
        activityId: lesson.activity.id,
        source: lesson.source,
        gates: gatesFor(lesson.activity),
      },
      loading: false,
      error: null,
      built: 0,
      speaking: null,
    });
  }

  /** Load from an async source (a picked file); a newer load or a clear wins over a slow one. */
  async load(get: () => Promise<LoadedLesson>): Promise<boolean> {
    const token = ++this.#loadToken;
    this.#set({ loading: true, error: null });
    try {
      const lesson = await get();
      if (token !== this.#loadToken) return false;
      this.use(lesson);
      return true;
    } catch (err) {
      if (token !== this.#loadToken) return false;
      this.fail(err);
      return false;
    }
  }

  fail(err: unknown): void {
    const e =
      err instanceof LessonLoadError
        ? { kind: err.kind, message: err.message }
        : { kind: 'invalid' as const, message: err instanceof Error ? err.message : String(err) };
    console.warn('[wwm] learning page not loaded:', e.message);
    this.#set({ loading: false, error: e });
  }

  dismissError(): void {
    if (this.#view.error) this.#set({ error: null });
  }

  clear(): void {
    this.abort();
    this.#voice?.stop();
    this.#loadToken++;
    this.#lesson = null;
    this.#state = null;
    this.#voice = null;
    this.#set({ lesson: null, loading: false, error: null, built: 0, speaking: null });
  }

  /** A new game starts the lesson from the beginning (the state otherwise lasts across stages and retries). */
  resetProgress(): void {
    if (!this.#lesson) return;
    this.#state = initialState(this.#lesson.activity);
    this.#set({ built: 0 });
  }

  /** Call on a user gesture: lets Pip's clips play later without one (once per voice player). */
  unlock(): void {
    if (this.#unlocked || !this.#voice) return;
    this.#unlocked = true;
    this.#voice.unlock();
  }

  // ── the maze ──

  /** The stage with its link portals replaced by this lesson's Pip gates (unchanged without a lesson). */
  decorate(stage: StageData): StageData {
    const lesson = this.#lesson;
    if (!lesson) return stage;
    const spots = placeGates(stage, gatesFor(lesson.activity));
    const color = lesson.path.theme.palette.gate;
    return {
      ...stage,
      portals: gatePortals(spots, (n) => learningHref(lesson.activity.id, n, color), this.label),
    };
  }

  // ── the card ──

  /** The ball rolled into gate `number` (portal `gateId`); −1/0 = the stage-start fallback. */
  open(gateId: number, number: number, now = performance.now()): void {
    const lesson = this.#lesson;
    const state = this.#state;
    if (!lesson || !state || this.#view.gate) return;
    this.#openedAt = now;
    this.#prevJump = true;
    this.#tilt.reset();
    this.#apply(openStep(lesson.activity, state), { gateId, number, cursor: null });
  }

  #apply(s: Step, gate: Partial<GateView> = {}): void {
    const lesson = this.#lesson;
    if (!lesson) return;
    const prev = this.#view.gate;
    this.#state = s.state;
    const round = currentRound(lesson.activity, s.state);
    const sameRound = prev?.round.id === round.id;
    const view: GateView = {
      gateId: gate.gateId ?? prev?.gateId ?? -1,
      number: gate.number ?? prev?.number ?? 0,
      mode: gateMode(s.state),
      state: s.state,
      round,
      choices: choicesInOrder(round),
      cursor: gate.cursor !== undefined ? gate.cursor : sameRound ? (prev?.cursor ?? null) : null,
      show: s.show,
      seq: (prev?.seq ?? 0) + 1,
    };
    this.#set({ gate: view, built: s.state.built });
    this.#say(s.say);
  }

  #say(ids: readonly string[]): void {
    const lines = ids.map((id) => this.#lines.get(id)).filter((l): l is ScriptLine => !!l);
    if (lines.length > 0) void this.#voice?.play(lines);
  }

  #dispatch(event: LessonEvent): boolean {
    const lesson = this.#lesson;
    const state = this.#state;
    if (!lesson || !state || !this.#view.gate) return false;
    const s = step(lesson.activity, state, event);
    if (s.state === state && s.say.length === 0 && s.show === null) return false;
    this.#apply(s);
    return true;
  }

  answer(choice: string): void {
    const gate = this.#view.gate;
    if (gate?.mode !== 'round' || gate.state.solved || !gate.choices.includes(choice)) return;
    const cursor = gate.choices.indexOf(choice);
    if (gate.cursor !== cursor) this.#set({ gate: { ...gate, cursor } });
    this.#dispatch({ type: 'answer', choice });
  }

  hint(): void {
    this.#dispatch({ type: 'hint' });
  }

  match(): void {
    this.#dispatch({ type: 'match' });
  }

  bonus(accept: boolean): void {
    this.#dispatch({ type: 'bonus', accept });
  }

  move(dir: -1 | 1): void {
    const gate = this.#view.gate;
    if (gate?.mode !== 'round' || gate.state.solved) return;
    const cursor = moveCursor(gate.cursor, dir, gate.choices.length);
    if (cursor !== gate.cursor) this.#set({ gate: { ...gate, cursor } });
  }

  /** JUMP / Enter: answer with the cursor, roll on after a success, take the bonus when offered. */
  confirm(): void {
    const gate = this.#view.gate;
    if (!gate) return;
    if (gate.mode === 'bonus-offer') this.bonus(true);
    else if (gate.mode === 'done' || gate.state.solved) this.rollOn();
    else this.#answerCursor(gate);
  }

  #answerCursor(gate: GateView): void {
    const choice = gate.cursor === null ? null : gate.choices[gate.cursor];
    if (choice) this.answer(choice);
    else this.replay(); // nothing chosen yet: ask again ("which island…?")
  }

  /** Pip says the question (or the success, the offer, the finale) again. */
  replay(): void {
    const lesson = this.#lesson;
    const gate = this.#view.gate;
    if (!lesson || !gate) return;
    const a = lesson.activity.id;
    if (gate.mode === 'bonus-offer') this.#say([lineId.bonus]);
    else if (gate.mode === 'done') this.#say([lineId.finale(a)]);
    else if (gate.state.solved) this.#say([lineId.success(a, gate.round.id)]);
    else this.#say([lineId.prompt(a, gate.round.id)]);
  }

  /** "Roll on!": the card closes and play resumes; Pip's line carries over into the maze. */
  rollOn(): void {
    const gate = this.#view.gate;
    if (!gate || (gate.mode === 'round' && !gate.state.solved)) return;
    this.#say([lineId.rollOn]);
    this.#close(gate.gateId, 'rolled-on');
  }

  /** "Skip gate": optional, never a penalty; the lesson waits at the same round for the next gate. */
  skip(): void {
    const gate = this.#view.gate;
    if (!gate) return;
    this.#voice?.stop();
    this.#close(gate.gateId, 'skipped');
  }

  /** The game left the stage while the card was open (no resume). */
  abort(): void {
    if (!this.#view.gate) return;
    this.#voice?.stop();
    this.#set({ gate: null });
  }

  #close(gateId: number, outcome: GateOutcome): void {
    this.#set({ gate: null });
    this.#opts.onClose(gateId, outcome);
  }

  // ── input ──

  /**
   * Per frame while the card is open: phone or gamepad tilt moves the cursor, JUMP (pressed after a release)
   * confirms. The keyboard's arrows and Space arrive as key events instead (`key`), so they don't count twice.
   */
  input(x: number, jump: boolean, source: 'phone' | 'keyboard' | 'gamepad' | 'none', now: number): void {
    if (!this.#view.gate) return;
    const analog = source === 'phone' || source === 'gamepad';
    const dir = analog ? this.#tilt.update(x, now) : 0;
    if (dir !== 0) this.move(dir);
    const press = analog && jump && !this.#prevJump && now - this.#openedAt > JUMP_GUARD_MS;
    this.#prevJump = analog ? jump : true;
    if (press) this.confirm();
  }

  /** Window keydown while the card is open; true when handled. */
  key(ev: KeyboardEvent): boolean {
    const gate = this.#view.gate;
    if (!gate) return false;
    // a focused card button handles its own Enter / Space (its click)
    const target = ev.target as HTMLElement | null;
    const onControl =
      !!target && typeof target.closest === 'function' && !!target.closest('button, input, a');
    switch (ev.code) {
      case 'ArrowLeft':
      case 'ArrowRight':
        ev.preventDefault();
        this.move(ev.code === 'ArrowLeft' ? -1 : 1);
        return true;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        if (onControl || ev.repeat) return true;
        ev.preventDefault();
        this.confirm();
        return true;
      case 'KeyH':
        if (ev.repeat) return true;
        this.hint();
        return true;
      case 'KeyN':
      case 'Backspace':
        if (ev.repeat) return true;
        ev.preventDefault();
        if (gate.mode === 'bonus-offer') this.bonus(false);
        else this.skip();
        return true;
      case 'ArrowUp':
      case 'ArrowDown':
        ev.preventDefault();
        return true;
    }
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(ev.code);
    if (digit && gate.mode === 'round' && !ev.repeat) {
      const choice = choiceForDigit(gate.round, gate.choices, Number(digit[1]));
      if (choice) this.answer(choice);
      return true;
    }
    return false;
  }

  /** e2e: what the card shows. */
  debug() {
    const g = this.#view.gate;
    return {
      active: this.active,
      activityId: this.#lesson?.activity.id ?? null,
      phase: this.#state?.phase ?? null,
      index: this.#state?.index ?? null,
      built: this.#state?.built ?? 0,
      gate: g
        ? {
            gateId: g.gateId,
            number: g.number,
            mode: g.mode,
            round: g.round.id,
            cursor: g.cursor,
            solved: g.state.solved,
          }
        : null,
    };
  }
}
