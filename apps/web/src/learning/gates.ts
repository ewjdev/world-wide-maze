/**
 * Phase 20 M4b + Phase 22 M3 (N): the game side of a lesson. The game owns the maze, the pause and the timer
 * (game.ts); this owns the lesson: the document and its level, one `LessonState` for the whole session (seeded,
 * so answer positions are shuffled per play-through), the binding of the level's steps to each stage (locks.ts),
 * the gate card's view, missions, what a closed lock says, the choice cursor and input policy, and Pip's voice.
 * The rules of a round are `step()` from @wwm/learning, the same state machine the lesson page runs.
 *
 * Falls, time and maze score are never read here: a gate is practice, not assessment (html-contract). A lock is
 * never a punishment (plan Principle 3): it costs nothing, it explains itself, and a grown-up may open it.
 */
import {
  type Activity,
  type Cue,
  choicesInOrder,
  createVoicePlayer,
  currentRound,
  DEFAULT_AUDIO_BASE,
  type DeviceInputs,
  followUpAfter,
  type InputMode,
  type InputPolicy,
  initialState,
  inputPolicy,
  judgeInput,
  keyToChoice,
  type LearningPath,
  type LessonEvent,
  type LessonState,
  type Level,
  levelPlan,
  lineId,
  nudgeLine,
  type PlanStep,
  type ResolvedLocks,
  type Round,
  randomSeed,
  resolveLocks,
  type ScriptLine,
  type Show,
  type Step,
  type StepLock,
  scriptIndex,
  sessionScript,
  step,
  systemLineId,
  type VoicePlayer,
} from '@wwm/learning';
import type { LockSpec, StageData, Vec2 } from '@wwm/schema';
import { learningHref, missionHref } from './href.ts';
import { type LevelSummary, levelSummaries, pickLevel } from './levels.ts';
import { type LessonErrorKind, LessonLoadError, type LessonSource, type LoadedLesson } from './load.ts';
import { allowedIslands, type BoundStep, bindLevel, type LockBinding } from './locks.ts';
import { collectCount, gemsByIsland, islandLetters, type ReachGoal, resolveReach } from './missions.ts';
import { type LockPort, type LockVisual, NO_LOCKS } from './port.ts';

export type GateMode = 'round' | 'bonus-offer' | 'done';
/** `later`: a locking step's card was closed unsolved (its lock stays shut, the gate stays open). */
export type GateOutcome = 'rolled-on' | 'skipped' | 'later';

export interface GateView {
  /** The stage portal id, or −1 for the stage-start fallback (a stage with no room for a gate). */
  gateId: number;
  /** 1-based gate number (0 for the fallback). */
  number: number;
  /** The level step this gate asks (null: the fallback, or after every step is done). */
  stepIndex: number | null;
  /** The step keeps a lock or the finish shut: the card offers "Later", not "Skip". */
  locking: boolean;
  mode: GateMode;
  state: LessonState;
  /** The round on the card, as shown in this session (positions shuffled). */
  round: Round;
  /** Choice ids in on-screen order (tilt/arrow order). */
  choices: string[];
  /** Index into `choices`, or null before the child moved. */
  cursor: number | null;
  /** The last step's effect and a counter that changes with every step (so the same effect replays). */
  show: Show;
  seq: number;
  /** How this round invites an answer on this device. */
  policy: InputPolicy;
  /** Nudges towards the invited input in this round, and a counter for the card's flash. */
  nudges: number;
  nudgeSeq: number;
  /** What happens after a solved round: roll on, a follow-up round, or more (the bonus / the finale). */
  next: 'roll-on' | 'follow-up' | 'more';
}

export interface StepView {
  index: number;
  kind: 'round' | 'mission';
  number: number;
  lock: StepLock;
  done: boolean;
  placed: boolean;
}

export interface MissionView {
  index: number;
  number: number;
  kind: 'collect' | 'reach';
  count: number;
  have: number;
  by: ReachGoal['by'] | null;
  letter: string | null;
}

/** A keyed HUD banner at a closed lock (the `wwm-hud__inst wwm-flash` pattern). */
export interface LockBanner {
  seq: number;
  /** The step that opens the way (the banner goes when it's done). */
  step: number;
  kind: 'gate' | 'collect' | 'post' | 'reach' | 'finish';
  n: number;
  count: number;
  have: number;
}

export interface LessonSummary {
  title: string;
  activityId: string;
  source: LessonSource;
  level: LevelSummary;
  /** Levels the game can play for this lesson (the Grown-ups control). */
  levels: LevelSummary[];
  mode: ResolvedLocks['mode'];
  /** A grown-up may open a lock in this level. */
  override: boolean;
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
  /** The level's steps and their progress (the HUD). */
  steps: StepView[];
  /** The mission in progress. */
  mission: MissionView | null;
  banner: LockBanner | null;
  /** The pause menu may offer the grown-up override now. */
  canOverride: boolean;
}

// ── pure glue (unit-tested) ─────────────────────────────────────────────────────────────────────────────

/**
 * What opening a gate does once the level's steps are all done (or on the stage-start fallback): a solved round
 * moves on (the bonus offer or the finale), an unsolved one is asked again, and after the last round a gate just
 * lets the ball roll on.
 */
export function openStep(activity: Activity, state: LessonState): Step {
  switch (state.phase) {
    case 'intro': {
      const s = step(activity, state, { type: 'start' });
      return { ...s, say: [lineId.gate, ...s.say] };
    }
    case 'round':
      if (state.solved) return finishStep(activity, state);
      return { state, say: [lineId.prompt(activity.id, currentRound(activity, state).id)], show: null };
    case 'bonus-offer':
      return { state, say: [lineId.bonus], show: null };
    case 'done':
      return { state, say: [lineId.rollOn], show: null };
  }
}

/**
 * After the last step: the bonus offer (or the next bonus round), else the finale. A required round the level left
 * out is never asked here.
 */
export function finishStep(activity: Activity, state: LessonState): Step {
  const s = step(activity, state, { type: 'next' });
  if (s.state.phase === 'round' && !currentRound(activity, s.state).optional)
    return { state: { ...state, phase: 'done' }, say: [lineId.finale(activity.id)], show: 'celebrate' };
  return s;
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

/** The line Pip says at a closed lock (plan §5 "Messages at the lock"). */
export function lockedLine(
  lock: Pick<LockSpec, 'kind'>,
  owner: Pick<BoundStep, 'step' | 'number'>,
  collectTarget: number,
): string {
  if (lock.kind === 'goal') return systemLineId.lockedGoal;
  if (lock.kind === 'elevator') return systemLineId.lockedLift;
  if (owner.step.kind === 'round') return systemLineId.lockedGate(Math.min(8, Math.max(1, owner.number)));
  if (owner.step.mission.kind === 'collect')
    return systemLineId.lockedCollect(Math.min(10, Math.max(1, collectTarget)));
  return systemLineId.lockedReach;
}

/** Tilt → cursor steps, with hysteresis and a repeat delay (Phase 20). */
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
  /** The card closed: the game resumes play (and marks the gate used unless `later`). */
  onClose: (gateId: number, outcome: GateOutcome) => void;
  /** Physics and engine calls for runtime locks (default: none). */
  locks?: LockPort;
  /** The session seed for shuffled answer positions (default `randomSeed()`; 0 = as written). */
  seed?: () => number;
  /** What the device can do besides tapping (keyboard play, a paired phone). */
  device?: () => { keyboard: boolean; tilt: boolean };
  /** Clock for rate limits (ms). */
  now?: () => number;
  /** Tests: a voice player stand-in. */
  voice?: (path: LearningPath, events: { onCue: (cue: Cue, line: ScriptLine) => void }) => VoicePlayer;
}

/** Labels the maze shows (the UI sets translated ones). */
export interface LearningLabels {
  gate: (n: number) => string;
  /** A mission post's portal label. */
  post: (mission: PlanStep & { kind: 'mission' }, count: number) => string;
  /** A lock's card: what opens it. */
  lock: (owner: BoundStep | null) => string;
}

/** JUMP only confirms once it was released after the card opened, and not in the first moment. */
const JUMP_GUARD_MS = 350;
/** Pip explains a lock at most this often. */
export const LOCKED_LINE_MS = 8000;
/** Pip's "Oops! Pip's gate first." at most this often (a child may hop again and again). */
export const GUARD_LINE_MS = 4000;
/** A lock banner shows for about 4.5 s (learning.css); the same one isn't restarted sooner than this. */
export const BANNER_REPEAT_MS = 4000;
const BEACON_MS = 12_000;

interface MissionRun {
  status: 'active' | 'done';
  asked: number;
  count: number;
  lowered: boolean;
  have: number;
  goal: ReachGoal | null;
  postIsland: number;
}

interface StageRun {
  stage: StageData;
  binding: LockBinding;
  /** portal id → bound step */
  portals: Map<number, BoundStep>;
  letters: Map<number, string>;
}

const DEFAULT_LABELS: LearningLabels = {
  gate: (n) => `Pip gate ${n}`,
  post: (mission, count) =>
    mission.mission.kind === 'collect'
      ? `Mission: ${count} ${count === 1 ? 'gem' : 'gems'}`
      : typeof mission.mission.island === 'object'
        ? `Mission: island ${mission.mission.island.letter}`
        : mission.mission.island === 'most-gems'
          ? 'Mission: most gems'
          : 'Mission: fewest gems',
  lock: (owner) =>
    !owner
      ? 'Finish'
      : owner.step.kind === 'round'
        ? `Pip gate ${owner.number}`
        : owner.step.mission.kind === 'collect'
          ? `${owner.step.mission.count} gems`
          : 'Mission',
};

export class LearningGates {
  readonly #opts: LearningGatesOptions;
  readonly #listeners = new Set<() => void>();
  readonly #cueListeners = new Set<(cue: Cue, line: ScriptLine) => void>();
  #view: LearningView = {
    lesson: null,
    loading: false,
    error: null,
    gate: null,
    built: 0,
    speaking: null,
    steps: [],
    mission: null,
    banner: null,
    canOverride: false,
  };
  #lesson: LoadedLesson | null = null;
  #state: LessonState | null = null;
  #index = new Map<string, ScriptLine>();
  #voice: VoicePlayer | null = null;
  #unlocked = false;
  #tilt = new TiltStepper();
  #prevJump = true;
  #openedAt = 0;
  #loadToken = 0;
  // the level
  #levelOverride: string | null = null;
  #level: Level | null = null;
  #plan: PlanStep[] = [];
  #config: ResolvedLocks | null = null;
  #done = new Set<number>();
  #overridden = new Set<number>();
  #missions = new Map<number, MissionRun>();
  // the stage
  #bindings = new WeakMap<StageData, StageRun>();
  #run: StageRun | null = null;
  #openLocks = new Set<number>();
  #collected = new Set<number>();
  #beaconFor: number | null = null;
  #beaconTimer: ReturnType<typeof setTimeout> | null = null;
  #lockedLineAt = Number.NEGATIVE_INFINITY;
  #oopsAt = Number.NEGATIVE_INFINITY;
  #bannerAt = Number.NEGATIVE_INFINITY;
  #bannerSeq = 0;
  #keySeen = false;
  // diagnostics (debug state)
  #said: string[] = [];
  #guards: { islandId: number; at: number }[] = [];
  #notes: string[] = [];

  /** Labels drawn in the maze (the UI sets translated ones). */
  labels: LearningLabels = { ...DEFAULT_LABELS };
  /** Phase 20 compatibility: the gate label. */
  set label(fn: (n: number) => string) {
    this.labels = { ...this.labels, gate: fn };
  }

  constructor(opts: LearningGatesOptions) {
    this.#opts = opts;
  }

  get #port(): LockPort {
    return this.#opts.locks ?? NO_LOCKS;
  }
  #now(): number {
    return this.#opts.now?.() ?? performance.now();
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

  /** The card listens for voice cues (a spoken number lights a gem, a named choice pulses). */
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
  get level(): Level | null {
    return this.#level;
  }

  // ── loading ──

  use(lesson: LoadedLesson): void {
    this.abort();
    this.#voice?.stop();
    this.#loadToken++;
    this.#lesson = lesson;
    this.#levelOverride = null;
    this.#index = scriptIndex(lesson.path);
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
    this.#set({ loading: false, error: null, speaking: null });
    this.#applyLevel();
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
    this.#level = null;
    this.#config = null;
    this.#plan = [];
    this.#run = null;
    this.#clearBeacon();
    this.#set({
      lesson: null,
      loading: false,
      error: null,
      built: 0,
      speaking: null,
      steps: [],
      mission: null,
      banner: null,
      canOverride: false,
    });
  }

  /** The Grown-ups control: play another of the lesson's levels this session (progress starts over). */
  setLevel(id: string): void {
    if (!this.#lesson) return;
    this.#levelOverride = id;
    this.#applyLevel();
  }

  #applyLevel(): void {
    const lesson = this.#lesson;
    if (!lesson) return;
    const level = pickLevel(lesson.path, lesson.activity, this.#levelOverride);
    this.#level = level;
    this.#config = resolveLocks(level);
    this.#plan = levelPlan(lesson.activity, level);
    this.#bindings = new WeakMap();
    this.#run = null;
    const levels = levelSummaries(lesson.activity);
    this.#set({
      lesson: {
        title: lesson.activity.title,
        activityId: lesson.activity.id,
        source: lesson.source,
        level: levels.find((l) => l.id === level.id) ?? {
          id: level.id,
          label: level.label,
          description: '',
          isDefault: false,
        },
        levels,
        mode: this.#config.mode,
        override: this.#config.override === 'grown-up',
      },
    });
    this.resetProgress();
  }

  /** A new game starts the lesson from the beginning (the state otherwise lasts across stages and retries). */
  resetProgress(): void {
    const lesson = this.#lesson;
    if (!lesson) return;
    this.#state = initialState(lesson.activity, {
      seed: this.#opts.seed?.() ?? randomSeed(),
      shuffle: lesson.path.play?.shuffle ?? 'positions',
    });
    this.#done.clear();
    this.#overridden.clear();
    this.#missions.clear();
    this.#notes = [];
    this.#guards = [];
    this.#set({ built: 0, mission: null, banner: null });
    this.#refresh();
  }

  /** Call on a user gesture: lets Pip's clips play later without one (once per voice player). */
  unlock(): void {
    if (this.#unlocked || !this.#voice) return;
    this.#unlocked = true;
    this.#voice.unlock();
  }

  /** Any key pressed in the game: the device has a keyboard (letter and number rounds may invite it). */
  noteKey(): void {
    this.#keySeen = true;
  }

  // ── the maze ──

  /**
   * The stage with its link portals replaced by this level's Pip gates and mission posts (unchanged without a
   * lesson). The binding (locks.ts) is kept for the decorated stage: `locksFor` and `stageReady` use it.
   */
  decorate(stage: StageData): StageData {
    const lesson = this.#lesson;
    const config = this.#config;
    if (!lesson || !config) return stage;
    const binding = bindLevel(stage, this.#plan, config);
    const gateColor = lesson.path.theme.palette.gate;
    const postColor = lesson.path.theme.palette.gem;
    const portals = new Map<number, BoundStep>();
    const list = binding.steps
      .filter((b) => b.spot)
      .map((b, id) => {
        portals.set(id, b);
        const spot = b.spot as NonNullable<BoundStep['spot']>;
        const post = b.step.kind === 'mission';
        return {
          id,
          islandId: spot.islandId,
          pos: [spot.pos[0], spot.pos[1]] as Vec2,
          href: post
            ? missionHref(lesson.activity.id, b.number, postColor)
            : learningHref(lesson.activity.id, b.number, gateColor),
          label:
            b.step.kind === 'mission'
              ? this.labels.post(b.step, b.step.mission.kind === 'collect' ? b.step.mission.count : 0)
              : this.labels.gate(b.number),
          // not from a page element; 0 keeps the stage schema-valid (nothing reads it for a gate)
          sourceElementId: 0,
        };
      });
    const decorated: StageData = { ...stage, portals: list };
    this.#bindings.set(decorated, {
      stage: decorated,
      binding,
      portals,
      letters: islandLetters(binding.graph),
    });
    return decorated;
  }

  /** The runtime locks to load the simulation with (undefined when this stage has none, e.g. no lesson). */
  locksFor(stage: StageData): LockSpec[] | undefined {
    const run = this.#bindings.get(stage);
    return run && run.binding.locks.length > 0 ? run.binding.locks : undefined;
  }

  /**
   * The stage (a decorated one) is loaded in the engine and the sim: draw its locks, open the ones whose steps are
   * already done, and forget last attempt's mission progress. Returns the portals to show as used (done steps).
   */
  stageReady(stage: StageData): number[] {
    this.#clearBeacon();
    this.#collected.clear();
    this.#openLocks.clear();
    for (const [i, m] of this.#missions) if (m.status !== 'done') this.#missions.delete(i);
    const run = this.#bindings.get(stage) ?? null;
    this.#run = run;
    this.#set({ mission: null, banner: null });
    if (!run) {
      this.#refresh();
      return [];
    }
    const theme = this.#lesson?.path.theme;
    const visuals: LockVisual[] = run.binding.locks.map((lock) => {
      const owner =
        lock.kind === 'goal' ? null : (run.binding.steps.find((b) => b.lockIds.includes(lock.id)) ?? null);
      return {
        lock,
        label: this.labels.lock(owner),
        color: theme?.palette.gate ?? '#4f9fd6',
        icon: owner?.step.kind === 'mission' ? 'gem' : 'pip',
      };
    });
    this.#port.show(visuals);
    for (const b of run.binding.steps)
      if (this.#done.has(b.index)) for (const id of b.lockIds) this.#openLock(id, true);
    this.#maybeOpenGoal(true);
    this.#refresh();
    return [...run.portals].filter(([, b]) => this.#done.has(b.index)).map(([id]) => id);
  }

  /** Is this portal a mission post? */
  isPost(portalId: number): boolean {
    return this.#run?.portals.get(portalId)?.step.kind === 'mission';
  }

  /** The finish is locked right now (the level waits for steps). */
  goalLocked(): boolean {
    const id = this.#run?.binding.goalLockId;
    return id !== null && id !== undefined && !this.#openLocks.has(id);
  }
  get goalLockId(): number | null {
    return this.#run?.binding.goalLockId ?? null;
  }

  // ── steps, locks and missions ──

  #openLock(id: number, instant = false): void {
    if (this.#openLocks.has(id)) return;
    this.#openLocks.add(id);
    this.#port.setLock(id, true);
    this.#port.setLockState(id, instant ? 'open' : 'opening');
  }

  /** Open the finish once every step it waits for is done; returns Pip's line for it. */
  #maybeOpenGoal(instant = false): string[] {
    const run = this.#run;
    const id = run?.binding.goalLockId;
    if (!run || id === null || id === undefined || this.#openLocks.has(id)) return [];
    const waiting = run.binding.steps.filter((b) => b.goal && b.spot && !this.#done.has(b.index));
    if (waiting.length > 0) return [];
    this.#openLock(id, instant);
    return [systemLineId.unlockedGoal];
  }

  /** A step is done: open its locks (and maybe the finish); returns Pip's unlock lines. */
  #complete(index: number): string[] {
    if (this.#done.has(index)) return [];
    this.#done.add(index);
    const m = this.#missions.get(index);
    if (m) m.status = 'done';
    const lines: string[] = [];
    const b = this.#run?.binding.steps[index];
    if (b && b.lockIds.length > 0) {
      const kinds = new Set(b.lockIds.map((id) => this.#run?.binding.locks[id]?.kind));
      for (const id of b.lockIds) this.#openLock(id);
      lines.push(kinds.has('bridge') ? systemLineId.unlockedBridge : systemLineId.unlockedLift);
    }
    lines.push(...this.#maybeOpenGoal());
    if (this.#beaconFor === index) this.#clearBeacon();
    if (this.#view.banner?.step === index) this.#set({ banner: null });
    this.#refresh();
    return lines;
  }

  #pendingRound(): number | null {
    for (const s of this.#plan) if (s.kind === 'round' && !this.#done.has(s.index)) return s.index;
    return null;
  }

  /** A round step this stage had no room for (asked on the stage-start card instead, as Phase 20 did). */
  #unplacedRound(): number | null {
    const run = this.#run;
    if (!run) return null;
    for (const b of run.binding.steps)
      if (b.step.kind === 'round' && !b.spot && !this.#done.has(b.index)) return b.index;
    return null;
  }

  /** The stage needs the stage-start card: no gate at all, or a round step with no room for its gate. */
  needsStartCard(): boolean {
    const run = this.#run;
    if (!this.#lesson || !run) return false;
    const gates = [...run.portals.values()].filter((b) => b.step.kind === 'round');
    return gates.length === 0 || this.#unplacedRound() !== null;
  }

  #roundStep(roundId: string): number | null {
    const s = this.#plan.find((p) => p.kind === 'round' && p.roundId === roundId);
    return s ? s.index : null;
  }

  #refresh(): void {
    const run = this.#run;
    const steps: StepView[] = this.#plan.map((s) => {
      const b = run?.binding.steps[s.index];
      return {
        index: s.index,
        kind: s.kind,
        number: b?.number ?? 0,
        lock: b?.lock ?? s.lock,
        done: this.#done.has(s.index),
        placed: !run || !!b?.spot,
      };
    });
    const active = [...this.#missions].reverse().find(([, m]) => m.status === 'active');
    let mission: MissionView | null = null;
    if (active) {
      const [index, m] = active;
      const b = run?.binding.steps[index];
      mission = {
        index,
        number: b?.number ?? 0,
        kind: b?.step.kind === 'mission' ? b.step.mission.kind : 'collect',
        count: m.count,
        have: m.have,
        by: m.goal?.by ?? null,
        letter: m.goal?.letter ?? null,
      };
    }
    this.#set({ steps, mission, canOverride: this.#nextOverride() !== null });
  }

  /** The step the grown-up override opens next (the first one still keeping something shut). */
  #nextOverride(): BoundStep | null {
    if (this.#config?.override !== 'grown-up' || !this.#run) return null;
    for (const b of this.#run.binding.steps)
      if (b.spot && !this.#done.has(b.index) && (b.lockIds.length > 0 || b.goal)) return b;
    return null;
  }

  /** Pause menu, after the grown-up's press-and-hold: open the next lock (only when the level allows it). */
  overrideNext(): boolean {
    const b = this.#nextOverride();
    if (!b) return false;
    this.#overridden.add(b.index);
    this.#notes.push(`override: step ${b.index}`);
    this.#say(this.#complete(b.index));
    return true;
  }

  /** The ball rolled into a mission post: the mission starts (or Pip repeats it). */
  post(portalId: number): void {
    const run = this.#run;
    const b = run?.portals.get(portalId);
    if (!run || !b || b.step.kind !== 'mission' || this.#done.has(b.index)) return;
    const mission = b.step.mission;
    const existing = this.#missions.get(b.index);
    if (existing) {
      this.#say(this.#missionLines(b, existing, false));
      return;
    }
    const closed = new Set(run.binding.locks.map((l) => l.id).filter((id) => !this.#openLocks.has(id)));
    const allowed = allowedIslands(run.binding, closed);
    const postIsland = b.spot?.islandId ?? run.stage.start.islandId;
    let m: MissionRun;
    if (mission.kind === 'collect') {
      const available = [...gemsByIsland(run.stage, this.#collected, allowed).values()].reduce(
        (a, n) => a + n,
        0,
      );
      const { count, lowered } = collectCount(mission.count, available);
      if (lowered) this.#notes.push(`collect lowered: step ${b.index} ${mission.count} → ${count}`);
      m = { status: 'active', asked: mission.count, count, lowered, have: 0, goal: null, postIsland };
    } else {
      const candidates = new Set([...allowed].filter((i) => i !== postIsland));
      const goal = resolveReach(
        mission.island,
        gemsByIsland(run.stage, this.#collected, candidates),
        run.letters,
      );
      if (!goal) this.#notes.push(`reach: step ${b.index} has no island to reach`);
      else if (goal.tie) this.#notes.push(`reach tie: step ${b.index} → island ${goal.letter}`);
      m = { status: 'active', asked: 0, count: 1, lowered: false, have: 0, goal, postIsland };
      // a letter isn't drawn in the maze yet: the beacon shows the island
      if (goal?.by === 'letter') this.#beacon(b.index, this.#islandPoint(goal.islandId));
    }
    this.#missions.set(b.index, m);
    const lines = [systemLineId.missionPost, ...this.#missionLines(b, m, true)];
    if ((mission.kind === 'collect' && m.count === 0) || (mission.kind === 'reach' && !m.goal))
      lines.push(...this.#complete(b.index));
    this.#refresh();
    this.#say(lines);
  }

  #missionLines(b: BoundStep, m: MissionRun, first: boolean): string[] {
    if (b.step.kind !== 'mission') return [];
    if (b.step.mission.kind === 'collect') {
      if (m.count === 0) return [systemLineId.collectDone];
      const ask = systemLineId.collect(Math.min(10, m.count));
      return first || m.have === 0 ? [ask] : [ask, systemLineId.number(Math.min(10, m.have))];
    }
    if (!m.goal) return [systemLineId.reachDone];
    if (m.goal.by === 'most-gems') return [systemLineId.reachMost];
    if (m.goal.by === 'fewest-gems') return [systemLineId.reachFewest];
    return [systemLineId.reachLetter(m.goal.letter ?? 'A')];
  }

  #islandPoint(islandId: number): Vec2 | null {
    const island = this.#run?.stage.islands.find((i) => i.id === islandId);
    if (!island) return null;
    const r = island.restartPoints[0];
    if (r) return [r[0], r[1]];
    const n = island.contour.length || 1;
    return [
      island.contour.reduce((a, p) => a + p[0], 0) / n,
      island.contour.reduce((a, p) => a + p[1], 0) / n,
    ];
  }

  /** An item was picked up: collect missions count it, aloud. */
  item(itemId: number): void {
    this.#collected.add(itemId);
    const lines: string[] = [];
    for (const [index, m] of this.#missions) {
      const b = this.#run?.binding.steps[index];
      if (m.status !== 'active' || b?.step.kind !== 'mission' || b.step.mission.kind !== 'collect') continue;
      m.have++;
      lines.push(systemLineId.number(Math.min(10, m.have)));
      if (m.have >= m.count) lines.push(systemLineId.collectDone, ...this.#complete(index));
    }
    if (lines.length > 0) {
      this.#refresh();
      this.#say(lines);
    }
  }

  /**
   * The ball reached an island (`island` SimEvent): the region guard first, then a reach mission may be done.
   * Returns true when the island lies beyond a closed lock: the game returns the ball to its last allowed restart
   * point.
   */
  island(islandId: number): boolean {
    const run = this.#run;
    if (!run) return false;
    if (this.guard(islandId)) return true;
    for (const [index, m] of this.#missions)
      if (m.status === 'active' && m.goal?.islandId === islandId) {
        this.#say([systemLineId.reachDone, ...this.#complete(index)]);
        this.#refresh();
      }
    return false;
  }

  /**
   * The region guard, the main enforcement of a path lock: on real sites a ball can hop a guardrail to a
   * neighbouring island around most cuts (the L1 M0 spike: 90 % of cut positions with a standing hop), so every
   * `island` or `landed` event on an island beyond a closed lock sends the ball back. Pip says "Oops! Pip's gate
   * first." (at most every few seconds) and the banner names the step that opens the way. Returns true to send the
   * ball back.
   */
  guard(islandId: number): boolean {
    const run = this.#run;
    if (!run || this.allowed(islandId)) return false;
    const now = this.#now();
    this.#guards.push({ islandId, at: now });
    const owner = this.#blockingStep(islandId);
    if (owner && this.#config?.signals.banner) this.#showBanner(owner);
    if (now - this.#oopsAt >= GUARD_LINE_MS) {
      this.#oopsAt = now;
      this.#say([systemLineId.oops]);
    }
    if (owner?.spot && this.#config?.signals.beacon) this.#beacon(owner.index, owner.spot.pos);
    return true;
  }

  /** The first step still shut whose own lock keeps the ball off `islandId`. */
  #blockingStep(islandId: number): BoundStep | null {
    const run = this.#run;
    if (!run) return null;
    const pending = run.binding.steps.filter((b) => b.lockIds.length > 0 && !this.#done.has(b.index));
    return (
      pending.find((b) => !allowedIslands(run.binding, new Set(b.lockIds)).has(islandId)) ??
      pending[0] ??
      null
    );
  }

  /**
   * Show the banner for `owner`. The physics reports a pressed lock about once a second: the same message isn't
   * restarted while it still shows (it would flicker), only after it has faded.
   */
  #showBanner(owner: BoundStep): void {
    const next = this.#bannerFor(owner);
    const cur = this.#view.banner;
    const now = this.#now();
    const same =
      !!cur &&
      cur.step === next.step &&
      cur.kind === next.kind &&
      cur.count === next.count &&
      cur.have === next.have;
    if (same && now - this.#bannerAt < BANNER_REPEAT_MS) return;
    this.#bannerAt = now;
    this.#set({ banner: { ...next, seq: ++this.#bannerSeq } });
  }

  #bannerFor(owner: BoundStep): LockBanner {
    const m = this.#missions.get(owner.index);
    const count =
      m?.count ??
      (owner.step.kind === 'mission' && owner.step.mission.kind === 'collect' ? owner.step.mission.count : 0);
    const kind: LockBanner['kind'] =
      owner.step.kind === 'round'
        ? 'gate'
        : !m
          ? 'post'
          : owner.step.mission.kind === 'collect'
            ? 'collect'
            : 'reach';
    return { seq: this.#bannerSeq, step: owner.index, kind, n: owner.number, count, have: m?.have ?? 0 };
  }

  /** Islands the ball may be on now (all of them without closed locks). */
  allowed(islandId: number): boolean {
    const run = this.#run;
    if (!run) return true;
    const closed = new Set(
      run.binding.locks.filter((l) => l.kind !== 'goal' && !this.#openLocks.has(l.id)).map((l) => l.id),
    );
    return closed.size === 0 || allowedIslands(run.binding, closed).has(islandId);
  }

  /** The ball touched a closed lock (`locked` SimEvent): banner, Pip's line, the beacon and a pulse, per `signals`. */
  locked(lockId: number): void {
    const run = this.#run;
    const config = this.#config;
    if (!run || !config || this.#openLocks.has(lockId)) return;
    const lock = run.binding.locks[lockId];
    if (!lock) return;
    const owner =
      lock.kind === 'goal'
        ? run.binding.steps.find((b) => b.goal && b.spot && !this.#done.has(b.index))
        : run.binding.steps.find((b) => b.lockIds.includes(lockId));
    this.#port.pulse(lockId);
    if (!owner || this.#done.has(owner.index)) return;
    const m = this.#missions.get(owner.index);
    const collectTarget =
      m?.count ??
      (owner.step.kind === 'mission' && owner.step.mission.kind === 'collect' ? owner.step.mission.count : 0);
    if (config.signals.banner) this.#showBanner(owner);
    const now = this.#now();
    if (config.signals.voice && now - this.#lockedLineAt >= LOCKED_LINE_MS) {
      this.#lockedLineAt = now;
      this.#say([lockedLine(lock, owner, collectTarget)]);
    }
    if (config.signals.beacon && owner.spot) this.#beacon(owner.index, owner.spot.pos);
  }

  #beacon(owner: number, pos: Vec2 | null): void {
    if (!pos) return;
    if (this.#beaconTimer) clearTimeout(this.#beaconTimer);
    this.#beaconFor = owner;
    this.#port.beacon([pos[0], pos[1]]);
    this.#beaconTimer = setTimeout(() => this.#clearBeacon(), BEACON_MS);
  }

  #clearBeacon(): void {
    if (this.#beaconTimer) clearTimeout(this.#beaconTimer);
    this.#beaconTimer = null;
    if (this.#beaconFor === null) return;
    this.#beaconFor = null;
    this.#port.beacon(null);
  }

  // ── the card ──

  #device(): DeviceInputs {
    const d = this.#opts.device?.() ?? { keyboard: false, tilt: false };
    return { tap: true, keyboard: d.keyboard || this.#keySeen, tilt: d.tilt };
  }

  #policy(round: Round): InputPolicy {
    const lesson = this.#lesson as LoadedLesson;
    return inputPolicy(lesson.path, lesson.activity, round, this.#device());
  }

  /**
   * The ball rolled into gate `gateId` (−1 = the stage-start fallback). A gate asks its own step's round; with a
   * `none` level (or after every step) any gate asks the next round, as in Phase 20. Returns false when there is
   * nothing to ask (e.g. a level of missions only).
   */
  open(gateId: number, now = performance.now()): boolean {
    const lesson = this.#lesson;
    const state = this.#state;
    if (!lesson || !state || this.#view.gate) return false;
    const { activity } = lesson;
    const bound = this.#run?.portals.get(gateId);
    const own =
      bound && bound.step.kind === 'round' && this.#config?.mode !== 'none' && !this.#done.has(bound.index)
        ? bound.index
        : null;
    const index = own ?? (gateId < 0 ? this.#unplacedRound() : null) ?? this.#pendingRound();
    let s: Step;
    if (index === null) {
      if (state.phase === 'intro') return false;
      s = openStep(activity, state);
    } else {
      const target = this.#plan[index] as PlanStep & { kind: 'round' };
      const asking = state.phase === 'round' && activity.rounds[state.index]?.id === target.roundId;
      if (asking && !state.solved) {
        const r = currentRound(activity, state);
        s = { state, say: [lineId.prompt(activity.id, r.id), lineId.callout(activity.id, r.id)], show: null };
      } else {
        const played = step(activity, state, { type: 'play', roundId: target.roundId });
        s = state.phase === 'intro' ? { ...played, say: [lineId.gate, ...played.say] } : played;
      }
    }
    this.#clearBeacon();
    if (this.#view.banner) this.#set({ banner: null });
    this.#openedAt = now;
    this.#prevJump = true;
    this.#tilt.reset();
    this.#apply(s, {
      gateId,
      number: bound?.number ?? (gateId < 0 ? 0 : gateId + 1),
      stepIndex: index,
      locking: own !== null && !!bound && bound.lock !== 'none',
      cursor: null,
    });
    return true;
  }

  #apply(s: Step, gate: Partial<GateView> = {}): void {
    const lesson = this.#lesson;
    if (!lesson) return;
    const { activity } = lesson;
    const prev = this.#view.gate;
    this.#state = s.state;
    const round = currentRound(activity, s.state);
    const sameRound = prev?.round.id === round.id && gate.gateId === undefined;
    const policy = this.#policy(round);
    const solved = s.state.solved && s.state.phase === 'round';
    const next: GateView['next'] = !solved
      ? 'roll-on'
      : followUpAfter(activity, s.state, round.id)
        ? 'follow-up'
        : round.optional || this.#pendingRound() === null
          ? 'more'
          : 'roll-on';
    const view: GateView = {
      gateId: gate.gateId ?? prev?.gateId ?? -1,
      number: gate.number ?? prev?.number ?? 0,
      stepIndex: gate.stepIndex !== undefined ? gate.stepIndex : (prev?.stepIndex ?? null),
      locking: gate.locking ?? prev?.locking ?? false,
      mode: gateMode(s.state),
      state: s.state,
      round,
      choices: choicesInOrder(round),
      cursor: gate.cursor !== undefined ? gate.cursor : sameRound ? (prev?.cursor ?? null) : null,
      show: s.show,
      seq: (prev?.seq ?? 0) + 1,
      policy,
      nudges: sameRound ? (prev?.nudges ?? 0) : 0,
      nudgeSeq: prev?.nudgeSeq ?? 0,
      next,
    };
    this.#set({ gate: view, built: s.state.built });
    // the invited input is voiced right after the callout
    const callout = lineId.callout(activity.id, round.id);
    const at = s.say.indexOf(callout);
    const say =
      at >= 0 && policy.promptLine && !this.#lesson?.path.family?.tapOnly
        ? [...s.say.slice(0, at + 1), policy.promptLine, ...s.say.slice(at + 1)]
        : s.say;
    this.#say(say);
  }

  #say(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const lesson = this.#lesson;
    const state = this.#state;
    if (!lesson || !state) return;
    const lines = sessionScript(this.#index, lesson.activity, state);
    const found = ids.map((id) => lines.get(id)).filter((l): l is ScriptLine => !!l);
    this.#said.push(...ids);
    if (this.#said.length > 40) this.#said.splice(0, this.#said.length - 40);
    if (found.length > 0) void this.#voice?.play(found);
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

  /** Answer with `choice`, invited or not (tests; `choose` judges the input first). */
  answer(choice: string): void {
    const lesson = this.#lesson;
    const gate = this.#view.gate;
    const state = this.#state;
    if (!lesson || !state || gate?.mode !== 'round' || gate.state.solved || !gate.choices.includes(choice))
      return;
    const cursor = gate.choices.indexOf(choice);
    if (gate.cursor !== cursor) this.#set({ gate: { ...gate, cursor } });
    const s = step(lesson.activity, state, { type: 'answer', choice });
    if (s.state === state) return;
    const done = s.state.solved ? this.#roundStep(gate.round.id) : null;
    const extra = done !== null ? this.#complete(done) : [];
    this.#apply({ ...s, say: [...s.say, ...extra] });
  }

  /**
   * An answer through `mode`: accepted when the round invites it (or after two nudges, or with tap-only);
   * otherwise Pip nudges towards the invited input and the badges flash.
   */
  choose(choice: string, mode: InputMode): void {
    const gate = this.#view.gate;
    if (gate?.mode !== 'round' || gate.state.solved || !gate.choices.includes(choice)) return;
    const tapOnly = !!this.#lesson?.path.family?.tapOnly;
    if (!tapOnly && judgeInput(gate.policy, mode, gate.nudges) === 'nudge') {
      this.#set({ gate: { ...gate, nudges: gate.nudges + 1, nudgeSeq: gate.nudgeSeq + 1 } });
      this.#say([nudgeLine(gate.policy)]);
      return;
    }
    this.answer(choice);
  }

  /** A tap or click on a choice. */
  tap(choice: string): void {
    this.choose(choice, 'tap');
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

  /** JUMP / Enter: answer with the cursor, go on after a success, take the bonus when offered. */
  confirm(mode: InputMode = 'arrows'): void {
    const gate = this.#view.gate;
    if (!gate) return;
    if (gate.mode === 'bonus-offer') this.bonus(true);
    else if (gate.mode === 'done' || gate.state.solved) this.proceed();
    else {
      const choice = gate.cursor === null ? null : gate.choices[gate.cursor];
      if (choice) this.choose(choice, mode);
      else this.replay(); // nothing chosen yet: ask again ("which island…?")
    }
  }

  /** After a solved round: its follow-up, the bonus / the finale, or roll on. */
  proceed(): void {
    const lesson = this.#lesson;
    const gate = this.#view.gate;
    const state = this.#state;
    if (!lesson || !gate || !state) return;
    if (gate.mode === 'done' || !gate.state.solved) {
      this.rollOn();
      return;
    }
    if (gate.next === 'follow-up') {
      const follow = followUpAfter(lesson.activity, state, gate.round.id);
      if (follow) {
        this.#apply(step(lesson.activity, state, { type: 'play', roundId: follow }));
        return;
      }
    }
    if (gate.next === 'more') {
      this.#apply(finishStep(lesson.activity, state));
      return;
    }
    this.rollOn();
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
    else this.#say([lineId.prompt(a, gate.round.id), lineId.callout(a, gate.round.id)]);
  }

  /** "Roll on!": the card closes and play resumes; Pip's line carries over into the maze. */
  rollOn(): void {
    const gate = this.#view.gate;
    if (!gate || (gate.mode === 'round' && !gate.state.solved)) return;
    this.#say([lineId.rollOn]);
    this.#close(gate.gateId, 'rolled-on');
  }

  /**
   * "Skip gate" (an optional stop: never a penalty; the lesson waits at the same round), or "Later" on a locking
   * step: the card closes, the lock stays shut and the gate stays open for another try.
   */
  skip(): void {
    const gate = this.#view.gate;
    if (!gate) return;
    this.#voice?.stop();
    this.#close(gate.gateId, gate.locking && !gate.state.solved ? 'later' : 'skipped');
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
    if (press) this.confirm(source === 'phone' ? 'tilt' : 'arrows');
  }

  /** Window keydown while the card is open; true when handled. */
  key(ev: KeyboardEvent): boolean {
    const gate = this.#view.gate;
    if (!gate) return false;
    this.#keySeen = true;
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
        this.confirm('arrows');
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
    if (gate.mode !== 'round' || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(ev.code);
    if (digit) {
      const choice =
        keyToChoice(gate.round, digit[1] as string) ??
        choiceForDigit(gate.round, gate.choices, Number(digit[1]));
      if (choice) this.choose(choice, 'number-key');
      return true;
    }
    const letter = /^Key([A-Z])$/.exec(ev.code);
    if (letter) {
      const choice = keyToChoice(gate.round, letter[1] as string);
      if (!choice) return false;
      ev.preventDefault();
      this.choose(choice, 'letter-key');
      return true;
    }
    return false;
  }

  /** e2e: what the card shows, the level, the binding, the locks and missions. */
  debug() {
    const g = this.#view.gate;
    const run = this.#run;
    return {
      active: this.active,
      activityId: this.#lesson?.activity.id ?? null,
      level: this.#level?.id ?? null,
      mode: this.#config?.mode ?? null,
      seed: this.#state?.seed ?? null,
      phase: this.#state?.phase ?? null,
      index: this.#state?.index ?? null,
      built: this.#state?.built ?? 0,
      done: [...this.#done].sort((p, q) => p - q),
      overridden: [...this.#overridden],
      gate: g
        ? {
            gateId: g.gateId,
            number: g.number,
            step: g.stepIndex,
            mode: g.mode,
            round: g.round.id,
            cursor: g.cursor,
            solved: g.state.solved,
            invited: g.policy.invited,
            badges: g.policy.badges,
            nudges: g.nudges,
            next: g.next,
          }
        : null,
      binding: run
        ? {
            path: run.binding.path,
            chain: run.binding.chain,
            coverage: run.binding.coverage,
            goalLockId: run.binding.goalLockId,
            steps: run.binding.steps.map((b) => ({
              index: b.index,
              kind: b.step.kind,
              lock: b.lock,
              fallback: b.fallback,
              island: b.spot?.islandId ?? null,
              number: b.number,
              lockIds: b.lockIds,
              goal: b.goal,
              portalId: [...run.portals].find(([, p]) => p === b)?.[0] ?? null,
            })),
            locks: run.binding.locks.map((l) => ({ ...l, open: this.#openLocks.has(l.id) })),
          }
        : null,
      missions: [...this.#missions].map(([index, m]) => ({ index, ...m })),
      banner: this.#view.banner,
      said: [...this.#said],
      guards: this.#guards.length,
      notes: [...this.#notes],
      port: { physics: this.#port.physics, engine: this.#port.engine },
    };
  }
}
