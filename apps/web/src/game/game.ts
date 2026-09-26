/**
 * `Game`: the whole player experience outside React. It owns the engine (@wwm/engine), the simulation
 * (@wwm/physics, via a SimDriver), the input sources and room (@wwm/net), the audio manager and the rules,
 * and walks the phase machine (machine.ts). React screens read `view` through `subscribe/getView`
 * (useSyncExternalStore) and call the action methods.
 *
 * Per frame: sample inputs → (play) SimDriver.advance → events to rules / engine / audio / haptics →
 * engine.setBall/setControl/setElevators → engine.frame → `InputSample.frameYaw = engine.cameraYaw()`.
 *
 * Labels: E = evidenced 2013 behaviour, R = reconstructed, N = new (see docs/reference/fidelity-spec.md).
 */
import { createEngine, type Engine, type QualitySetting } from '@wwm/engine';
import {
  GamepadInputSource,
  type HostConnection,
  KeyboardInputSource,
  neutralSample,
  PhoneInputSource,
} from '@wwm/net';
import { PHYSICS_VERSION } from '@wwm/physics';
import {
  type ApiErrorCode,
  distanceToPolygonEdge,
  type GamePhase,
  type HapticPattern,
  type InputSample,
  LARGE_SCORE,
  MAX_TILT_PITCH,
  MAX_TILT_ROLL,
  NUM_BALLS,
  pointInPolygon,
  SIM_HZ,
  type SimEvent,
  SMALL_SCORE,
  type StageData,
  type Vec2,
  worldToPage,
} from '@wwm/schema';
import type { AudioManager, Bgm } from '../audio/audio.ts';
import { openHostRoom } from '../controller/useHostRoom.ts';
import type { SubmitResult, VersionedReplay } from '../ranking/client.ts';
import { createGhostBall, type GhostBall, type GhostTrack, recordGhostTrack } from '../ranking/ghost.ts';
import type { Challenge } from '../ranking/share.ts';
import { gameActivity } from '../telemetry/engagement.ts';
import { telemetry } from '../telemetry/index.ts';
import { analyticsRun } from '../telemetry/observe-game.ts';
import { ATTRACT_ID, type CatalogEntry, catalogEntry, FIXTURES, PRACTICE } from './catalog.ts';
import { fixtureFor, hostOf, type JourneyStop } from './journey.ts';
import type { BoardSource, GameBoards } from './leaderboard.ts';
import { type GameEvent, HOLD_ON_DISCONNECT, IN_STAGE, transition } from './machine.ts';
import {
  addScore,
  countItems,
  finishStage,
  fireworksCount,
  GameTimer,
  GOAL_SIGN_SEC,
  RESTART_DELAY_SEC,
  restartPointFor,
  SIGN_SEC,
  SMALL_CREDIT_DELAY_SEC,
  type StageResult,
  sanitizeName,
} from './rules.ts';
import { createDriver, type SimDriver } from './sim-driver.ts';
import {
  createApiRun,
  FixtureRun,
  type LoadErrorCode,
  type LoadedStage,
  PracticeRun,
  type RunSource,
  runFromRef,
  StageBuilderPool,
  StageLoadError,
} from './stages.ts';

export type InputMode = 'keyboard' | 'phone';
export type SignKind = 'goal' | 'timeup' | 'gameover';
export type TutorialStep = 2 | 3 | 4 | 5 | 6;

export interface RoomView {
  status: 'idle' | 'creating' | 'ready' | 'error';
  code: string | null;
  /** Contracts v0.2.7: the phone's pairing secret, put in the QR code / link fragment (`/c/<code>#p=…`). */
  pairToken: string | null;
  controllerConnected: boolean;
  rttMs: number | null;
}

/** Phase 13: "Travel to <label> (<host>)?" after the ball rolled into a link portal. */
export interface PortalPrompt {
  id: number;
  label: string;
  host: string;
  href: string;
  /** The capture service is unreachable (and the target isn't an offline fixture): travel is unavailable. */
  offline: boolean;
}

export interface GameView {
  phase: GamePhase;
  /** WebGPU/WebGL2 or workers missing. */
  unsupported: boolean;
  engineReady: boolean;
  inputMode: InputMode | null;
  room: RoomView;
  /** Pairing screen: "Connected!" is showing before calibrate (E: 4 s, N: shorter). */
  justConnected: boolean;
  calibrateTimedOut: boolean;
  calibrateLeft: number;
  /** Freeze overlay while the phone is gone (N). */
  hold: 'disconnected' | null;
  resumedFlash: number;
  run: {
    id: string;
    kind: RunSource['kind'];
    title: string;
    url: string;
    index: number;
    count: number;
    /** Set once the slice is loaded. */
    stageId?: string;
  } | null;
  build: { step: string; pct: number; label: string } | null;
  error: { code: LoadErrorCode; message: string; url?: string } | null;
  /** HUD */
  timeInt: number;
  last30: boolean;
  total: number;
  spares: number;
  small: number;
  large: number;
  largeTotal: number;
  oneUpAt: number;
  tutorial: TutorialStep | null;
  countdown: number | null;
  introSkippable: boolean;
  sign: SignKind | null;
  confirm: 'quit' | 'search' | null;
  result: StageResult | null;
  /** Where the current stage's board lives (null while asking the server). */
  stageSource: BoardSource | null;
  ranking: RankingView | null;
  /** "Race the #1 run" (N, Phase 10 ghosts). */
  ghost: GhostView;
  /** `/play/:id?beat=&by=` from a friend's share link; `stageId` is the stage it applies to once loaded. */
  challenge: (Challenge & { stageId: string | null }) | null;
  muted: boolean;
  sensitivity: number;
  pixelLook: boolean;
  firstRun: boolean;
  /** Phase 13: the portal prompt (play is paused while it shows). */
  portal: PortalPrompt | null;
  /** Phase 13: travelling through a portal (the gate animation, then the build of the linked site). */
  travel: { label: string; host: string; href: string } | null;
  /** Phase 13: the sites this session rolled through, in order (a web journey once a portal was taken). */
  journey: JourneyStop[];
}

export interface RankedStage {
  /** Index into the session's results. */
  resultIndex: number;
  stageId: string;
  title: string;
  sliceIndex: number;
  sliceCount: number;
  score: number;
  source: BoardSource;
  /** After submission: rank on the stage board, whether the replay was verified, where it was stored. */
  rank: number | null;
  verified: boolean;
  stored: BoardSource | null;
  /** Phase 18: server permalink id of the stage entry (share card `/s/:stageId/r/:scoreId`). */
  scoreId?: string;
}

export interface RankingView {
  /** E: "??" until known. */
  rank: number | null;
  total: number;
  /** Where the session total goes: the server's global run board, or this device. */
  source: BoardSource | null;
  submitted: boolean;
  skipped: boolean;
  name: string | null;
  stored: BoardSource | null;
  /** Phase 18: server permalink id of the run entry (share card `/r/:scoreId`). */
  scoreId?: string;
  /** Cleared stages of the session (each has its own board). */
  stages: RankedStage[];
}

export interface GhostView {
  /** The stage's #1 verified run, when the server has one for this physics version. */
  run: { name: string; score: number; timeMs: number } | null;
  /** The player's choice (persisted). */
  on: boolean;
  /** A ghost ball is in the scene. */
  racing: boolean;
}

export interface TiltReadout {
  /** Normalized to the tilt limit: ±1 per axis. */
  x: number;
  z: number;
  power: boolean;
  tooTilted: boolean;
  source: 'phone' | 'keyboard' | 'gamepad' | 'none';
}

export interface GameTestHooks {
  /** Inject a replay (InputSample[] at SIM_HZ) as the input source for the next stage played. */
  replay?: InputSample[];
  /** Force the main-thread lockstep simulation (deterministic). */
  lockstep?: boolean;
  /** Multiply real time (e2e speed-up). */
  timeScale?: number;
  /** Don't auto-pause on window blur. */
  noAutoPause?: boolean;
  /** Skip intros immediately. */
  skipIntro?: boolean;
  /** Measurement (08b): keep the free-running physics worker even with an injected replay. */
  forceWorker?: boolean;
  /**
   * Pin the engine's quality tier instead of the auto ladder. CI runners draw WebGL2 on the CPU (SwiftShader),
   * so their e2e tests pin 'low' to leave CPU for the sim and the other tests (apps/web/test/browser-env.ts).
   */
  quality?: QualitySetting;
}

export interface GameOptions {
  origin: string;
  audio: AudioManager;
  boards: GameBoards;
  /**
   * Physics driver. N (08b): `lockstep` (main thread, tick-exact; default) records the exact InputSample stream
   * the sim consumed, so score submissions carry a replay the server can verify. `worker` = Phase 05's
   * free-running worker (not tick-deterministic; its recordings are approximate and never submitted).
   */
  physics?: 'lockstep' | 'worker';
  /** From `?beat=&by=` on a `/play/:stageId` link. */
  challenge?: Challenge | null;
  reducedMotion: boolean;
  /** `/p/:code`: join this existing room as host. */
  roomCode?: string;
  /** `/play/:stageId`: start this stage right away. */
  deepLink?: string;
  /** Phase 14 `/play/local`: start this run (a capture built in the player's browser) right away. */
  localRun?: RunSource;
  forceWebGL?: boolean;
  test?: GameTestHooks;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Called with the phase whenever it changes (URL sync etc.). */
  onPhase?: (phase: GamePhase, game: Game) => void;
}

const HOWTO_KEY = 'wwm.howtoSeen';
const TUTORIAL_KEY = 'wwm.tutorialDone';
const SENS_KEY = 'wwm.sensitivity';
const PIXEL_KEY = 'wwm.pixelLook';
const GHOST_KEY = 'wwm.ghost';
const CALIBRATE_TIMEOUT_SEC = 15; // E
const CONNECTED_SHOW_SEC = 1.4; // N (2013: 4 s)
const TUTORIAL_STEP_SEC = 3; // E
const COUNTDOWN_BEAT_SEC = 0.6; // N
const MIN_BUILD_SEC = 2.2; // N (2013: ≥ 5 s)

type Timer = { at: number; fn: () => void; phase: GamePhase | null };

function clamp(v: number, lim: number) {
  return Math.max(-lim, Math.min(lim, v));
}

export class Game {
  readonly audio: AudioManager;
  readonly #opts: GameOptions;
  readonly #boards: GameBoards;
  readonly #pool = new StageBuilderPool();
  readonly #storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly #listeners = new Set<() => void>();
  #view: GameView;
  #disposed = false;

  #canvas: HTMLCanvasElement | null = null;
  #engine: Engine | null = null;
  /** Created on the first stage load (`#ensureDriver`), not at start: the title/attract needs no physics. */
  #driver: SimDriver | null = null;
  #driverKind: 'worker' | 'lockstep' = 'lockstep';
  #driverLoad: Promise<SimDriver> | null = null;
  #raf = 0;
  #lastFrame = 0;
  /** Game clock (seconds, advances only while not held). */
  #clock = 0;
  #timers: Timer[] = [];
  #cleanups: (() => void)[] = [];

  // input
  #keyboard: KeyboardInputSource | null = null;
  #gamepad: GamepadInputSource | null = null;
  #phone: PhoneInputSource | null = null;
  #conn: HostConnection | null = null;
  #lastSample: InputSample = neutralSample();
  #lastSource: TiltReadout['source'] = 'none';
  #replay: InputSample[] | null;

  // stage + run
  #run: RunSource | null = null;
  #slice = 0;
  #loaded: LoadedStage | null = null;
  #attract = false;
  #buildAbort: AbortController | null = null;
  #timer = new GameTimer();
  #timerArmed = false;
  #pendingSmall: number[] = [];
  #lastIsland: number | null = null;
  #lastIslandPos: Vec2 | null = null;
  #ballPos: [number, number, number] = [0, 0, 0];
  #stageStartTotal = 0;
  #firstStageOfVisit = true;
  #results: StageResult[] = [];
  #stateSentAt = 0;
  #stateKey = '';
  #hapticAt = 0;

  // replay recording (08b): the InputSample of every sim tick of the current stage attempt
  #rec: InputSample[] = [];
  /** Replay tick at which this stage's timer first started (contracts v0.2.6 `timerStartTick`). */
  #timerStartTick: number | undefined;
  /** The recording reproduces the attempt headlessly (lockstep, and no respawn the replay format can't express). */
  #recExact = true;
  /** Replay of each entry in `#results` that has one (same index). */
  #replays = new Map<number, VersionedReplay>();

  // link portals (Phase 13)
  /** The capture service answers `/api/health` (probed once per session when a stage has portals). */
  #api: 'unknown' | 'online' | 'offline' = 'unknown';
  #apiProbe: Promise<void> | null = null;
  /** The timer was running when the portal prompt paused it. */
  #portalTimer = false;
  #portalAt = 0;
  #prevJump = true;
  /** A declined link stays inactive for the rest of this stage. */
  #dismissedPortals = new Set<number>();
  /** A travel is building: the journey's last stop is its target. */
  #travelling = false;
  /** Test / automation: a fixed input for the next ticks (`debugRollIntoPortal`). */
  #autopilot: { sample: InputSample; ticks: number } | null = null;

  // ghost race (08b)
  #ghostTrack: GhostTrack | null = null;
  #ghostFor: string | null = null;
  #ghostBall: GhostBall | null = null;

  constructor(opts: GameOptions) {
    this.#opts = opts;
    this.audio = opts.audio;
    this.#boards = opts.boards;
    this.#storage = opts.storage ?? (typeof localStorage === 'undefined' ? memoryStorage() : localStorage);
    this.#replay = opts.test?.replay ?? null;
    const sens = Number(this.#get(SENS_KEY) ?? '1');
    this.#view = {
      phase: 'title',
      unsupported: false,
      engineReady: false,
      inputMode: null,
      room: {
        status: 'idle',
        code: opts.roomCode ?? null,
        pairToken: null,
        controllerConnected: false,
        rttMs: null,
      },
      justConnected: false,
      calibrateTimedOut: false,
      calibrateLeft: CALIBRATE_TIMEOUT_SEC,
      hold: null,
      resumedFlash: 0,
      run: null,
      build: null,
      error: null,
      timeInt: 300,
      last30: false,
      total: 0,
      spares: NUM_BALLS,
      small: 0,
      large: 0,
      largeTotal: 0,
      oneUpAt: 0,
      tutorial: null,
      countdown: null,
      introSkippable: false,
      sign: null,
      confirm: null,
      result: null,
      stageSource: null,
      ranking: null,
      ghost: { run: null, on: this.#get(GHOST_KEY) === '1', racing: false },
      challenge: opts.challenge ? { ...opts.challenge, stageId: null } : null,
      muted: opts.audio.muted,
      sensitivity: Number.isFinite(sens) && sens >= 0.5 && sens <= 1.5 ? sens : 1,
      pixelLook: this.#get(PIXEL_KEY) === '1',
      firstRun: this.#get(HOWTO_KEY) !== '1',
      portal: null,
      travel: null,
      journey: [],
    };
    this.#cleanups.push(opts.audio.onChange(() => this.#set({ muted: opts.audio.muted })));
  }

  // ── store ─────────────────────────────────────────────────────────────────────────────────────────────

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };
  getView = (): GameView => this.#view;

  #set(p: Partial<GameView>): void {
    let changed = false;
    for (const k of Object.keys(p) as (keyof GameView)[]) {
      if (this.#view[k] !== p[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.#view = { ...this.#view, ...p };
    for (const l of this.#listeners) l();
  }

  #get(k: string): string | null {
    try {
      return this.#storage.getItem(k);
    } catch {
      return null;
    }
  }
  #put(k: string, v: string): void {
    try {
      this.#storage.setItem(k, v);
    } catch {
      // storage blocked
    }
  }

  get phase(): GamePhase {
    return this.#view.phase;
  }

  get engine(): Engine | null {
    return this.#engine;
  }

  get boards(): GameBoards {
    return this.#boards;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────

  async mount(host: HTMLElement): Promise<void> {
    // A fresh canvas per engine: a disposed WebGL2 renderer loses its canvas's context (engine README).
    const canvas = document.createElement('canvas');
    canvas.className = 'wwm-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    this.#canvas = canvas;

    const kb = new KeyboardInputSource({ frameYaw: () => this.#yaw() });
    const gp = new GamepadInputSource({ frameYaw: () => this.#yaw() });
    this.#keyboard = kb;
    this.#gamepad = gp;
    this.#cleanups.push(
      kb.on('menu', () => this.#onMenuKey()),
      gp.on('menu', () => this.#onMenuKey()),
      () => kb.dispose(),
      () => gp.dispose(),
    );

    const onKey = (e: KeyboardEvent) => this.#onKeyDown(e);
    const onBlur = () => this.#autoPause();
    const onVis = () => {
      if (document.visibilityState === 'hidden') this.#autoPause();
    };
    const onResize = () => this.#resize();
    const onGesture = () => this.audio.unlock();
    addEventListener('keydown', onKey);
    addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    addEventListener('resize', onResize);
    addEventListener('pointerdown', onGesture, { capture: true });
    addEventListener('keydown', onGesture, { capture: true });
    this.#cleanups.push(() => {
      removeEventListener('keydown', onKey);
      removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('resize', onResize);
      removeEventListener('pointerdown', onGesture, { capture: true });
      removeEventListener('keydown', onGesture, { capture: true });
    });

    try {
      const engine = await createEngine({
        canvas,
        quality: this.#opts.test?.quality ?? 'auto',
        reducedMotion: this.#opts.reducedMotion,
        forceWebGL: this.#opts.forceWebGL,
        pixelLook: this.#view.pixelLook,
      });
      if (this.#disposed) {
        engine.dispose();
        return;
      }
      this.#engine = engine;
      this.#driverKind = this.#opts.test?.forceWorker
        ? 'worker'
        : this.#opts.test?.lockstep || this.#replay
          ? 'lockstep'
          : (this.#opts.physics ?? 'lockstep');
    } catch (e) {
      console.error('[wwm] engine failed to start', e);
      this.#set({ unsupported: true });
      return;
    }
    this.#resize();
    this.#set({ engineReady: true });
    this.#lastFrame = performance.now();
    this.#raf = requestAnimationFrame(this.#frame);

    if (this.#opts.roomCode) void this.#ensureRoom();
    if (this.#opts.localRun) {
      this.#set({ inputMode: this.#view.inputMode ?? 'keyboard' });
      this.#beginRun(this.#opts.localRun, 0);
    } else if (this.#opts.deepLink) void this.#openDeepLink(this.#opts.deepLink);
    else void this.#loadAttract();
  }

  /**
   * Phase 12b: Rapier (a 2 MB WASM) loads when the first stage starts building, in parallel with the build, so
   * the title/attract never downloads it. A failed load isn't cached (the stage load reports it; retry works).
   */
  #ensureDriver(): Promise<SimDriver> {
    if (!this.#driverLoad) {
      const p = createDriver(this.#driverKind).then((d) => {
        if (this.#disposed) {
          d.dispose();
          throw new Error('game disposed');
        }
        this.#driver = d;
        return d;
      });
      p.catch(() => {
        if (this.#driverLoad === p) this.#driverLoad = null;
      });
      this.#driverLoad = p;
    }
    return this.#driverLoad;
  }

  dispose(): void {
    this.#disposed = true;
    cancelAnimationFrame(this.#raf);
    this.#buildAbort?.abort();
    for (const c of this.#cleanups) c();
    this.#cleanups = [];
    this.#phone?.dispose();
    this.#conn?.close();
    this.#ghostBall?.dispose();
    this.#ghostBall = null;
    this.#driver?.dispose();
    this.#engine?.dispose();
    this.#pool.dispose();
    this.#engineImage?.close();
    this.#canvas?.remove();
    this.audio.setMusic(null);
    this.#listeners.clear();
  }

  /** The bitmap the engine currently textures from (single-tile stages use it directly); close the old one. */
  #engineImage: ImageBitmap | null = null;
  #setEngineImage(img: ImageBitmap): void {
    const prev = this.#engineImage;
    this.#engineImage = img;
    if (prev && prev !== img) prev.close();
  }

  #resize(): void {
    const c = this.#canvas;
    if (!c || !this.#engine) return;
    this.#engine.resize(c.clientWidth || innerWidth, c.clientHeight || innerHeight);
  }

  #yaw(): number {
    return this.#engine?.cameraYaw() ?? 0;
  }

  // ── machine ───────────────────────────────────────────────────────────────────────────────────────────

  #send(ev: GameEvent): boolean {
    const from = this.#view.phase;
    const to = transition(from, ev);
    if (!to) return false;
    // Timers scoped to the phase we leave are dropped.
    this.#timers = this.#timers.filter((t) => t.phase === null || t.phase === to);
    this.#set({ phase: to });
    this.#enter(to, from);
    this.#opts.onPhase?.(to, this);
    this.#syncController(true);
    return true;
  }

  /** Run `fn` after `sec` of game time, cancelled if the phase changes (unless `phase` is null). */
  #after(sec: number, fn: () => void, phase: GamePhase | null = this.#view.phase): void {
    this.#timers.push({ at: this.#clock + sec, fn, phase });
  }

  #music(track: Bgm | null) {
    this.audio.setMusic(track);
  }

  #enter(to: GamePhase, from: GamePhase): void {
    const e = this.#engine;
    const d = this.#driver;
    switch (to) {
      case 'title':
        this.#endGhost();
        this.#resetSession();
        this.#set({
          confirm: null,
          sign: null,
          result: null,
          ranking: null,
          error: null,
          tutorial: null,
          portal: null,
          travel: null,
        });
        d?.setPaused(true);
        this.#music('opening');
        void this.#loadAttract();
        break;
      case 'howto':
        this.#put(HOWTO_KEY, '1');
        this.#set({ firstRun: false });
        break;
      case 'pairing':
        this.#set({ justConnected: false });
        void this.#ensureRoom();
        break;
      case 'calibrate':
        this.#set({ calibrateTimedOut: false, calibrateLeft: CALIBRATE_TIMEOUT_SEC });
        this.#after(CALIBRATE_TIMEOUT_SEC, () => this.#set({ calibrateTimedOut: true }));
        break;
      case 'select':
        this.#endGhost();
        this.#set({
          confirm: null,
          sign: null,
          error: null,
          tutorial: null,
          build: null,
          portal: null,
          travel: null,
        });
        d?.setPaused(true);
        this.#music('opening');
        if (IN_STAGE.has(from) && e) e.setView('map');
        break;
      case 'building':
        this.#endGhost();
        this.#set({ confirm: null, sign: null, result: null, tutorial: null });
        d?.setPaused(true);
        break;
      case 'intro':
        this.#set({ travel: null, portal: null });
        this.#startIntro();
        break;
      case 'countdown':
        this.#set({ countdown: 3 });
        this.audio.play('tick');
        this.#after(COUNTDOWN_BEAT_SEC, () => {
          this.#set({ countdown: 2 });
          this.audio.play('tick');
          this.#after(COUNTDOWN_BEAT_SEC, () => {
            this.#set({ countdown: 1 });
            this.audio.play('tick');
            this.#after(COUNTDOWN_BEAT_SEC, () => {
              this.#set({ countdown: 0 });
              this.audio.play('go');
              this.#send({ type: 'GO' });
            });
          });
        });
        break;
      case 'play':
        if (from === 'countdown') this.#after(0.7, () => this.#set({ countdown: null }), null);
        else this.#set({ countdown: null });
        this.#set({ confirm: null });
        e?.setView('chase');
        d?.setPaused(false);
        // E: the timer starts on entering GAME, except on the first game where the first POWER starts it.
        if (!this.#timerArmed) {
          if (this.#timerStartTick === undefined) this.#timerStartTick = this.#rec.length;
          this.#timer.start();
        }
        this.#music(this.#timer.remainsInt <= 30 ? 'timeup' : 'game');
        if (from === 'intro' || from === 'countdown') this.#startGhost();
        break;
      case 'paused':
        this.#set({ portal: null });
        this.#timer.stop();
        d?.setPaused(true);
        e?.setView('map');
        this.audio.setRoll(0, false);
        break;
      case 'falling':
        this.#timer.stop();
        this.audio.play('fall');
        this.#haptic('fall');
        break;
      case 'restarting':
        this.#restart();
        break;
      case 'timeup':
        d?.setPaused(true);
        this.audio.setRoll(0, false);
        break;
      case 'goal':
        this.#goal();
        break;
      case 'gameover':
        this.#gameOver(from);
        break;
      case 'result':
        this.#endGhost();
        this.#music('result');
        break;
      case 'ranking':
        void this.#openRanking();
        break;
      case 'error':
        this.#set({ travel: null, portal: null });
        d?.setPaused(true);
        this.#music('opening');
        break;
    }
  }

  // ── title / attract ───────────────────────────────────────────────────────────────────────────────────

  async #loadAttract(): Promise<void> {
    const e = this.#engine;
    if (!e || this.#attract || this.#loaded) return;
    this.#attract = true;
    try {
      const entry = catalogEntry(ATTRACT_ID) ?? PRACTICE;
      const run = entry === PRACTICE ? new PracticeRun() : new FixtureRun(entry, this.#pool);
      const got = await run.loadSlice(0, () => {});
      if (this.#disposed || this.#view.phase !== 'title' || this.#loaded) {
        got.image.close();
        return;
      }
      await e.loadStage(got.stage, got.image);
      this.#setEngineImage(got.image);
      e.setView('map');
    } catch (err) {
      console.warn('[wwm] attract stage failed', err);
    }
  }

  // ── pairing ───────────────────────────────────────────────────────────────────────────────────────────

  async #ensureRoom(): Promise<void> {
    if (this.#conn || this.#view.room.status === 'creating') return;
    this.#set({ room: { ...this.#view.room, status: 'creating' } });
    try {
      const { code, conn, pairToken } = await openHostRoom(
        this.#opts.origin || location.origin,
        this.#opts.roomCode,
      );
      if (this.#disposed) {
        conn.close();
        return;
      }
      this.#conn = conn;
      const phone = new PhoneInputSource(conn, { frameYaw: () => this.#yaw() });
      this.#phone = phone;
      this.#set({
        room: { status: 'ready', code, pairToken, controllerConnected: conn.peerConnected, rttMs: null },
      });
      this.#cleanups.push(
        conn.on('peer', (role, connected) => {
          if (role === 'controller') this.#onControllerPresence(connected);
        }),
        conn.on('error', () => this.#set({ room: { ...this.#view.room, status: 'error' } })),
        conn.on('rtt', () => {
          const s = conn.rtt.summary();
          if (s.p50 !== null) this.#set({ room: { ...this.#view.room, rttMs: Math.round(s.p50) } });
        }),
        conn.on('message', (m) => {
          if (m.t === 'calibrated' && this.#view.phase === 'calibrate') {
            this.audio.play('connected');
            this.#send({ type: 'CALIBRATED' });
          }
        }),
        phone.on('menu', () => this.#onMenuKey()),
        phone.on('connected', () => this.#onControllerPresence(true)),
        phone.on('disconnected', () => this.#onControllerPresence(false)),
      );
    } catch (err) {
      console.warn('[wwm] room unavailable', err);
      this.#set({
        room: { status: 'error', code: null, pairToken: null, controllerConnected: false, rttMs: null },
      });
    }
  }

  #onControllerPresence(connected: boolean): void {
    const was = this.#view.room.controllerConnected;
    this.#set({ room: { ...this.#view.room, controllerConnected: connected } });
    if (connected && !was) {
      if (this.#view.phase === 'pairing' && !this.#view.justConnected) {
        this.audio.play('connected');
        this.#set({ justConnected: true, inputMode: 'phone' });
        this.#after(CONNECTED_SHOW_SEC, () => this.#send({ type: 'PAIRED' }));
      }
      if (this.#view.hold) {
        this.#set({ hold: null, resumedFlash: this.#clock });
        this.audio.play('connected');
      }
    }
  }

  retryRoom(): void {
    this.#conn?.close();
    this.#conn = null;
    this.#phone?.dispose();
    this.#phone = null;
    this.#set({
      room: { status: 'idle', code: null, pairToken: null, controllerConnected: false, rttMs: null },
    });
    void this.#ensureRoom();
  }

  // ── actions (UI) ──────────────────────────────────────────────────────────────────────────────────────

  start(): void {
    if (this.#view.phase === 'title') telemetry.track({ name: 'start_clicked' });
    this.audio.unlock();
    this.audio.play('click');
    const ready = this.#view.inputMode === 'keyboard' || this.#view.room.controllerConnected;
    this.#send({ type: 'START', howtoSeen: this.#get(HOWTO_KEY) === '1', ready });
  }

  howtoDone(): void {
    this.audio.play('click');
    this.#send({ type: 'HOWTO_DONE' });
  }

  back(): void {
    this.audio.play('click');
    this.#buildAbort?.abort();
    this.#send({ type: 'BACK' });
  }

  /** E: "No smartphone? Play with PC only" (also the calibration-timeout fallback and the disconnect overlay). */
  playKeyboard(): void {
    this.audio.play('click');
    this.#set({ inputMode: 'keyboard', hold: null });
    this.#send({ type: 'KEYBOARD' });
  }

  retryCalibrate(): void {
    this.#set({ calibrateTimedOut: false, calibrateLeft: CALIBRATE_TIMEOUT_SEC });
    this.#timers = this.#timers.filter((t) => t.phase !== 'calibrate');
    this.#after(CALIBRATE_TIMEOUT_SEC, () => this.#set({ calibrateTimedOut: true }));
    this.#syncController(true);
  }

  chooseEntry(entry: CatalogEntry): void {
    telemetry.track({ name: 'stage_selected', run: entry === PRACTICE ? 'practice' : 'fixture' });
    this.audio.unlock();
    this.audio.play('click');
    const run = entry === PRACTICE ? new PracticeRun() : new FixtureRun(entry, this.#pool);
    this.#beginRun(run, 0);
  }

  /** Build any public URL through the capture service. */
  chooseUrl(url: string): void {
    telemetry.track({ name: 'stage_selected', run: 'api' });
    this.audio.unlock();
    this.audio.play('click');
    this.#buildAbort?.abort();
    const ac = new AbortController();
    this.#buildAbort = ac;
    if (!this.#send({ type: 'CHOOSE' })) return;
    this.#set({ run: null, build: { step: 'queued', pct: 2, label: url } });
    const t0 = this.#clock;
    createApiRun(this.#opts.origin, url, (p) => this.#progress(p.step, p.pct), ac.signal).then(
      (run) => {
        if (ac.signal.aborted) return;
        this.#run = run;
        this.#slice = 0;
        void this.#loadSlice(ac, t0);
      },
      (err) => this.#buildFailed(err, url, ac),
    );
  }

  cancelBuild(): void {
    this.back();
  }

  skipIntro(): void {
    if (this.#view.phase !== 'intro' || !this.#view.introSkippable) return;
    this.#engine?.skipIntro();
  }

  menu(): void {
    this.#onMenuKey();
  }

  resume(): void {
    this.audio.play('click');
    this.#set({ confirm: null });
    this.#send({ type: 'RESUME' });
  }

  retryStage(): void {
    this.audio.play('click');
    if (!this.#run || !this.#loaded) return;
    telemetry.track({ name: 'stage_restarted' });
    // N: retry gives the stage back from its start; points earned on it are removed.
    this.#set({ total: this.#stageStartTotal });
    const loaded = this.#loaded;
    if (!this.#send({ type: 'RETRY' })) return;
    void this.#playLoaded(loaded, new AbortController(), this.#clock);
  }

  askConfirm(kind: 'quit' | 'search'): void {
    this.audio.play('click');
    this.#set({ confirm: kind });
  }

  confirm(yes: boolean): void {
    const kind = this.#view.confirm;
    this.audio.play('click');
    this.#set({ confirm: null });
    if (!yes || !kind) return;
    this.#send({ type: kind === 'quit' ? 'QUIT' : 'SEARCH' });
  }

  /** Result: next slice of this page, or back to site select after the last one (score and spares kept). */
  next(): void {
    telemetry.track({ name: 'next_selected' });
    this.audio.play('click');
    const run = this.#run;
    const more = !!run && this.#slice + 1 < run.sliceCount();
    if (!this.#send({ type: 'NEXT', more })) return;
    if (more && run) {
      this.#slice++;
      const ac = new AbortController();
      this.#buildAbort = ac;
      this.#set({ build: { step: 'building', pct: 5, label: run.title } });
      void this.#loadSlice(ac, this.#clock);
    }
  }

  finish(): void {
    this.audio.play('click');
    this.#send({ type: 'FINISH' });
  }

  /**
   * E: the session total goes to the ranking with a name (skip = not submitted). N: every cleared stage also goes
   * to its own board, with the replay recorded from the sim when it is exact (contracts §9 VersionedReplay).
   */
  async submitName(raw: string): Promise<SubmitResult> {
    const name = sanitizeName(raw);
    const r = this.#view.ranking;
    if (!name || !r || r.submitted || !r.source)
      return { ok: false, error: 'name', message: 'nothing to submit' };
    this.audio.play('click');
    const stages = this.#results.map((s) => ({ stageId: s.stageId, score: s.stageScore, timeMs: s.timeMs }));
    const runIds = new Set(this.#results.map((x) => x.runId));
    const runId = runIds.size === 1 && this.#run?.kind === 'api' ? [...runIds][0] : undefined;
    const res = await this.#boards.submitRun(
      {
        ...(runId ? { runId } : {}),
        name,
        totalScore: stages.reduce((a, s) => a + s.score, 0),
        stages,
      },
      r.source,
    );
    if (!res.ok) return res;
    const ranked = await Promise.all(
      r.stages.map(async (st) => {
        const i = st.resultIndex;
        const s = this.#results[i];
        if (!s) return st;
        const replay = this.#replays.get(i);
        const sr = await this.#boards.submitStage(
          { stageId: s.stageId, name, score: s.stageScore, timeMs: s.timeMs, ...(replay ? { replay } : {}) },
          st.source,
        );
        return sr.ok
          ? {
              ...st,
              rank: sr.rank,
              verified: sr.verified,
              stored: sr.stored ?? st.source,
              ...(sr.scoreId ? { scoreId: sr.scoreId } : {}),
            }
          : { ...st, rank: null, verified: false, stored: null };
      }),
    );
    const cur = this.#view.ranking ?? r;
    this.#set({
      ranking: {
        ...cur,
        rank: res.rank,
        submitted: true,
        name,
        stored: res.stored ?? r.source,
        ...(res.ok && res.scoreId ? { scoreId: res.scoreId } : {}),
        stages: ranked,
      },
    });
    return res;
  }

  /** E: "skip" leaves the ranking without submitting. */
  skipRanking(): void {
    const r = this.#view.ranking;
    if (r && !r.submitted) this.#set({ ranking: { ...r, skipped: true } });
  }

  newGame(): void {
    this.audio.play('click');
    this.#resetSession();
    this.#send({ type: 'NEW_GAME' });
  }

  toTitle(): void {
    this.audio.play('click');
    this.#buildAbort?.abort();
    this.#send({ type: 'TITLE' }) || this.#send({ type: 'QUIT' });
  }

  errorBack(): void {
    this.audio.play('click');
    this.#send({ type: 'BACK' });
  }

  setMuted(m: boolean): void {
    this.audio.unlock();
    this.audio.setMuted(m);
  }

  setSensitivity(s: number): void {
    const v = Math.max(0.5, Math.min(1.5, s));
    this.#put(SENS_KEY, String(v));
    this.#set({ sensitivity: v });
  }

  setPixelLook(on: boolean): void {
    this.#put(PIXEL_KEY, on ? '1' : '0');
    this.#engine?.setPixelLook(on);
    this.#set({ pixelLook: on });
  }

  /** Tilt for the HUD / calibration indicator (read every animation frame; not part of the view). */
  tilt(): TiltReadout {
    const s = this.#lastSample;
    const phone = this.#phone;
    let x = s.tiltX / MAX_TILT_ROLL;
    let z = s.tiltZ / MAX_TILT_PITCH;
    let src = this.#lastSource;
    if (phone && this.#view.inputMode !== 'keyboard' && src !== 'keyboard' && src !== 'gamepad') {
      const raw = phone.debug(performance.now()).raw;
      if (raw) {
        x = raw.tiltX / MAX_TILT_ROLL;
        z = raw.tiltZ / MAX_TILT_PITCH;
        src = 'phone';
      }
    }
    const tooTilted = src === 'phone' && (Math.abs(x) > 0.985 || Math.abs(z) > 0.985);
    return { x, z, power: s.power, tooTilted, source: src };
  }

  shareUrl(): string {
    const ref = this.#loaded?.ref ?? this.#run?.id ?? '';
    return `${location.origin}/play/${ref}`;
  }

  // ── ghost race (08b) ──────────────────────────────────────────────────────────────────────────────────

  /** "Race the #1 run": the player's choice, persisted. Takes effect when play starts. */
  setGhost(on: boolean): void {
    this.audio.play('click');
    this.#put(GHOST_KEY, on ? '1' : '0');
    this.#set({ ghost: { ...this.#view.ghost, on } });
    if (!on) this.#endGhost();
    else if (this.#view.phase === 'play') this.#startGhost();
  }

  async #fetchGhost(stage: StageData): Promise<void> {
    const id = stage.stageId;
    this.#ghostFor = id;
    this.#ghostTrack = null;
    this.#set({ ghost: { ...this.#view.ghost, run: null } });
    const run = await this.#boards.ghost(id);
    // A replay only reproduces on the physics build it was recorded with.
    if (!run || run.physicsVersion !== PHYSICS_VERSION || this.#ghostFor !== id || !run.inputs.length) return;
    try {
      const track = await recordGhostTrack(stage, run.inputs);
      if (this.#ghostFor !== id || this.#disposed) return;
      this.#ghostTrack = track;
      this.#set({
        ghost: { ...this.#view.ghost, run: { name: run.name, score: run.score, timeMs: run.timeMs } },
      });
      if (this.#view.phase === 'play') this.#startGhost();
    } catch (err) {
      console.info('[wwm] ghost unavailable', err);
    }
  }

  #startGhost(): void {
    const e = this.#engine;
    const track = this.#ghostTrack;
    if (!e || !track || !this.#view.ghost.on || this.#ghostBall || this.#ghostFor !== this.#stage()?.stageId)
      return;
    this.#ghostBall = createGhostBall(e, track, { color: 0x4f9fd6, opacity: 0.3, look: 'holo' });
    this.#ghostBall.update((this.#driver?.tick ?? 0) / SIM_HZ);
    this.#set({ ghost: { ...this.#view.ghost, racing: true } });
  }

  #endGhost(): void {
    if (!this.#ghostBall) return;
    this.#ghostBall.dispose();
    this.#ghostBall = null;
    this.#set({ ghost: { ...this.#view.ghost, racing: false } });
  }

  // ── building ──────────────────────────────────────────────────────────────────────────────────────────

  #beginRun(run: RunSource, slice: number): void {
    this.#buildAbort?.abort();
    const ac = new AbortController();
    this.#buildAbort = ac;
    if (!this.#send({ type: 'CHOOSE' })) return;
    this.#run = run;
    this.#slice = slice;
    this.#set({ build: { step: 'extracting', pct: 3, label: run.title } });
    void this.#loadSlice(ac, this.#clock);
  }

  async #openDeepLink(ref: string): Promise<void> {
    this.#set({ inputMode: this.#view.inputMode ?? 'keyboard' });
    try {
      const { run, slice } = await runFromRef(ref, this.#opts.origin, this.#pool);
      telemetry.track({ name: 'stage_selected', run: analyticsRun(run.kind) });
      this.#beginRun(run, slice);
    } catch (err) {
      this.#send({ type: 'CHOOSE' });
      this.#buildFailed(err, ref, new AbortController());
    }
  }

  #progress(step: string, pct: number): void {
    const b = this.#view.build;
    this.#set({ build: { step, pct: Math.max(b?.pct ?? 0, pct), label: b?.label ?? '' } });
  }

  async #loadSlice(ac: AbortController, t0: number): Promise<void> {
    const run = this.#run;
    if (!run) return;
    this.#set({
      run: {
        id: run.id,
        kind: run.kind,
        title: run.title,
        url: run.url,
        index: this.#slice,
        count: run.sliceCount(),
      },
    });
    // start loading physics now, alongside the stage build (errors surface in #playLoaded)
    this.#ensureDriver().catch(() => {});
    let got: LoadedStage;
    try {
      got = await run.loadSlice(this.#slice, (p) => this.#progress(p.step, p.pct), ac.signal);
    } catch (err) {
      this.#buildFailed(err, run.url, ac);
      return;
    }
    if (ac.signal.aborted || this.#disposed) {
      got.image.close();
      return;
    }
    this.#loaded = got;
    await this.#playLoaded(got, ac, t0);
  }

  async #playLoaded(got: LoadedStage, ac: AbortController, t0: number): Promise<void> {
    const e = this.#engine;
    const run = this.#run;
    if (!e || !run) return;
    this.#progress('world', 94);
    this.#endGhost();
    let d: SimDriver;
    try {
      this.#attract = false;
      const loadSim = async () => {
        const sim = await this.#ensureDriver();
        await sim.load(got.stage);
        return sim;
      };
      [, d] = await Promise.all([e.loadStage(got.stage, got.image), loadSim()]);
      this.#setEngineImage(got.image);
    } catch (err) {
      this.#buildFailed(new StageLoadError('BUILD_FAILED', String(err)), run.url, ac);
      return;
    }
    if (ac.signal.aborted || this.#disposed || this.#view.phase !== 'building') return;
    // A fresh recording per attempt: tick 0 is the first step after load (08b).
    this.#rec = [];
    this.#timerStartTick = undefined;
    this.#recExact = d.kind === 'lockstep';
    const stageId = got.stage.stageId;
    const ch = this.#view.challenge;
    if (ch && ch.stageId === null) this.#set({ challenge: { ...ch, stageId } });
    const source = this.#boards.whereStage(stageId, run.kind === 'api');
    this.#set({ stageSource: source });
    if (source === 'server' && (this.#ghostFor !== stageId || !this.#ghostTrack))
      void this.#fetchGhost(got.stage);
    else if (source !== 'server') {
      this.#ghostFor = null;
      this.#ghostTrack = null;
      this.#set({ ghost: { ...this.#view.ghost, run: null } });
    }
    this.#set({
      run: {
        id: run.id,
        kind: run.kind,
        title: run.kind === 'practice' ? run.title : got.stage.source.title || run.title,
        url: got.stage.source.url || run.url,
        index: this.#slice,
        count: run.sliceCount(),
        stageId,
      },
    });
    this.#recordStop(got.stage, run);
    this.#dismissedPortals.clear();
    this.#applyPortalStates(got.stage);
    this.#progress('world', 100);
    const wait = Math.max(0, MIN_BUILD_SEC - (this.#clock - t0));
    this.#after(wait, () => this.#send({ type: 'BUILT' }));
  }

  #buildFailed(err: unknown, url: string, ac: AbortController): void {
    if (ac.signal.aborted) return;
    if (this.#travelling) {
      // the linked site never became a stop of the journey
      this.#travelling = false;
      this.#set({ journey: this.#view.journey.slice(0, -1) });
    }
    const code: LoadErrorCode = err instanceof StageLoadError ? err.code : 'BUILD_FAILED';
    const message = err instanceof Error ? err.message : String(err);
    this.#set({ error: { code, message, url } });
    this.#send({ type: 'BUILD_FAILED' });
  }

  // ── stage lifecycle ───────────────────────────────────────────────────────────────────────────────────

  #stage(): StageData | null {
    return this.#loaded?.stage ?? null;
  }

  #startIntro(): void {
    const e = this.#engine;
    const stage = this.#stage();
    if (!e || !stage) return;
    this.#timer.reset(stage.timeLimitSec);
    const { largeTotal } = countItems(stage);
    const firstGame = this.#get(TUTORIAL_KEY) !== '1';
    this.#timerArmed = firstGame && !this.#replay;
    this.#pendingSmall = [];
    this.#lastIsland = null;
    this.#lastIslandPos = null;
    this.#stageStartTotal = this.#view.total;
    this.#set({
      timeInt: this.#timer.remainsInt,
      last30: false,
      small: 0,
      large: 0,
      largeTotal,
      sign: null,
      result: null,
      tutorial: null,
      introSkippable: false,
    });
    this.#music('opening');
    const mode = this.#firstStageOfVisit ? 'full' : 'fast';
    this.#firstStageOfVisit = false;
    const done = e.playIntro({ mode });
    this.#after(0.4, () => this.#set({ introSkippable: true }));
    if (this.#opts.test?.skipIntro) this.#after(0.05, () => e.skipIntro());
    void done.then(() => {
      if (this.#view.phase !== 'intro') return;
      const tutorial = firstGame && !this.#replay;
      if (tutorial) this.#set({ tutorial: 2 });
      this.#send({ type: 'INTRO_DONE', countdown: !tutorial });
      if (tutorial)
        this.#after(
          TUTORIAL_STEP_SEC,
          () => {
            if (this.#view.tutorial === 2 && IN_STAGE.has(this.#view.phase)) this.#set({ tutorial: 3 });
          },
          null,
        );
    });
  }

  #tutorialAdvance(step: TutorialStep): void {
    if (!IN_STAGE.has(this.#view.phase)) {
      this.#set({ tutorial: null });
      return;
    }
    this.#set({ tutorial: step });
    if (step === 6) {
      this.#put(TUTORIAL_KEY, '1');
      this.#after(TUTORIAL_STEP_SEC, () => this.#view.tutorial === 6 && this.#set({ tutorial: null }), null);
    } else if (step >= 4) {
      this.#after(TUTORIAL_STEP_SEC, () => this.#tutorialAdvance((step + 1) as TutorialStep), null);
    }
  }

  #credit(points: number): void {
    const r = addScore({ total: this.#view.total, spares: this.#view.spares }, points);
    this.#set({ total: r.total, spares: r.spares });
    if (r.oneUps > 0) {
      this.audio.play('oneup');
      this.#set({ oneUpAt: this.#clock });
    }
  }

  #haptic(pattern: HapticPattern): void {
    if (!this.#conn || this.#view.inputMode !== 'phone') return;
    const now = performance.now();
    if (pattern === 'item' && now - this.#hapticAt < 90) return;
    this.#hapticAt = now;
    this.#conn.send({ t: 'haptic', pattern });
  }

  /** Sim event routing: rules, engine, audio, haptics. Returns true to stop stepping this frame. */
  #onSimEvent = (ev: SimEvent): boolean => {
    const e = this.#engine;
    switch (ev.type) {
      case 'item':
        e?.handleEvent(ev);
        if (ev.kind === 'small') {
          this.#set({ small: this.#view.small + 1 });
          this.#pendingSmall.push(this.#clock + SMALL_CREDIT_DELAY_SEC);
          this.audio.play('item');
          this.#haptic('item');
        } else {
          this.#set({ large: this.#view.large + 1 });
          this.#credit(LARGE_SCORE);
          this.audio.play('large');
          this.#haptic('large');
        }
        return false;
      case 'goal':
        if (this.#view.phase === 'play') this.#send({ type: 'GOAL' });
        return true;
      case 'fell':
        e?.handleEvent(ev);
        if (this.#view.phase === 'play') {
          this.#fellAt = ev.restartAt;
          this.#send({ type: 'FELL' });
        }
        return true;
      case 'lost':
        e?.handleEvent(ev);
        // 08b: stop stepping until the respawn, so the recorded ticks match @wwm/physics replay(), which
        // resets to the restart point on the tick after 'lost' (elevators would drift otherwise).
        this.#driver?.setPaused(true);
        this.audio.play('splash');
        if (this.#view.phase === 'falling') {
          const spares = this.#view.spares - 1;
          this.#set({ spares });
          this.#after(RESTART_DELAY_SEC, () => this.#send({ type: 'LOST', spares }));
        }
        return true;
      case 'island':
        this.#lastIsland = ev.islandId;
        this.#lastIslandPos = worldToPage(this.#ballPos);
        return false;
      case 'elevator':
        if (ev.phase === 'start') this.audio.play('elevator');
        return false;
      case 'portal':
        if (
          this.#view.phase === 'play' &&
          !this.#view.portal &&
          !this.#view.travel &&
          !this.#dismissedPortals.has(ev.portalId)
        ) {
          this.#openPortal(ev.portalId);
          return true;
        }
        return false;
      case 'landed':
        e?.handleEvent(ev);
        this.audio.impact('land', ev.impact);
        return false;
      case 'bump':
        this.audio.impact('bump', ev.impact);
        return false;
      default:
        return false;
    }
  };

  #fellAt: Vec2 | null = null;

  #restart(): void {
    const e = this.#engine;
    const d = this.#driver;
    const stage = this.#stage();
    if (!e || !d || !stage) return;
    d.setPaused(true);
    const at = this.#fellAt ?? restartPointFor(stage, this.#lastIsland, this.#lastIslandPos);
    this.#fellAt = null;
    d.reset(at);
    // E: RESTARTING resets the timer to the full limit.
    this.#timer.reset(stage.timeLimitSec);
    this.#timerArmed = false;
    this.#set({ timeInt: this.#timer.remainsInt, last30: false, sign: null });
    this.#music('game');
    void e.spawnBall(at).then(() => {
      if (this.#view.phase === 'restarting') this.#send({ type: 'SPAWNED' });
    });
  }

  #goal(): void {
    const e = this.#engine;
    this.#driver?.setPaused(true);
    this.#timer.stop();
    this.audio.setRoll(0, false);
    this.audio.play('getGoal');
    this.#haptic('goal');
    this.#music(null);
    // Items picked up in the last 300 ms still count.
    for (const _ of this.#pendingSmall) this.#credit(SMALL_SCORE);
    this.#pendingSmall = [];
    const n = fireworksCount(this.#timer.remains);
    const shown = () => {
      if (this.#view.phase !== 'goal') return;
      this.audio.play('goal');
      this.#set({ sign: 'goal' });
      this.#after(GOAL_SIGN_SEC + 0.6, () => {
        this.#finishStage(true);
        this.#send({ type: 'GOAL_DONE' });
      });
    };
    let fired = 0;
    const fw = () => {
      if (fired++ < n && this.#view.phase === 'goal') {
        this.audio.play('firework', { gain: 0.7, rate: 0.85 + fired * 0.04 });
        this.#after(0.45, fw);
      }
    };
    this.#after(1.1, fw);
    if (e) void e.playGoal(n).then(shown);
    else shown();
  }

  #finishStage(cleared: boolean, exit?: 'portal'): void {
    const stage = this.#stage();
    const run = this.#run;
    if (!stage || !run) return;
    const v = this.#view;
    const totalBefore = v.total;
    const f = finishStage(
      { total: v.total, spares: v.spares },
      {
        timeInt: this.#timer.remainsInt,
        small: v.small,
        large: v.large,
        cleared,
      },
    );
    const result: StageResult = {
      stageId: stage.stageId,
      title: run.kind === 'practice' ? run.title : stage.source.title || run.title,
      url: stage.source.url || run.url,
      sliceIndex: this.#slice,
      sliceCount: run.sliceCount(),
      cleared,
      timeInt: this.#timer.remainsInt,
      timeBonus: f.bonus,
      small: v.small,
      large: v.large,
      stageScore: f.stageScore,
      totalBefore,
      total: f.score.total,
      oneUps: f.score.oneUps,
      timeMs: Math.round(((this.#driver?.tick ?? 0) * 1000) / SIM_HZ),
      ref: this.#loaded?.ref ?? run.id,
      runId: run.id,
      fromServer: run.kind === 'api',
      ...(exit ? { exit } : {}),
    };
    this.#results.push(result);
    if (cleared && this.#recExact && this.#rec.length > 0)
      this.#replays.set(this.#results.length - 1, {
        physicsVersion: PHYSICS_VERSION,
        inputs: this.#rec,
        ...(this.#timerStartTick !== undefined ? { timerStartTick: this.#timerStartTick } : {}),
      });
    this.#rec = [];
    this.#timerStartTick = undefined;
    this.#set({ result, total: f.score.total, spares: f.score.spares, sign: null });
  }

  #gameOver(from: GamePhase): void {
    this.#driver?.setPaused(true);
    this.audio.setRoll(0, false);
    this.#music('over');
    this.#finishStage(false);
    const next = () => this.#send({ type: 'SIGN_DONE', spares: -1 });
    if (from === 'timeup') {
      // the TIME IS UP phase already showed "GAME OVER" (E)
      this.#after(0.2, next);
    } else {
      this.#set({ sign: 'gameover' });
      this.#after(SIGN_SEC, next);
    }
  }

  async #openRanking(): Promise<void> {
    const total = this.#view.total;
    const cleared = this.#results.flatMap((x, i) => (x.cleared ? [{ x, i }] : []));
    this.#set({
      ranking: {
        rank: null,
        total,
        source: null,
        submitted: false,
        skipped: false,
        name: null,
        stored: null,
        stages: [],
      },
    });
    this.#music('result');
    const source = this.#boards.whereRun(this.#results);
    const stageSources = cleared.map(({ x }) => this.#boards.whereStage(x.stageId, x.fromServer));
    // The server takes each stage once per run (the same site played twice in one session stays on this device).
    const unique = new Set(this.#results.map((x) => x.stageId)).size === this.#results.length;
    const runSource: BoardSource = unique ? source : 'device';
    const stages: RankedStage[] = cleared.map(({ x, i: resultIndex }, i) => ({
      resultIndex,
      stageId: x.stageId,
      title: x.title,
      sliceIndex: x.sliceIndex,
      sliceCount: x.sliceCount,
      score: x.stageScore,
      source: stageSources[i] ?? 'device',
      rank: null,
      verified: false,
      stored: null,
    }));
    let r = this.#view.ranking;
    if (!r || r.submitted || this.#view.phase !== 'ranking') return;
    this.#set({ ranking: { ...r, source: runSource, stages } });
    const rank = await this.#boards.rankFor(total, runSource);
    r = this.#view.ranking;
    if (r && !r.submitted) this.#set({ ranking: { ...r, rank } });
  }

  #resetSession(): void {
    this.#results = [];
    this.#replays.clear();
    this.#travelling = false;
    this.#dismissedPortals.clear();
    this.#set({
      total: 0,
      spares: NUM_BALLS,
      result: null,
      ranking: null,
      journey: [],
      portal: null,
      travel: null,
    });
  }

  // ── link portals (Phase 13) ───────────────────────────────────────────────────────────────────────────

  /** Once per session: can the capture service build a linked site? (`?offline=1` = no.) */
  #probeApi(): Promise<void> {
    this.#apiProbe ??= (async () => {
      if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('offline')) {
        this.#api = 'offline';
        return;
      }
      try {
        const r = await fetch(`${this.#opts.origin}/api/health`, { signal: AbortSignal.timeout(5000) });
        const j = r.ok ? ((await r.json()) as { ok?: boolean }) : null;
        this.#api = j?.ok ? 'online' : 'offline';
      } catch {
        this.#api = 'offline';
      }
    })();
    return this.#apiProbe;
  }

  /** Portals the service can't reach are shown greyed out (fixture targets travel offline). */
  #applyPortalStates(stage: StageData): void {
    const portals = stage.portals ?? [];
    if (portals.length === 0) return;
    const apply = () => {
      if (this.#stage() !== stage) return;
      for (const p of portals)
        this.#engine?.setPortalState(
          p.id,
          this.#dismissedPortals.has(p.id)
            ? 'used'
            : this.#api === 'offline' && !fixtureFor(p.href)
              ? 'offline'
              : 'open',
        );
    };
    apply();
    void this.#probeApi().then(apply);
  }

  /** Every site played becomes a stop; a portal travel already added its target, which now gets its ref. */
  #recordStop(stage: StageData, run: RunSource): void {
    if (run.kind === 'practice') return;
    const url = stage.source.url || run.url;
    const stop: JourneyStop = {
      host: hostOf(url) || run.title,
      title: stage.source.title || run.title,
      url,
      ref: this.#slice === 0 ? (this.#loaded?.ref ?? null) : null,
      via: 'start',
    };
    const j = this.#view.journey;
    const last = j[j.length - 1];
    if (this.#travelling && last) {
      this.#travelling = false;
      this.#set({
        journey: [...j.slice(0, -1), { ...last, ...stop, title: last.title || stop.title, via: 'portal' }],
      });
      return;
    }
    if (last && (last.url === url || this.#slice > 0)) {
      if (!last.ref && stop.ref) this.#set({ journey: [...j.slice(0, -1), { ...last, ref: stop.ref }] });
      return;
    }
    this.#set({ journey: [...j, { ...stop, via: j.length === 0 ? 'start' : 'select' }] });
  }

  #openPortal(id: number): void {
    if (this.#dismissedPortals.has(id)) return;
    const p = this.#stage()?.portals?.find((x) => x.id === id);
    if (!p) return;
    this.#engine?.handleEvent({ type: 'portal', portalId: id });
    this.#driver?.setPaused(true);
    this.#portalTimer = this.#timer.running;
    this.#timer.stop();
    this.#portalAt = this.#clock;
    this.#prevJump = true; // a held JUMP must be released before it confirms
    this.audio.setRoll(0, false);
    this.audio.play('oneup', { gain: 0.8, rate: 0.8 });
    this.#haptic('large');
    const prompt = (): PortalPrompt => ({
      id,
      label: p.label,
      host: hostOf(p.href),
      href: p.href,
      offline: this.#api === 'offline' && !fixtureFor(p.href),
    });
    this.#set({ portal: prompt() });
    if (this.#api === 'unknown')
      void this.#probeApi().then(() => {
        if (this.#view.portal?.id === id) this.#set({ portal: prompt() });
      });
  }

  /** "Stay here": decline this link for the stage and let the ball pass through it. */
  stayHere(): void {
    if (this.#view.portal) telemetry.track({ name: 'portal_selected', action: 'stay' });
    const portal = this.#view.portal;
    if (!portal) return;
    this.audio.play('click');
    this.#dismissedPortals.add(portal.id);
    this.#engine?.setPortalState(portal.id, 'used');
    this.#set({ portal: null });
    if (this.#view.phase !== 'play') return;
    if (this.#portalTimer) this.#timer.start();
    this.#driver?.setPaused(false);
  }

  /**
   * "Travel": bank this stage (items only; the goal's time bonus is forfeited), carry the score and spares, roll
   * into the gate, and build the linked site like a URL typed on site select (`POST /api/stages`, SSE, the same
   * error screens). A link to one of the offline fixture pages is built in the browser instead.
   */
  travelPortal(): void {
    if (this.#view.portal) telemetry.track({ name: 'portal_selected', action: 'travel' });
    const pr = this.#view.portal;
    const run = this.#run;
    if (!pr || pr.offline || this.#view.phase !== 'play' || !run || this.#view.travel) return;
    this.audio.play('getGoal');
    this.#haptic('goal');
    this.#music(null);
    for (const _ of this.#pendingSmall) this.#credit(SMALL_SCORE);
    this.#pendingSmall = [];
    this.#finishStage(false, 'portal');
    const j = this.#view.journey;
    const target: JourneyStop = { host: pr.host, title: pr.label, url: pr.href, ref: null, via: 'portal' };
    this.#travelling = true;
    this.#set({
      portal: null,
      result: null,
      travel: { label: pr.label, host: pr.host, href: pr.href },
      journey: [...j, target],
      build: { step: 'queued', pct: 2, label: pr.label },
    });
    this.#buildAbort?.abort();
    const ac = new AbortController();
    this.#buildAbort = ac;
    const fixture = fixtureFor(pr.href);
    // Start building now (a capture takes seconds) while the gate animation plays.
    const outcome: Promise<{ run: RunSource } | { err: unknown }> = (
      fixture
        ? Promise.resolve<RunSource>(new FixtureRun(fixture, this.#pool))
        : createApiRun(this.#opts.origin, pr.href, (p) => this.#progress(p.step, p.pct), ac.signal)
    ).then(
      (r) => ({ run: r }),
      (err) => ({ err }),
    );
    const t0 = this.#clock;
    const gate = this.#engine?.playPortal(pr.id) ?? Promise.resolve();
    void gate.then(async () => {
      if (ac.signal.aborted || this.#disposed || this.#view.phase !== 'play') return;
      if (!this.#send({ type: 'TRAVEL' })) return;
      const o = await outcome;
      if (ac.signal.aborted || this.#disposed) return;
      if ('err' in o) {
        this.#buildFailed(o.err, pr.href, ac);
        return;
      }
      this.#run = o.run;
      this.#slice = 0;
      void this.#loadSlice(ac, t0);
    });
  }

  // ── input ─────────────────────────────────────────────────────────────────────────────────────────────

  #onKeyDown(ev: KeyboardEvent): void {
    const p = this.#view.phase;
    if (p === 'play' && this.#view.portal && !ev.repeat) {
      if (ev.code === 'Enter' || ev.code === 'NumpadEnter' || ev.code === 'KeyY') {
        ev.preventDefault();
        if (this.#view.portal.offline) this.stayHere();
        else this.travelPortal();
        return;
      }
      if (ev.code === 'KeyN' || ev.code === 'Backspace') {
        ev.preventDefault();
        this.stayHere();
        return;
      }
    }
    if ((p === 'intro' || p === 'countdown') && ev.code === 'KeyG' && this.#view.ghost.run) {
      ev.preventDefault();
      this.setGhost(!this.#view.ghost.on);
      return;
    }
    if (p === 'intro' && (ev.code === 'Space' || ev.code === 'Enter' || ev.code === 'Escape')) {
      ev.preventDefault();
      this.skipIntro();
    }
  }

  #onMenuKey(): void {
    const p = this.#view.phase;
    if (p === 'play' && this.#view.portal) {
      this.stayHere();
      return;
    }
    if (p === 'play' && this.#view.travel) return;
    if (p === 'play' || p === 'countdown') {
      this.audio.play('click');
      this.#send({ type: 'MENU' });
    } else if (p === 'paused' && !this.#view.confirm) this.resume();
    else if (p === 'paused' && this.#view.confirm) this.#set({ confirm: null });
    else if (p === 'intro') this.skipIntro();
  }

  /** E: losing window focus pauses the game (map). */
  #autoPause(): void {
    if (this.#opts.test?.noAutoPause) return;
    if (this.#view.travel) return;
    const p = this.#view.phase;
    if (p === 'play' || p === 'countdown') this.#send({ type: 'MENU' });
  }

  #sample(now: number): InputSample {
    const yaw = this.#yaw();
    const kb = this.#keyboard?.sample(now) ?? neutralSample(yaw);
    const gp = this.#gamepad?.sample(now) ?? neutralSample(yaw);
    const ph = this.#phone?.sample(now) ?? null;
    const active = (s: InputSample) => s.power || s.jump || s.tiltX !== 0 || s.tiltZ !== 0;
    let s: InputSample;
    if (active(kb)) {
      s = kb;
      this.#lastSource = 'keyboard';
    } else if (active(gp)) {
      s = gp;
      this.#lastSource = 'gamepad';
    } else if (ph && this.#view.inputMode === 'phone') {
      const k = this.#view.sensitivity;
      s = { ...ph, tiltX: clamp(ph.tiltX * k, MAX_TILT_ROLL), tiltZ: clamp(ph.tiltZ * k, MAX_TILT_PITCH) };
      this.#lastSource = 'phone';
    } else {
      s = kb;
      this.#lastSource = this.#view.inputMode === 'phone' ? 'phone' : 'keyboard';
    }
    if (this.#view.phase === 'play' && (s.power || s.jump || (this.#lastSource !== 'phone' && active(s))))
      gameActivity();
    return s;
  }

  /** Input for one sim step; also advances the game timer and delayed small-item credits in step time. */
  #inputForStep = (tick: number, dt: number): InputSample => {
    const s = this.#stepInput(tick, dt);
    // 08b: the stream the sim consumes is the replay. Lockstep: exactly one sample per tick. Worker: the latest
    // input is latched for however many ticks the worker runs, so this is only an approximation.
    if (this.#driver?.kind === 'lockstep') this.#rec.push(s);
    else for (let n = Math.max(1, Math.round(dt * SIM_HZ)); n > 0; n--) this.#rec.push(s);
    return s;
  };

  #stepInput(tick: number, dt: number): InputSample {
    const v = this.#view;
    if (v.phase !== 'play') return neutralSample(this.#yaw());
    let s = this.#lastSample;
    if (this.#replay) s = this.#replay[tick] ?? neutralSample(s.frameYaw);
    if (this.#autopilot) {
      s = { ...this.#autopilot.sample, frameYaw: this.#yaw() };
      if (--this.#autopilot.ticks <= 0) this.#autopilot = null;
    }
    // E: jump is locked until tutorial step 4
    if (v.tutorial !== null && v.tutorial < 4 && s.jump) s = { ...s, jump: false };
    if (this.#timerArmed && s.power) {
      // E: on the first game the first POWER press starts the timer
      this.#timerArmed = false;
      if (this.#timerStartTick === undefined) this.#timerStartTick = this.#rec.length;
      this.#timer.start();
    }
    if (v.tutorial === 3 && s.power) this.#tutorialAdvance(4);
    for (const ev of this.#timer.tick(dt)) {
      if (ev === 'last30') {
        this.audio.play('caution');
        this.#music('timeup');
        this.#set({ last30: true });
      } else if (ev === 'timesup') {
        this.#timesUp();
      }
    }
    if (this.#timer.remainsInt !== v.timeInt) this.#set({ timeInt: this.#timer.remainsInt });
    return s;
  }

  #timesUp(): void {
    // The respawn after a time-up has no sim event, so replay() can't reproduce it: no replay for this attempt.
    this.#recExact = false;
    const spares = this.#view.spares - 1;
    this.#set({ spares, sign: spares < 0 ? 'gameover' : 'timeup' });
    this.#send({ type: 'TIMESUP' });
    this.audio.play('caution');
    this.#music(null);
    this.#after(SIGN_SEC, () => this.#send({ type: 'SIGN_DONE', spares }));
  }

  // ── frame ─────────────────────────────────────────────────────────────────────────────────────────────

  #frame = (now: number): void => {
    if (this.#disposed) return;
    this.#raf = requestAnimationFrame(this.#frame);
    const e = this.#engine;
    const d = this.#driver;
    if (!e) return;
    const scale = this.#opts.test?.timeScale ?? 1;
    const dt = Math.min(0.1, Math.max(0, (now - this.#lastFrame) / 1000)) * scale;
    this.#lastFrame = now;

    const sample = this.#sample(now);
    this.#lastSample = sample;
    const v = this.#view;

    // Freeze the world while the phone is gone (N).
    const hold =
      v.inputMode === 'phone' &&
      !!this.#phone &&
      !this.#phone.connected &&
      HOLD_ON_DISCONNECT.has(v.phase) &&
      !this.#replay;
    if (hold && !v.hold) {
      this.#set({ hold: 'disconnected' });
      this.audio.setRoll(0, false);
    } else if (!hold && v.hold) this.#set({ hold: null, resumedFlash: this.#clock });

    const gdt = hold ? 0 : dt;
    this.#clock += gdt;

    // delayed timers
    if (this.#timers.length) {
      const due = this.#timers.filter((t) => t.at <= this.#clock);
      if (due.length) {
        this.#timers = this.#timers.filter((t) => t.at > this.#clock);
        for (const t of due) t.fn();
      }
    }
    // delayed small-item credits (E: +300 ms)
    while (this.#pendingSmall.length && (this.#pendingSmall[0] as number) <= this.#clock) {
      this.#pendingSmall.shift();
      this.#credit(SMALL_SCORE);
    }
    if (v.phase === 'calibrate') {
      const left = Math.max(0, Math.ceil(CALIBRATE_TIMEOUT_SEC - this.#phaseAge()));
      if (left !== v.calibrateLeft) this.#set({ calibrateLeft: left });
    }

    // Portal prompt (Phase 13): JUMP (after a release) confirms, the world waits.
    if (v.portal && v.phase === 'play') {
      if (sample.jump && !this.#prevJump && this.#clock - this.#portalAt > 0.35) {
        if (v.portal.offline) this.stayHere();
        else this.travelPortal();
      }
    }
    this.#prevJump = sample.jump;
    const stepping = !!d && !hold && !v.portal && !v.travel && (v.phase === 'play' || v.phase === 'falling');
    if (stepping) {
      const r = d.advance(gdt, this.#inputForStep, this.#onSimEvent);
      if (r.ball) {
        this.#ballPos = r.ball.pos;
        e.setBall(r.ball, r.alpha);
        e.setElevators(r.elevators);
        const [vx, vy, vz] = r.ball.vel;
        this.audio.setRoll(Math.hypot(vx, vy, vz), r.ball.grounded && this.#view.phase === 'play');
      }
    }
    if (this.#ghostBall) this.#ghostBall.update((d?.tick ?? 0) / SIM_HZ);
    const control =
      this.#view.phase === 'play' && !this.#view.portal && !this.#view.travel
        ? sample
        : neutralSample(sample.frameYaw);
    e.setControl({ tiltX: control.tiltX, tiltZ: control.tiltZ, power: control.power });
    e.frame(gdt);
    this.#syncController(false);
  };

  #phaseStart = 0;
  #phaseAge(): number {
    return this.#clock - this.#phaseStart;
  }

  /** host → controller `state` (contracts §6): on phase change and when HUD values change (≤ 4 Hz). */
  #syncController(force: boolean): void {
    if (force) this.#phaseStart = this.#clock;
    const conn = this.#conn;
    if (!conn) return;
    const v = this.#view;
    const key = `${v.phase}|${v.total}|${v.spares}|${v.timeInt}`;
    const now = performance.now();
    if (!force && (key === this.#stateKey || now - this.#stateSentAt < 250)) return;
    this.#stateKey = key;
    this.#stateSentAt = now;
    conn.send({
      t: 'state',
      phase: v.phase,
      score: v.total,
      balls: Math.max(0, v.spares),
      timeLeft: v.timeInt,
    });
  }

  // ── test / automation hooks ───────────────────────────────────────────────────────────────────────────

  debugState() {
    return {
      phase: this.#view.phase,
      driver: this.#driver?.kind ?? null,
      tick: this.#driver?.tick ?? 0,
      timer: { remains: this.#timer.remains, int: this.#timer.remainsInt, running: this.#timer.running },
      total: this.#view.total,
      spares: this.#view.spares,
      small: this.#view.small,
      large: this.#view.large,
      ball: this.#ballPos,
      stageId: this.#loaded?.stage.stageId ?? null,
      clock: this.#clock,
      hold: this.#view.hold,
      recording: { ticks: this.#rec.length, exact: this.#recExact, replays: this.#replays.size },
      ghost: { ...this.#view.ghost, loaded: !!this.#ghostTrack, ticks: this.#ghostTrack?.ticks ?? 0 },
      portal: this.#view.portal,
      journey: this.#view.journey,
      api: this.#api,
      engine: this.#engine?.stats() ?? null,
    };
  }

  /** e2e / measurement: the replays recorded for this session's results (index = result order). */
  debugReplays(): { stageId: string; stageScore: number; replay: VersionedReplay | null }[] {
    return this.#results.map((r, i) => ({
      stageId: r.stageId,
      stageScore: r.stageScore,
      replay: this.#replays.get(i) ?? null,
    }));
  }

  /** Measurement: the recording of the current attempt so far (also for the worker driver). */
  debugRecording(): InputSample[] {
    return this.#rec.slice();
  }

  /** Playtest / e2e: set the remaining time (seconds) of the running stage. */
  debugSetTimeLeft(sec: number): void {
    this.#timer.remains = sec;
    this.#timer.remainsInt = Math.round(sec);
    this.#set({ timeInt: this.#timer.remainsInt, last30: sec <= 30 });
  }

  /**
   * e2e / screenshots (Phase 13): put the ball a few metres from a portal and roll it in with the real physics
   * (POWER + forward tilt towards the portal for up to 3 s). Returns false if there is no such portal or no room.
   */
  debugRollIntoPortal(portalId: number, backM = 4.5): boolean {
    const p = this.#stage()?.portals?.find((x) => x.id === portalId);
    return !!p && this.#rollTo(p.pos, p.islandId, backM);
  }

  /** e2e / screenshots: the same, into the goal. */
  debugRollIntoGoal(backM = 4.5): boolean {
    const g = this.#stage()?.goal;
    return !!g && this.#rollTo(g.pos, g.islandId, backM);
  }

  #rollTo(target: Vec2, islandId: number, backM: number): boolean {
    const stage = this.#stage();
    const p = { pos: target };
    const d = this.#driver;
    const e = this.#engine;
    if (!stage || !d || !e || this.#view.phase !== 'play') return false;
    const isl = stage.islands.find((i) => i.id === islandId);
    if (!isl) return false;
    // the free direction on the island: the farthest-reaching of 16 headings (up to backM metres)
    const PX = 13.5;
    let best: { at: Vec2; len: number } | null = null;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let len = 0;
      for (let m = 0.5; m <= backM + 1e-9; m += 0.25) {
        const q: Vec2 = [p.pos[0] + Math.cos(a) * m * PX, p.pos[1] + Math.sin(a) * m * PX];
        if (!insideWithMargin(q, isl.contour, isl.holes, 8)) break;
        len = m;
      }
      if (!best || len > best.len)
        best = { at: [p.pos[0] + Math.cos(a) * len * PX, p.pos[1] + Math.sin(a) * len * PX], len };
    }
    if (!best || best.len < 2.2) return false;
    d.reset(best.at);
    // frameYaw such that "forward" (−sin ψ, −cos ψ) points from the ball to the portal
    const yaw = Math.atan2(-(p.pos[0] - best.at[0]), -(p.pos[1] - best.at[1]));
    void e.spawnBall(best.at, { durationSec: 0.01, faceTo: p.pos });
    this.#autopilot = {
      sample: { tiltX: 0, tiltZ: MAX_TILT_PITCH * 0.6, frameYaw: yaw, power: true, jump: false },
      ticks: SIM_HZ * 3,
    };
    return true;
  }

  /** Direct entry to a catalog run by id (e2e / curated deep links). */
  playCatalog(id: string): boolean {
    const entry = catalogEntry(id);
    if (!entry) return false;
    this.chooseEntry(entry);
    return true;
  }

  /** Fixtures offered on the error screen as alternatives. */
  static alternatives(): CatalogEntry[] {
    return [PRACTICE, ...FIXTURES.slice(0, 3)];
  }

  static errorCodeOf(code: LoadErrorCode): ApiErrorCode | 'NETWORK' | 'NOT_FOUND' {
    return code;
  }
}

function insideWithMargin(p: Vec2, contour: Vec2[], holes: Vec2[][], margin: number): boolean {
  return pointInPolygon(p, contour, holes) && distanceToPolygonEdge(p, contour, holes) >= margin;
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}
