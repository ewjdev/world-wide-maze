import { createEngine, type Engine } from '@wwm/engine';
import {
  GamepadInputSource,
  KeyboardInputSource,
  neutralSample,
  TiltInputSource,
  TouchInputSource,
} from '@wwm/net';
import {
  advanceProgress,
  createProgress,
  createRaceSimulation,
  isEligible,
  makeCompatibility,
  markPractice,
  type PracticeReason,
  type RaceAttempt,
  type RaceCourse,
  type RaceInputSample,
  type RaceMechanics,
  type RaceProgress,
  RaceRecorder,
  type RaceSimulation,
} from '@wwm/race';
import { PX_PER_METER, SIM_HZ, type Vec2 } from '@wwm/schema';
import { AudioManager } from '../audio/audio.ts';
import { RaceControllerHost } from '../controller/race-host.ts';
import { LockstepDriver, type ObservedStep } from '../game/sim-driver.ts';
import { preferTouch, savePreference } from '../input/capability.ts';
import { MOBILE_CONTROLS_ENABLED, MOBILE_TILT_ENABLED } from '../input/flags.ts';
import { observeSize, watchOrientation } from '../input/layout.ts';
import { localTouchMode, readMotionPreferences, saveMotionPreferences } from '../input/motion-preferences.ts';
import { canAdvance, canResume, canStart, MotionSession } from '../input/motion-session.ts';
import { GhostClient } from './ghost-client.ts';
import { RaceHistory } from './storage.ts';
import { courseMarkers, raceGhost } from './visuals.ts';

export type RacePhase =
  | 'loading'
  | 'ready'
  | 'countdown'
  | 'racing'
  | 'paused'
  | 'finished'
  | 'exhausted'
  | 'error';
export interface RaceView {
  phase: RacePhase;
  countdown: number;
  progress: RaceProgress;
  mechanics: RaceMechanics | null;
  speed: number;
  stuntEvent: RaceMechanics['lastEvent'];
  best: RaceAttempt | null;
  comparisonBest: RaceAttempt | null;
  recent: RaceAttempt[];
  result: RaceAttempt | null;
  newBest: boolean;
  split: number | null;
  input: 'keyboard' | 'phone' | 'touch' | 'tilt';
  ghosts: 'off' | 'best' | 'both';
  ghostCount: number;
  ghostError: boolean;
  persistent: boolean;
  error: string | null;
  muted: boolean;
  phone: ReturnType<RaceControllerHost['getView']> | null;
}
export interface RaceTestHooks {
  inputs?: RaceInputSample[];
  countdownSec?: number;
  noAutoPause?: boolean;
  quality?: 'low' | 'high';
  timeScale?: number;
}

/** A Race owns its lifecycle; Original's score/goal/learning state machine is never instantiated. */
export class RaceSession {
  readonly course: RaceCourse;
  readonly audio = new AudioManager();
  #view: RaceView = {
    phase: 'loading',
    countdown: 3,
    progress: createProgress(),
    mechanics: null,
    speed: 0,
    stuntEvent: null,
    best: null,
    comparisonBest: null,
    recent: [],
    result: null,
    newBest: false,
    split: null,
    input: 'keyboard',
    ghosts: 'best',
    ghostCount: 0,
    ghostError: false,
    persistent: true,
    error: null,
    muted: false,
    phone: null,
  };
  #listeners = new Set<() => void>();
  #engine: Engine | null = null;
  #sim: RaceSimulation | null = null;
  #simReady = false;
  #driver: LockstepDriver | null = null;
  #keyboard: KeyboardInputSource | null = null;
  #gamepad: GamepadInputSource | null = null;
  /** Same-device touch: the UI binds its elements here; frames `peek()`, the tick callback `sample()`s. */
  readonly touch: TouchInputSource | null;
  readonly tiltSource: TiltInputSource | null;
  readonly motion: MotionSession | null;
  #motionArmed = false;
  #phone: RaceControllerHost | null = null;
  #phoneLoading = false;
  #focusLost = false;
  #history = new RaceHistory();
  #historyWrites: Promise<void> = Promise.resolve();
  #historyRead = 0;
  #ghostClient = new GhostClient();
  #ghosts: ReturnType<typeof raceGhost>[] = [];
  #markers: ReturnType<typeof courseMarkers> | null = null;
  #recorder = new RaceRecorder();
  #texture: ImageBitmap | null = null;
  #progress = createProgress();
  #recovery: { at: Vec2; reason: 'fall' | 'recovery' } | null = null;
  #fallAt: Vec2 | null = null;
  #falling = false;
  #disposed = false;
  #generation = 0;
  #raf = 0;
  #lastFrame = 0;
  #countdown = 0;
  #publishAt = 0;
  #saved = true;
  #attemptId = '';
  #createdAt = 0;
  #jumpArmed = false;
  #turboRequested = false;
  /** The phase a pause interrupted: `resume()` returns there instead of skipping a running countdown. */
  #pausedFrom: 'countdown' | 'racing' = 'racing';
  #stuntEventUntil = 0;
  #inputSource: RaceAttempt['inputSource'] = 'keyboard';
  #host: HTMLElement | null = null;
  #cleanups: (() => void)[] = [];
  #test: RaceTestHooks;
  #frameTimes: number[] = [];
  constructor(course: RaceCourse, test: RaceTestHooks = {}) {
    this.course = course;
    this.#test = test;
    this.touch = MOBILE_CONTROLS_ENABLED
      ? new TouchInputSource({ frameYaw: () => this.#engine?.cameraYaw() ?? 0 })
      : null;
    this.tiltSource = MOBILE_TILT_ENABLED
      ? new TiltInputSource({ frameYaw: () => this.#engine?.cameraYaw() ?? 0 })
      : null;
    this.motion = this.tiltSource ? new MotionSession(this.tiltSource) : null;
    this.tiltSource?.setSensitivity(readMotionPreferences().sensitivity);
    if (this.touch && preferTouch()) this.#view = { ...this.#view, input: localTouchMode() };
    if (this.motion)
      this.#cleanups.push(
        this.motion.subscribe(() => {
          if (this.#view.input === 'tilt' && this.motion?.getSnapshot().state !== 'ready') {
            this.#motionArmed = false;
            this.tiltSource?.reset();
            this.#turboRequested = false;
            this.#driver?.setPaused(true);
            this.pause('pause');
          }
          this.#set({});
        }),
      );
  }
  getView = () => this.#view;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  #set(patch: Partial<RaceView>) {
    if (this.#disposed) return;
    this.#view = { ...this.#view, ...patch };
    for (const listener of this.#listeners) listener();
  }
  async mount(host: HTMLElement) {
    this.#host = host;
    const canvas = document.createElement('canvas');
    canvas.className = 'wwm-canvas';
    host.append(canvas);
    const yaw = () => this.#engine?.cameraYaw() ?? 0;
    this.#keyboard = new KeyboardInputSource({ frameYaw: yaw });
    this.#gamepad = new GamepadInputSource({ frameYaw: yaw });
    this.#cleanups.push(
      this.#keyboard.on('menu', () => this.togglePause()),
      this.#gamepad.on('menu', () => this.togglePause()),
    );
    const resize = () => this.#engine?.resize(host.clientWidth, host.clientHeight);
    // The observed host owns engine sizing; a collapsed host releases input and pauses.
    const collapse = () => {
      this.touch?.reset();
      if (this.#view.input === 'tilt') this.motion?.suspend('focus');
      this.pause('pause');
    };
    const orientation = () => {
      if (this.#view.input === 'tilt') {
        this.motion?.suspend('rotation');
        return;
      }
      if (this.#view.input !== 'touch') return;
      this.touch?.reset();
      this.pause('pause');
    };
    this.#focusLost = document.hidden && !this.#test.noAutoPause;
    const blur = () => {
      if (this.#test.noAutoPause) return;
      this.#focusLost = true;
      this.pause('focus-loss');
    };
    const focus = () => {
      if (!document.hidden) this.#focusLost = false;
    };
    const hidden = () => {
      if (document.hidden) blur();
      else if (document.hasFocus()) focus();
    };
    const key = (event: KeyboardEvent) => {
      if (event.code === 'KeyT' && !event.repeat && !(event.target instanceof HTMLInputElement)) {
        this.turbo();
        event.preventDefault();
      }
      if (event.code === 'KeyR' && !event.repeat && !(event.target instanceof HTMLInputElement))
        void this.start();
    };
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', hidden);
    this.#cleanups.push(
      observeSize(host, { onSize: resize, onCollapse: collapse }),
      watchOrientation(orientation),
    );
    this.#cleanups.push(() => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', hidden);
    });
    try {
      const engine = await createEngine({
        canvas,
        quality: this.#test.quality ?? 'auto',
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        forceWebGL: new URLSearchParams(location.search).get('backend') === 'webgl',
      });
      if (this.#disposed) {
        engine.dispose();
        return;
      }
      this.#engine = engine;
      resize();
      this.#lastFrame = performance.now();
      this.#raf = requestAnimationFrame(this.#frame);
      const response = await fetch(this.course.textureUrl);
      if (!response.ok) throw new Error('Course texture could not be loaded.');
      const texture = await createImageBitmap(await response.blob());
      if (this.#disposed) {
        texture.close();
        return;
      }
      this.#texture = texture;
      const sim = await createRaceSimulation(this.course);
      if (this.#disposed) {
        sim.dispose();
        return;
      }
      this.#sim = sim;
      this.#driver = new LockstepDriver(sim);
      await Promise.all([this.#driver.load(this.course.stage), engine.loadStage(this.course.stage, texture)]);
      if (this.#disposed) return;
      this.#simReady = true;
      engine.skipIntro();
      engine.setBall(sim.getBallState());
      engine.setView('map');
      this.#markers = courseMarkers(engine, this.course);
      await this.#readHistory();
      this.#set({ phase: 'ready', muted: this.audio.muted, mechanics: sim.getMechanics() });
    } catch (error) {
      this.#set({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }
  async #readHistory() {
    const generation = this.#generation;
    const read = ++this.#historyRead;
    try {
      const result = await this.#history.list(
        makeCompatibility(this.course.courseId, !!this.course.stunts, this.course.physicsProfile),
      );
      if (this.#disposed || generation !== this.#generation || read !== this.#historyRead) return;
      this.#set({ best: result.best, recent: result.recent, persistent: result.persistent });
    } catch {
      if (generation === this.#generation && read === this.#historyRead) this.#set({ persistent: false });
    }
  }
  async pair() {
    if (this.#phone || this.#phoneLoading) return;
    this.#phoneLoading = true;
    try {
      const phone = await RaceControllerHost.create({
        origin: location.origin,
        requiresStunts: !!this.course.stunts,
        frameYaw: () => this.#engine?.cameraYaw() ?? 0,
        onMenu: () => this.togglePause(),
        onDisconnect: () => {
          if (this.#view.input === 'phone') this.pause('controller-disconnect');
        },
      });
      if (this.#disposed) {
        phone.dispose();
        return;
      }
      this.#phone = phone;
      const update = () => this.#set({ phone: phone.getView() });
      this.#cleanups.push(phone.subscribe(update));
      update();
      this.#syncPhone();
    } catch (error) {
      this.#set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.#phoneLoading = false;
    }
  }
  setInput(input: 'keyboard' | 'phone' | 'touch' | 'tilt') {
    if (input === 'phone' && !this.#phone?.canStart) return;
    if (input === 'touch' && !this.touch) return;
    if (input === 'tilt' && !this.motion) return;
    if (this.#view.phase === 'racing' || this.#view.phase === 'countdown') this.pause('pause');
    if (input !== this.#view.input) {
      this.touch?.reset();
      this.tiltSource?.reset();
      if (this.#view.phase === 'loading' && this.#simReady) {
        ++this.#generation;
        this.#ghostClient.cancel();
        this.#set({ phase: 'ready' });
      }
      this.#phone?.discardTurboRequest();
      this.#turboRequested = false;
      if (!this.#saved) this.#inputSource = 'mixed';
    }
    this.#set({ input });
    if (input === 'keyboard' || input === 'touch' || input === 'tilt')
      savePreference(input === 'keyboard' ? 'keyboard' : 'touch');
    if (input === 'touch' || input === 'tilt')
      saveMotionPreferences({ ...readMotionPreferences(), mode: input === 'tilt' ? 'tilt' : 'joystick' });
    if (input !== 'tilt') this.motion?.reset();
  }
  #motionContext(intent = false) {
    return {
      selected: this.#view.input === 'tilt',
      snapshot: this.motion?.getSnapshot() ?? null,
      driverKind: this.#driver?.kind,
      visible: !this.#focusLost && !document.hidden,
      intent,
      armed: this.#motionArmed,
      ownsInput: this.#view.phase === 'countdown' || this.#view.phase === 'racing',
      contactsReleased: !this.tiltSource?.contactsActive,
    };
  }
  enableTilt(): void {
    void this.motion?.enableTilt();
  }
  recenterTilt(): void {
    if (this.#view.input === 'tilt') this.motion?.suspend('recenter');
  }
  refreshControls(): void {
    this.#set({});
  }
  turbo() {
    if (this.#view.phase === 'racing' && this.#sim?.getMechanics().ready) this.#turboRequested = true;
  }
  setGhosts(ghosts: RaceView['ghosts']) {
    this.#set({ ghosts });
  }
  toggleSound() {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.muted);
    this.#set({ muted: this.audio.muted });
  }
  async clearHistory() {
    this.#set({ error: null });
    const generation = this.#generation;
    ++this.#historyRead;
    this.#historyWrites = this.#historyWrites
      .then(async () => {
        await this.#history.clear(this.course.courseId);
      })
      .catch((error) => {
        if (generation === this.#generation)
          this.#set({
            persistent: false,
            error: error instanceof Error ? error.message : 'History could not be cleared.',
          });
      });
    await this.#historyWrites;
    if (generation === this.#generation) await this.#readHistory();
  }
  async start() {
    const engine = this.#engine;
    const driver = this.#driver;
    if (
      this.#disposed ||
      !engine ||
      !driver ||
      !this.#texture ||
      this.#view.phase === 'loading' ||
      this.#view.phase === 'countdown'
    )
      return;
    if (!canStart(this.#motionContext(true))) return;
    if (this.#view.input === 'phone' && !this.#phone?.canStart) {
      this.#set({ error: 'Connect and calibrate your phone, or use the keyboard.' });
      return;
    }
    const gen = ++this.#generation;
    driver.setPaused(true);
    this.touch?.reset();
    this.tiltSource?.reset();
    this.#motionArmed = false;
    this.audio.unlock();
    this.audio.setRoll(0, false);
    this.#save('abandoned');
    this.#ghostClient.cancel();
    this.#ghosts.forEach((ghost) => {
      ghost.dispose();
    });
    this.#ghosts = [];
    this.#set({
      phase: 'loading',
      error: null,
      ghostCount: 0,
      ghostError: false,
      stuntEvent: null,
      result: null,
      newBest: false,
      split: null,
    });
    try {
      await driver.load(this.course.stage);
      if (this.#disposed || gen !== this.#generation) return;
      this.#progress = createProgress();
      this.#frameTimes = [];
      this.#recorder = new RaceRecorder(undefined, !!this.course.stunts);
      this.#saved = false;
      this.#attemptId = crypto.randomUUID();
      this.#createdAt = Date.now();
      this.#inputSource = this.#view.input === 'tilt' ? 'touch' : this.#view.input;
      this.#recovery = null;
      this.#fallAt = null;
      this.#falling = false;
      this.#jumpArmed = false;
      this.#turboRequested = false;
      this.#markers?.update(0);
      if (this.#sim) engine.setBall(this.#sim.getBallState());
      engine.setView('chase');
      const first = this.course.gates[0];
      await engine.spawnBall(this.course.stage.start.pos, {
        durationSec: 0.01,
        ...(first
          ? { faceTo: [first.center[0] * PX_PER_METER, first.center[2] * PX_PER_METER] as Vec2 }
          : {}),
      });
      if (this.#disposed || gen !== this.#generation) return;
      // The immediate retry must see its finalized previous attempt, including slow disk writes.
      await this.#historyWrites;
      if (this.#disposed || gen !== this.#generation) return;
      await this.#readHistory();
      if (this.#disposed || gen !== this.#generation) return;
      this.#set({ comparisonBest: this.#view.best });
      const selected: RaceAttempt[] = [];
      if (this.#view.ghosts !== 'off') {
        const primary = this.#view.best ?? this.#view.recent[0];
        if (primary) selected.push(primary);
        const previous = this.#view.recent.find((attempt) => attempt.id !== primary?.id);
        if (this.#view.ghosts === 'both' && previous) selected.push(previous);
      }
      for (const attempt of selected) {
        try {
          const track = await this.#ghostClient.prepare(this.course, attempt);
          if (this.#disposed || gen !== this.#generation) return;
          this.#ghosts.push(raceGhost(engine, track, this.#ghosts.length > 0));
        } catch {
          if (gen === this.#generation) this.#set({ ghostError: true });
        }
      }
      if (this.#disposed || gen !== this.#generation) return;
      this.#countdown = this.#test.countdownSec ?? 3;
      this.#motionArmed = canStart(this.#motionContext(true));
      this.motion?.restoreInput();
      this.#set({
        phase: 'countdown',
        progress: this.#progress,
        countdown: Math.ceil(this.#countdown),
        ghostCount: this.#ghosts.length,
        mechanics: this.#sim?.getMechanics() ?? null,
      });
      if (this.#view.input === 'phone' && !this.#phone?.canStart) this.pause('controller-disconnect');
      if (this.#focusLost) this.pause('focus-loss');
      if (!this.#motionArmed && this.#view.input === 'tilt') this.pause('pause');
      this.#syncPhone();
    } catch (error) {
      if (this.#disposed || gen !== this.#generation) return;
      this.#set({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }
  pause(reason: PracticeReason = 'pause') {
    if (this.#view.phase !== 'racing' && this.#view.phase !== 'countdown') return;
    this.#turboRequested = false;
    this.touch?.reset();
    this.tiltSource?.reset();
    this.#motionArmed = false;
    this.#pausedFrom = this.#view.phase;
    this.#progress = markPractice(this.#progress, reason);
    this.#driver?.setPaused(true);
    this.audio.setRoll(0, false);
    this.#set({ phase: 'paused', progress: this.#progress });
    this.#syncPhone();
  }
  resume() {
    if (this.#view.phase !== 'paused' || this.#focusLost) return;
    if (this.#view.input === 'phone' && !this.#phone?.canStart) return;
    if (!canResume(this.#motionContext(true))) return;
    this.#motionArmed = true;
    this.motion?.restoreInput();
    // A paused countdown resumes its remaining countdown (the frame loop keeps counting); racing resumes racing.
    const to = this.#pausedFrom;
    this.#set({ phase: to });
    this.#lastFrame = performance.now();
    this.#driver?.setPaused(to !== 'racing');
    this.#syncPhone();
  }
  togglePause() {
    if (this.#view.phase === 'paused') this.resume();
    else this.pause();
  }
  recover() {
    if (this.#view.phase !== 'racing' || this.#falling || this.#recovery) return;
    this.#recovery = { at: this.course.stage.start.pos, reason: 'recovery' };
  }
  #endExhausted() {
    const mechanics = this.#sim?.getMechanics();
    if (!mechanics?.exhausted) return false;
    this.#driver?.setPaused(true);
    this.#recovery = null;
    this.#turboRequested = false;
    this.#phone?.discardTurboRequest();
    this.audio.setRoll(0, false);
    this.#set({ phase: 'exhausted', progress: this.#progress, mechanics, stuntEvent: null });
    this.#save('abandoned');
    this.#syncPhone();
    return true;
  }
  #save(outcome: RaceAttempt['outcome']) {
    if (this.#saved || !this.#recorder.ticks) return;
    this.#saved = true;
    const attempt: RaceAttempt = {
      schema: 'wwm.race-attempt/1',
      id: this.#attemptId,
      createdAt: this.#createdAt,
      compatibility: makeCompatibility(
        this.course.courseId,
        !!this.course.stunts,
        this.course.physicsProfile,
      ),
      inputSource: this.#inputSource,
      outcome,
      progress: this.#progress,
      recording: this.#recorder.finish(),
    };
    const gen = this.#generation;
    if (outcome === 'finished')
      this.#set({
        result: attempt,
        newBest:
          isEligible(attempt) &&
          (!this.#view.best ||
            (attempt.progress.finishTick ?? Infinity) < (this.#view.best.progress.finishTick ?? Infinity)),
      });
    this.#historyWrites = this.#historyWrites
      .then(() => this.#history.save(attempt))
      .then((result) => {
        if (gen !== this.#generation) return;
        if (!result.persistent) this.#set({ persistent: false });
        void this.#readHistory();
      })
      .catch(() => {
        if (gen === this.#generation) this.#set({ persistent: false });
      });
  }
  #observe = (step: ObservedStep) => {
    const mechanics = this.#sim?.getMechanics();
    if (mechanics?.lastEvent) {
      this.#stuntEventUntil = step.tick + SIM_HZ;
      this.#set({ mechanics, stuntEvent: mechanics.lastEvent });
      this.audio.play('click');
    } else if (this.#view.stuntEvent && step.tick >= this.#stuntEventUntil) this.#set({ stuntEvent: null });
    const before = this.#progress.nextGate;
    this.#progress = advanceProgress(this.#progress, this.course.gates, {
      tick: step.tick,
      previous: step.previous.pos,
      current: step.current.pos,
      fell: step.events.some((event) => event.type === 'fell'),
    });
    for (const event of step.events) {
      if (event.type === 'fell') {
        this.#fallAt = event.restartAt;
        this.#falling = true;
      }
      if (event.type === 'lost')
        this.#recovery = { at: this.#fallAt ?? this.course.stage.start.pos, reason: 'fall' };
      if (event.type !== 'goal' && event.type !== 'portal' && event.type !== 'item')
        this.#engine?.handleEvent(event);
      if (event.type === 'bump') this.audio.impact('bump', event.impact);
    }
    if (this.#endExhausted()) return true;
    if (before !== this.#progress.nextGate) {
      this.#markers?.update(this.#progress.nextGate);
      this.audio.play('click');
      const index = this.#progress.sectorTicks.length - 1;
      const best = this.#view.comparisonBest?.progress.sectorTicks[index];
      this.#set({ split: best === undefined ? null : step.tick - best });
    }
    if (this.#progress.finishTick !== null) {
      this.#driver?.setPaused(true);
      this.#set({
        phase: 'finished',
        progress: this.#progress,
        mechanics: this.#sim?.getMechanics() ?? null,
      });
      this.#save('finished');
      this.audio.setRoll(0, false);
      this.audio.play('click');
      this.#syncPhone();
      return true;
    }
    return !!this.#recovery;
  };
  #syncPhone() {
    if (!this.#phone || this.#view.phase === 'error') return;
    this.#phone.sendState({
      version: 1,
      phase: this.#view.phase,
      elapsedTicks: this.#progress.tick,
      simHz: SIM_HZ,
      sector: this.#progress.sectorTicks.length,
      totalSectors: this.course.gates.filter((gate) => gate.kind === 'sector').length,
      practice: this.#progress.reasons.length > 0,
      ...(this.#sim
        ? { lives: this.#sim.getMechanics().lives, maxLives: this.#sim.getMechanics().maxLives }
        : {}),
      ...(this.course.stunts && this.#sim ? { boost: this.#sim.getMechanics() } : {}),
      ...(this.#view.split === null ? {} : { splitDeltaTicks: this.#view.split }),
    });
  }
  #frame = (now: number) => {
    if (this.#disposed) return;
    this.#raf = requestAnimationFrame(this.#frame);
    const rawDt = Math.max(0, (now - this.#lastFrame) / 1000);
    const dt = Math.min(0.1, rawDt) * (this.#test.timeScale ?? 1);
    this.#lastFrame = now;
    if (
      this.#view.input === 'tilt' &&
      (this.#view.phase === 'countdown' || this.#view.phase === 'racing') &&
      !canAdvance(this.#motionContext())
    )
      this.pause('pause');
    if (this.#frameTimes.length < 3600 && this.#view.phase === 'racing') this.#frameTimes.push(rawDt * 1000);
    const keyboard = this.#keyboard?.sample(now) ?? neutralSample(0);
    const gamepad = this.#gamepad?.sample(now) ?? neutralSample(0);
    const phone = this.#phone?.sample(now);
    // Touch is read without acknowledging anything; only a simulation tick consumes a press (below).
    if (this.touch && this.#view.phase !== 'racing') this.touch.clearPending();
    const touch = this.#view.input === 'touch' ? (this.touch?.peek(now) ?? null) : null;
    if (this.#view.phase !== 'racing' || this.#falling || this.#recovery) this.tiltSource?.clearPending();
    const tilt = this.#view.input === 'tilt' ? this.tiltSource?.peek(now) : null;
    const fromTouch =
      !!touch &&
      !(gamepad.power || gamepad.jump) &&
      !(keyboard.power || keyboard.jump || keyboard.tiltX || keyboard.tiltZ);
    let sample = tilt
      ? tilt
      : this.#view.input === 'phone' && phone
        ? phone
        : gamepad.power || gamepad.jump
          ? gamepad
          : fromTouch && touch
            ? touch
            : keyboard;
    if (!sample.jump) this.#jumpArmed = true;
    // Touch needs no arming: its source drops any press held into a non-racing phase (`clearPending`).
    if (!this.#jumpArmed && !fromTouch) sample = { ...sample, jump: false };
    if (this.#view.phase === 'countdown') {
      this.#countdown -= dt;
      const countdown = Math.max(0, Math.ceil(this.#countdown));
      if (countdown !== this.#view.countdown) this.#set({ countdown });
      if (this.#countdown <= 0 && this.#focusLost) {
        this.pause('focus-loss');
      } else if (this.#countdown <= 0 && this.#view.input === 'phone' && !this.#phone?.canStart) {
        this.pause('controller-disconnect');
      } else if (this.#countdown <= 0) {
        this.#jumpArmed = false;
        this.#set({ phase: 'racing' });
        this.#driver?.setPaused(false);
      }
    } else if (this.#view.phase === 'racing' && this.#driver) {
      if (this.#recovery) {
        const recovery = this.#recovery;
        this.#recovery = null;
        this.#progress = markPractice(this.#progress, recovery.reason === 'fall' ? 'fall' : 'recovery');
        if (
          !this.#recorder.recover({
            beforeTick: this.#driver.tick + 1,
            destination: recovery.at,
            reason: recovery.reason,
          })
        )
          this.#progress = markPractice(this.#progress, 'recording-limit');
        this.#turboRequested = false;
        this.tiltSource?.clearPending();
        this.#phone?.discardTurboRequest();
        if (recovery.reason === 'recovery') this.#sim?.penalizeRecovery();
        if (this.#endExhausted()) return;
        this.#driver.reset(recovery.at);
        this.#falling = false;
        void this.#engine?.spawnBall(recovery.at, { durationSec: 0.01 });
      }
      const result = this.#driver.advance(
        dt,
        (tick) => {
          const phoneTurbo = this.#view.input === 'phone' && !!this.#phone?.takeTurboRequest();
          const turbo = this.#turboRequested || phoneTurbo;
          this.#turboRequested = false;
          // The first eligible tick acknowledges a pending Jump; catch-up ticks see the held state only.
          let stepSample = sample;
          if (this.#view.input === 'tilt' && this.tiltSource)
            stepSample = canAdvance(this.#motionContext())
              ? this.tiltSource.sample(performance.now())
              : neutralSample(sample.frameYaw);
          if (fromTouch && this.touch) {
            stepSample = this.touch.sample(performance.now());
          }
          const input: RaceInputSample = this.#test.inputs?.[tick] ?? {
            ...(this.#falling ? neutralSample(stepSample.frameYaw) : stepSample),
            ...(this.course.stunts ? { turbo: !this.#falling && turbo } : {}),
          };
          if (!this.#recorder.record(input)) this.#progress = markPractice(this.#progress, 'recording-limit');
          return input;
        },
        () => false,
        this.#observe,
      );
      if (result.ball) {
        this.#engine?.setBall(result.ball, result.alpha);
        this.audio.setRoll(
          this.#view.phase === 'racing' ? Math.hypot(...result.ball.vel) : 0,
          result.ball.grounded,
        );
      }
    }
    if (this.#engine) {
      const control = this.#view.phase === 'racing' ? sample : neutralSample(sample.frameYaw);
      this.#engine.setControl(control);
      const ball = this.#simReady ? (this.#sim?.getBallState().pos ?? [0, 0, 0]) : [0, 0, 0];
      for (const ghost of this.#ghosts) ghost.update(this.#driver?.tick ?? 0, ball);
      this.#engine.frame(dt);
    }
    if (now - this.#publishAt > 80) {
      this.#publishAt = now;
      const velocity = this.#simReady ? this.#sim?.getBallState().vel : undefined;
      this.#set({
        progress: this.#progress,
        mechanics: this.#sim?.getMechanics() ?? null,
        speed: velocity ? Math.hypot(velocity[0], velocity[2]) : 0,
      });
      this.#syncPhone();
    }
  };
  debugState() {
    return {
      ...this.#view,
      courseId: this.course.courseId,
      tick: this.#driver?.tick ?? 0,
      ball: this.#simReady ? this.#sim?.getBallState() : null,
      engine: this.#engine?.stats(),
      recordingTicks: this.#recorder.ticks,
      frameTimes: this.#frameTimes,
      pose: this.#engine?.debug().camera.position.toArray(),
    };
  }
  dispose() {
    this.#save('abandoned');
    this.#disposed = true;
    ++this.#generation;
    cancelAnimationFrame(this.#raf);
    this.#cleanups.forEach((cleanup) => {
      cleanup();
    });
    this.#keyboard?.dispose();
    this.#gamepad?.dispose();
    this.#phone?.dispose();
    this.touch?.dispose();
    this.motion?.dispose();
    this.tiltSource?.dispose();
    this.#ghostClient.dispose();
    this.#ghosts.forEach((ghost) => {
      ghost.dispose();
    });
    this.#markers?.dispose();
    this.#driver?.dispose();
    this.#engine?.dispose();
    this.#texture?.close();
    this.audio.dispose();
    this.#host?.replaceChildren();
    this.#listeners.clear();
  }
}
