/**
 * Phone controller session (the `/c/:code` page's brain, framework-free so it's testable in Node).
 *
 * Flow: connect → "Enable tilt" tap (iOS motion permission) → calibrate (first game only, 15 s timeout) →
 * play. Streams 12-byte INPUT frames at ≤ 60 Hz with requestAnimationFrame while visible, plus an
 * immediate frame on every button change. Answers host `state`/`haptic`, keeps the screen awake, and
 * reconnects right away when the page becomes visible again (phone unlocked).
 *
 * Diagnostics: every notable event is logged with the `[wwm-controller]` prefix, and `diag()` returns a
 * snapshot (the page exposes it as `window.__wwmController`). The relay's `/api/rooms/:code/stats`
 * mirrors input rate, button presses, `calibrated` and RTT for remote verification.
 */
import {
  CALIBRATION_TIMEOUT_MS,
  CalibrationDetector,
  type ConnectionState,
  ControllerConnection,
  clampTilt,
  DEFAULT_NEUTRAL_GRAVITY,
  indicator,
  type OrientationAngles,
  orientationToTilt,
  roomWsUrl,
  StreamStats,
  screenToDevice,
  type Tilt,
  TooTiltedDetector,
  type Vec3,
  type WebSocketFactory,
} from '@wwm/net';
import type { HapticPattern, StateMessage } from '@wwm/schema';

export type ControllerScreen =
  | 'connecting'
  | 'not-found'
  | 'replaced'
  | 'enable'
  | 'requesting'
  | 'denied'
  | 'no-sensor'
  | 'calibrate'
  | 'calibration-failed'
  | 'play';

export type ButtonName = 'power' | 'jump' | 'menu';

export interface ControllerView {
  code: string;
  screen: ControllerScreen;
  connection: ConnectionState;
  hostConnected: boolean;
  rttP50: number | null;
  rttP95: number | null;
  /** Unclamped calibrated tilt (rad) and its normalized indicator position. */
  tilt: Tilt;
  dot: { x: number; z: number; r: number };
  tooTilted: boolean;
  calibration: { progress: number; remainingMs: number };
  buttons: Record<ButtonName, boolean>;
  host: StateMessage | null;
  landscape: boolean;
  sendRate: number;
  sensorRate: number;
  permission: 'unknown' | 'granted' | 'denied' | 'not-required';
  lastHaptic: HapticPattern | null;
}

export interface ControllerEnv {
  origin: string;
  now: () => number;
  requestAnimationFrame: (cb: (t: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  /** Where `deviceorientation` fires (window). */
  sensorTarget: EventTarget;
  /** Where `visibilitychange` fires (document). */
  visibilityTarget: EventTarget;
  isVisible: () => boolean;
  screenAngle: () => number;
  /** Fires `change` on rotation (screen.orientation) — optional. */
  orientationTarget?: EventTarget;
  /** `DeviceOrientationEvent` constructor (for `requestPermission`), or undefined if unsupported. */
  DeviceOrientationEvent?: { requestPermission?: () => Promise<'granted' | 'denied' | string> };
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  vibrate?: (pattern: number[]) => boolean;
  /** iOS 18+ has no Vibration API; toggling a `<input type=checkbox switch>` gives a haptic tick. */
  iosHapticTick?: () => void;
  requestWakeLock?: () => Promise<unknown>;
  requestFullscreenAndLock?: () => Promise<unknown>;
  createSocket?: WebSocketFactory;
  log?: (...args: unknown[]) => void;
}

const SEND_INTERVAL_MS = 1000 / 60 - 1;
const SENSOR_TIMEOUT_MS = 2500;
const SILENCE_RECONNECT_MS = 3000;
const ZERO_KEY = 'wwm.controller.zero';

export const HAPTIC_PATTERNS: Record<HapticPattern, number[]> = {
  item: [12],
  large: [30, 40, 30],
  fall: [140],
  goal: [40, 40, 40, 40, 160],
};

type Listener = () => void;

export class ControllerSession {
  readonly code: string;
  readonly conn: ControllerConnection;
  readonly #env: ControllerEnv;
  readonly #listeners = new Set<Listener>();
  readonly #sendStats = new StreamStats(120);
  readonly #sensorStats = new StreamStats(120);
  readonly #tooTilted = new TooTiltedDetector();
  #view: ControllerView;
  #orientation: OrientationAngles | null = null;
  #zero: Vec3 | null = null; // device frame
  #calib: CalibrationDetector | null = null;
  #raf: number | null = null;
  #lastSendAt = Number.NEGATIVE_INFINITY;
  #sensorTimer: ReturnType<typeof setTimeout> | null = null;
  #cleanup: (() => void)[] = [];
  #sensorOn = false;
  #awaitingSensor = false;
  #disposed = false;
  #calibratedSent = 0;

  constructor(code: string, env: ControllerEnv) {
    this.code = code;
    this.#env = env;
    this.#zero = this.#loadZero();
    this.conn = new ControllerConnection({
      url: roomWsUrl(env.origin, code, 'controller'),
      now: env.now,
      ...(env.createSocket ? { createSocket: env.createSocket } : {}),
    });
    this.#view = {
      code,
      screen: 'connecting',
      connection: 'idle',
      hostConnected: false,
      rttP50: null,
      rttP95: null,
      tilt: { tiltX: 0, tiltZ: 0 },
      dot: { x: 0, z: 0, r: 0 },
      tooTilted: false,
      calibration: { progress: 0, remainingMs: CALIBRATION_TIMEOUT_MS },
      buttons: { power: false, jump: false, menu: false },
      host: null,
      landscape: env.screenAngle() % 180 !== 0,
      sendRate: 0,
      sensorRate: 0,
      permission: 'unknown',
      lastHaptic: null,
    };
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────────────────────

  start(): void {
    const c = this.conn;
    this.#cleanup.push(
      c.on('state', (s) => this.#patch({ connection: s })),
      c.on('open', () => {
        this.#log('socket open');
        if (this.#view.screen === 'connecting') this.#patch({ screen: 'enable' });
      }),
      c.on('close', (i) => this.#log(`socket closed code=${i.code} reconnect=${i.willReconnect}`)),
      c.on('error', (e) => {
        this.#log(`fatal: ${e}`);
        this.#patch({ screen: e === 'replaced' ? 'replaced' : 'not-found' });
      }),
      c.on('peer', (role, connected) => {
        if (role !== 'host') return;
        this.#log(`host ${connected ? 'connected' : 'disconnected'}`);
        this.#patch({ hostConnected: connected });
        if (connected && this.#view.screen === 'play') this.#sendCalibrated();
      }),
      c.on('rtt', () => {
        const s = c.rtt.summary();
        this.#patch({ rttP50: s.p50, rttP95: s.p95 });
      }),
      c.on('message', (m) => {
        if (m.t === 'state') {
          this.#patch({ host: m });
          if (m.phase === 'calibrate' && this.#view.screen === 'play') this.#sendCalibrated();
        } else if (m.t === 'haptic') this.#haptic(m.pattern);
      }),
    );
    const onVis = () => {
      if (this.#env.isVisible()) {
        this.#log('visible: checking socket');
        if (this.conn.reconnectIfSilent(SILENCE_RECONNECT_MS))
          this.#log('socket was silent: reconnecting now');
        if (this.#sensorOn) void this.#wakeLock();
        this.#loop();
      } else {
        this.#stopLoop();
        this.#releaseButtons();
      }
    };
    this.#env.visibilityTarget.addEventListener('visibilitychange', onVis);
    this.#cleanup.push(() => this.#env.visibilityTarget.removeEventListener('visibilitychange', onVis));
    const onRotate = () => {
      const landscape = this.#env.screenAngle() % 180 !== 0;
      this.#log(`screen angle ${this.#env.screenAngle()}`);
      this.#patch({ landscape });
    };
    this.#env.orientationTarget?.addEventListener('change', onRotate);
    this.#cleanup.push(() => this.#env.orientationTarget?.removeEventListener('change', onRotate));
    c.connect();
    this.#loop();
  }

  dispose(): void {
    this.#disposed = true;
    this.#stopLoop();
    if (this.#sensorTimer) clearTimeout(this.#sensorTimer);
    for (const f of this.#cleanup) f();
    this.#cleanup = [];
    this.conn.close();
    this.#listeners.clear();
  }

  // ── React glue (useSyncExternalStore) ───────────────────────────────────────────────────────────────

  subscribe = (l: Listener): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  getView = (): ControllerView => this.#view;

  #patch(p: Partial<ControllerView>): void {
    let changed = false;
    for (const k of Object.keys(p) as (keyof ControllerView)[]) {
      if (this.#view[k] !== p[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.#view = { ...this.#view, ...p };
    for (const l of [...this.#listeners]) l();
  }

  #log(msg: string): void {
    (this.#env.log ?? console.info)(`[wwm-controller ${this.code}] ${msg}`);
  }

  // ── permission, sensor, calibration ─────────────────────────────────────────────────────────────────

  /** Call directly from the "Enable tilt" tap handler (iOS requires a user gesture). */
  enableTilt(): void {
    void this.#wakeLock();
    void this.#env.requestFullscreenAndLock?.().catch(() => {});
    const DOE = this.#env.DeviceOrientationEvent;
    if (!DOE) {
      this.#log('no DeviceOrientationEvent');
      this.#patch({ screen: 'no-sensor', permission: 'not-required' });
      return;
    }
    if (typeof DOE.requestPermission === 'function') {
      this.#patch({ screen: 'requesting' });
      DOE.requestPermission().then(
        (res) => {
          this.#log(`motion permission: ${res}`);
          if (res === 'granted') {
            this.#patch({ permission: 'granted' });
            this.#startSensor();
          } else this.#patch({ screen: 'denied', permission: 'denied' });
        },
        (err: unknown) => {
          this.#log(`motion permission error: ${String(err)}`);
          this.#patch({ screen: 'denied', permission: 'denied' });
        },
      );
      return;
    }
    this.#patch({ permission: 'not-required' });
    this.#startSensor();
  }

  #startSensor(): void {
    if (!this.#sensorOn) {
      this.#sensorOn = true;
      const onOrientation = (ev: Event) => {
        const e = ev as unknown as OrientationAngles;
        if (e.beta == null || e.gamma == null) return;
        this.#orientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
        this.#sensorStats.add(this.#env.now());
        if (this.#awaitingSensor) {
          this.#awaitingSensor = false;
          if (this.#sensorTimer) clearTimeout(this.#sensorTimer);
          this.#sensorTimer = null;
          this.#log('first orientation event');
          this.#afterSensor();
        }
      };
      this.#env.sensorTarget.addEventListener('deviceorientation', onOrientation);
      this.#cleanup.push(() =>
        this.#env.sensorTarget.removeEventListener('deviceorientation', onOrientation),
      );
    }
    if (this.#orientation) {
      this.#afterSensor();
      return;
    }
    this.#patch({ screen: 'requesting' });
    this.#awaitingSensor = true;
    this.#sensorTimer = setTimeout(() => {
      this.#sensorTimer = null;
      if (!this.#orientation) {
        this.#log('no orientation events');
        this.#patch({ screen: 'no-sensor' });
      }
    }, SENSOR_TIMEOUT_MS);
  }

  #afterSensor(): void {
    if (this.#zero) {
      this.#log('using stored calibration');
      this.#enterPlay();
    } else this.#startCalibration();
  }

  #startCalibration(): void {
    this.#calib = new CalibrationDetector(this.#env.now());
    this.#log('calibration started');
    this.#patch({ screen: 'calibrate', calibration: { progress: 0, remainingMs: CALIBRATION_TIMEOUT_MS } });
  }

  retryCalibration(): void {
    this.#zero = null;
    this.#env.storage?.removeItem(ZERO_KEY);
    if (this.#orientation) this.#startCalibration();
    else this.#startSensor();
  }

  /** Manual "Use this position" during calibration (or recalibrate in play). */
  calibrateHere(): void {
    const g = this.#screenGravity();
    if (!g) return;
    this.#finishCalibration(g, 'manual');
  }

  #finishCalibration(screenGravity: Vec3, how: string): void {
    this.#zero = screenToDevice(screenGravity, this.#env.screenAngle());
    this.#calib = null;
    try {
      this.#env.storage?.setItem(ZERO_KEY, JSON.stringify(this.#zero));
    } catch {
      // private mode: calibration just won't persist
    }
    this.#log(`calibrated (${how}) zero=[${this.#zero.map((v) => v.toFixed(3)).join(', ')}]`);
    this.#enterPlay();
  }

  #enterPlay(): void {
    this.#patch({ screen: 'play' });
    this.#sendCalibrated();
  }

  #sendCalibrated(): void {
    if (this.conn.send({ t: 'calibrated' })) this.#calibratedSent++;
  }

  #loadZero(): Vec3 | null {
    try {
      const raw = this.#env.storage?.getItem(ZERO_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as unknown;
      if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        return v as Vec3;
      }
    } catch {
      // ignore
    }
    return null;
  }

  #screenGravity(): Vec3 | null {
    if (!this.#orientation) return null;
    return orientationToTilt(this.#orientation, this.#env.screenAngle())?.gravity ?? null;
  }

  // ── buttons ─────────────────────────────────────────────────────────────────────────────────────────

  setButton(name: ButtonName, pressed: boolean): void {
    if (this.#view.buttons[name] === pressed) return;
    this.#patch({ buttons: { ...this.#view.buttons, [name]: pressed } });
    if (pressed) this.#log(`${name} down`);
    this.#send(true);
  }

  #releaseButtons(): void {
    const b = this.#view.buttons;
    if (b.power || b.jump || b.menu) this.#patch({ buttons: { power: false, jump: false, menu: false } });
  }

  // ── haptics / wake lock ─────────────────────────────────────────────────────────────────────────────

  #haptic(p: HapticPattern): void {
    const pattern = HAPTIC_PATTERNS[p];
    let how = 'none';
    if (this.#env.vibrate?.(pattern)) how = 'vibrate';
    else if (this.#env.iosHapticTick) {
      this.#env.iosHapticTick();
      how = 'ios-switch';
    }
    this.#log(`haptic ${p} via ${how}`);
    this.#patch({ lastHaptic: p });
  }

  async #wakeLock(): Promise<void> {
    try {
      await this.#env.requestWakeLock?.();
    } catch (e) {
      this.#log(`wake lock failed: ${String(e)}`);
    }
  }

  // ── frame loop ──────────────────────────────────────────────────────────────────────────────────────

  #loop = (): void => {
    if (this.#disposed || this.#raf !== null) return;
    const tick = () => {
      this.#raf = null;
      if (this.#disposed || !this.#env.isVisible()) return;
      this.#step();
      this.#raf = this.#env.requestAnimationFrame(tick);
    };
    this.#raf = this.#env.requestAnimationFrame(tick);
  };

  #stopLoop(): void {
    if (this.#raf !== null) this.#env.cancelAnimationFrame(this.#raf);
    this.#raf = null;
  }

  /** One frame: update tilt/calibration state and maybe send. Public for tests. */
  step(): void {
    this.#step();
  }

  #step(): void {
    const now = this.#env.now();
    const screen = this.#view.screen;
    if (this.#orientation && (screen === 'calibrate' || screen === 'play')) {
      const angle = this.#env.screenAngle();
      const zero =
        screen === 'play' && this.#zero ? this.#zero : screenToDevice(DEFAULT_NEUTRAL_GRAVITY, angle);
      const r = orientationToTilt(this.#orientation, angle, zero);
      if (r) {
        const patch: Partial<ControllerView> = { tilt: r.raw, dot: indicator(r.raw) };
        if (screen === 'play') patch.tooTilted = this.#tooTilted.update(r.raw, now);
        if (screen === 'calibrate' && this.#calib) {
          const st = this.#calib.update(r.gravity, now);
          if (st.state === 'done') {
            this.#patch(patch);
            this.#finishCalibration(st.zero, 'auto');
            return;
          }
          if (st.state === 'timeout') {
            this.#log('calibration timeout (15 s)');
            this.#calib = null;
            this.#patch({ ...patch, screen: 'calibration-failed' });
            return;
          }
          patch.calibration = {
            progress: st.progress,
            remainingMs: Math.max(0, this.#calib.timeoutMs - (now - this.#calib.startedAt)),
          };
        }
        this.#patch(patch);
      }
    } else if (screen === 'calibrate' && this.#calib) {
      if (this.#calib.update(null, now).state === 'timeout') {
        this.#calib = null;
        this.#patch({ screen: 'calibration-failed' });
      }
    }
    this.#send(false);
    const s = this.#sendStats.summary(now);
    const sensor = this.#sensorStats.summary(now);
    this.#patch({ sendRate: s.ratePerSec, sensorRate: sensor.ratePerSec });
  }

  #send(force: boolean): void {
    const screen = this.#view.screen;
    if (screen !== 'play' && screen !== 'calibrate') return;
    const now = this.#env.now();
    if (!force && now - this.#lastSendAt < SEND_INTERVAL_MS) return;
    const t = this.#orientation ? this.#view.tilt : { tiltX: 0, tiltZ: 0 };
    const c = clampTilt(t);
    const b = this.#view.buttons;
    const playing = screen === 'play';
    if (
      this.conn.sendInput({
        tiltX: c.tiltX,
        tiltZ: c.tiltZ,
        power: playing && b.power,
        jump: playing && b.jump,
        menu: playing && b.menu,
      })
    ) {
      this.#lastSendAt = now;
      this.#sendStats.add(now);
    }
  }

  /** Snapshot for remote verification (`window.__wwmController.diag()`). */
  diag(): Record<string, unknown> {
    const now = this.#env.now();
    return {
      code: this.code,
      screen: this.#view.screen,
      permission: this.#view.permission,
      connection: this.conn.state,
      hostConnected: this.#view.hostConnected,
      rtt: this.conn.rtt.summary(),
      send: this.#sendStats.summary(now),
      sensor: this.#sensorStats.summary(now),
      framesSent: this.conn.sent,
      framesSkipped: this.conn.skipped,
      calibratedSent: this.#calibratedSent,
      zero: this.#zero,
      tiltDeg: {
        x: +((this.#view.tilt.tiltX * 180) / Math.PI).toFixed(2),
        z: +((this.#view.tilt.tiltZ * 180) / Math.PI).toFixed(2),
      },
      landscape: this.#view.landscape,
      lastHaptic: this.#view.lastHaptic,
    };
  }
}
