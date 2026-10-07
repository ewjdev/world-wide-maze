/** Local sensor permission, responsive-reading check and lifecycle. Never opens a controller room. */
import {
  angleBetween,
  gravityFromOrientation,
  normalize3,
  type OrientationAngles,
  type TiltInputSource,
  type Vec3,
} from '@wwm/net';
import { screenAngle, watchOrientation } from './layout.ts';

export type MotionState =
  | 'idle'
  | 'requesting'
  | 'probing'
  | 'calibrating'
  | 'ready'
  | 'interrupted'
  | 'denied'
  | 'unavailable'
  | 'disposed';
export type MotionReason =
  | 'secure'
  | 'unsupported'
  | 'permission'
  | 'readings'
  | 'health'
  | 'pose'
  | 'focus'
  | 'rotation'
  | 'recenter'
  | null;
export interface MotionSnapshot {
  state: MotionState;
  reason: MotionReason;
  generation: number;
  permission: 'unknown' | 'granted' | 'denied';
  progress: number;
  captureAvailable: boolean;
  healthy: boolean;
  calibration: number | null;
}
export interface MotionReading {
  gravity: { x: number | null; y: number | null; z: number | null } | null;
  rotation: { beta: number | null; gamma: number | null } | null;
}
export interface MotionEnvironment {
  now(): number;
  secure(): boolean;
  supported(): boolean;
  visible(): boolean;
  angle(): number;
  requestOrientation?(): Promise<string>;
  requestMotion?(): Promise<string>;
  orientation(listener: (reading: OrientationAngles) => void): () => void;
  motion(listener: (reading: MotionReading) => void): () => void;
  inactive(listener: (reason: 'focus' | 'rotation') => void): () => void;
  interval(listener: () => void): () => void;
}

function browserEnvironment(): MotionEnvironment {
  type PermissionConstructor = { requestPermission?: () => Promise<string> };
  const orientation =
    typeof window === 'undefined'
      ? undefined
      : (window.DeviceOrientationEvent as PermissionConstructor | undefined);
  const motion =
    typeof window === 'undefined'
      ? undefined
      : (window.DeviceMotionEvent as PermissionConstructor | undefined);
  const requestOrientation = orientation?.requestPermission?.bind(orientation);
  const requestMotion = motion?.requestPermission?.bind(motion);
  return {
    now: () => performance.now(),
    secure: () => window.isSecureContext,
    supported: () => !!orientation && !!motion,
    visible: () => !document.hidden && document.hasFocus(),
    angle: screenAngle,
    ...(requestOrientation ? { requestOrientation } : {}),
    ...(requestMotion ? { requestMotion } : {}),
    orientation: (listener) => {
      const receive = (event: DeviceOrientationEvent) => listener(event);
      window.addEventListener('deviceorientation', receive);
      return () => window.removeEventListener('deviceorientation', receive);
    },
    motion: (listener) => {
      const receive = (event: DeviceMotionEvent) =>
        listener({ gravity: event.accelerationIncludingGravity, rotation: event.rotationRate });
      window.addEventListener('devicemotion', receive);
      return () => window.removeEventListener('devicemotion', receive);
    },
    inactive: (listener) => {
      const blur = () => listener('focus');
      const hidden = () => {
        if (document.hidden) listener('focus');
      };
      window.addEventListener('blur', blur);
      document.addEventListener('visibilitychange', hidden);
      const offRotation = watchOrientation(() => listener('rotation'));
      return () => {
        window.removeEventListener('blur', blur);
        document.removeEventListener('visibilitychange', hidden);
        offRotation();
      };
    },
    interval: (listener) => {
      const id = window.setInterval(listener, 100);
      return () => window.clearInterval(id);
    },
  };
}

// Preview candidates, not physical qualification. Motion heartbeat prevents stillness timeouts; a changed
// gravity vector / sustained pitch-roll rate without updated orientation detects a frozen steering stream.
export const MOTION_PROBE_MS = 2500;
export const MOTION_MOVEMENT_MS = 12_000;
export const MOTION_LOSS_MS = 1500;
export const MOTION_FROZEN_MS = 800;
const DEG = Math.PI / 180;
const HOLD_MS = 700;

export class MotionSession {
  readonly source: TiltInputSource;
  #env: MotionEnvironment;
  #snapshot: MotionSnapshot = {
    state: 'idle',
    reason: null,
    generation: 0,
    permission: 'unknown',
    progress: 0,
    captureAvailable: false,
    healthy: false,
    calibration: null,
  };
  #listeners = new Set<() => void>();
  #cleanups: (() => void)[] = [];
  #started = 0;
  #lastOrientation = -Infinity;
  #lastMotion = -Infinity;
  #motionCount = 0;
  #initial: Vec3 | null = null;
  #gravity: Vec3 | null = null;
  #angles: OrientationAngles | null = null;
  #candidate: Vec3 | null = null;
  #heldAt = 0;
  #invalidAt: number | null = null;
  #mismatchAt: number | null = null;
  #changed = false;
  #calibrationId = 0;
  constructor(source: TiltInputSource, env: MotionEnvironment = browserEnvironment()) {
    this.source = source;
    this.#env = env;
  }
  getSnapshot = (): MotionSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  #set(patch: Partial<MotionSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const listener of this.#listeners) listener();
  }
  #stop(): void {
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.source.reset();
  }
  /** Called directly by the Enable/Check gesture: both permission requests start before the first await. */
  enableTilt = async (): Promise<void> => {
    if (this.#snapshot.state === 'disposed' || this.#snapshot.state === 'requesting') return;
    this.#stop();
    const generation = this.#snapshot.generation + 1;
    this.#set({
      generation,
      state: 'requesting',
      reason: null,
      healthy: false,
      progress: 0,
      captureAvailable: false,
      calibration: null,
    });
    if (!this.#env.secure()) {
      this.#set({ state: 'unavailable', reason: 'secure' });
      return;
    }
    if (!this.#env.supported()) {
      this.#set({ state: 'unavailable', reason: 'unsupported' });
      return;
    }
    try {
      // Promise.resolve().then would lose the synchronous user-activation boundary.
      const orientation = this.#env.requestOrientation?.() ?? Promise.resolve('granted');
      const motion = this.#env.requestMotion?.() ?? Promise.resolve('granted');
      const permissions = await Promise.all([orientation, motion]);
      if (generation !== this.#snapshot.generation) return;
      if (permissions.some((permission) => permission !== 'granted')) {
        this.#set({ state: 'denied', reason: 'permission', permission: 'denied' });
        return;
      }
      if (!this.#env.visible()) {
        this.suspend('focus');
        return;
      }
      this.#started = this.#env.now();
      this.#lastOrientation = this.#lastMotion = -Infinity;
      this.#motionCount = 0;
      this.#gravity = this.#initial = this.#candidate = null;
      this.#angles = null;
      this.#changed = false;
      this.#invalidAt = this.#mismatchAt = null;
      this.#set({ state: 'probing', permission: 'granted' });
      const current = () => generation === this.#snapshot.generation;
      this.#cleanups.push(
        this.#env.orientation((reading) => {
          if (current()) this.#orientation(reading);
        }),
        this.#env.motion((reading) => {
          if (current()) this.#motion(reading);
        }),
        this.#env.inactive((reason) => {
          if (current()) this.suspend(reason);
        }),
        this.#env.interval(() => {
          if (current()) this.#check();
        }),
      );
    } catch {
      if (generation === this.#snapshot.generation)
        this.#set({ state: 'denied', reason: 'permission', permission: 'denied' });
    }
  };
  checkAgain = (): Promise<void> => this.enableTilt();
  #orientation(angles: OrientationAngles): void {
    const now = this.#env.now();
    const gravity = gravityFromOrientation(angles);
    if (!gravity) {
      this.#invalidAt ??= now;
      if (now - this.#invalidAt >= MOTION_FROZEN_MS) this.suspend('readings');
      return;
    }
    this.#invalidAt = null;
    this.#lastOrientation = now;
    this.#angles = angles;
    this.#gravity = gravity;
    this.#initial ??= gravity;
    if (angleBetween(gravity, this.#initial) >= 4 * DEG) this.#changed = true;
    if (this.#snapshot.state === 'ready') this.source.update(angles, this.#env.angle(), now);
    else this.#calibrate(now);
  }
  #motion(reading: MotionReading): void {
    const now = this.#env.now();
    const g = reading.gravity;
    const components = g ? [g.x, g.y, g.z] : [];
    if (
      components.length !== 3 ||
      components.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    )
      return;
    const vector = components as Vec3;
    const magnitude = Math.hypot(...vector);
    // Only stable approximately-1g data can compare gravity, not a tap / shake / free fall.
    if (magnitude < 7 || magnitude > 12) return;
    this.#lastMotion = now;
    this.#motionCount++;
    const motionGravity = normalize3(vector.map((value) => -value) as Vec3);
    const mismatch = !!this.#gravity && angleBetween(motionGravity, this.#gravity) > 12 * DEG;
    const rotating = Math.hypot(reading.rotation?.beta ?? 0, reading.rotation?.gamma ?? 0) > 8;
    if (mismatch || (rotating && now - this.#lastOrientation > 200)) this.#mismatchAt ??= now;
    else this.#mismatchAt = null;
    this.#check();
    if (this.#snapshot.state !== 'ready') this.#calibrate(now);
  }
  #calibrate(now: number): void {
    const gravity = this.#gravity;
    if (!gravity || !this.#changed || this.#motionCount < 3 || !this.#healthy(now)) return;
    if (this.#snapshot.state === 'probing') {
      this.#candidate = gravity;
      this.#heldAt = now;
      this.#set({ state: 'calibrating', progress: 0 });
    }
    if (this.#snapshot.state !== 'calibrating') return;
    // Facing roughly upwards keeps the two-axis gravity solve well conditioned in either screen orientation.
    const pose = gravity[2] < -0.2;
    if (!this.#candidate || angleBetween(gravity, this.#candidate) > 2 * DEG) {
      this.#candidate = gravity;
      this.#heldAt = now;
    }
    const progress = pose ? Math.min(1, (now - this.#heldAt) / HOLD_MS) : 0;
    this.#set({
      progress,
      captureAvailable: pose && now - this.#lastOrientation < MOTION_LOSS_MS,
      reason: pose ? null : 'pose',
    });
    if (progress === 1) this.captureHere();
  }
  captureHere = (): void => {
    if (
      this.#snapshot.state !== 'calibrating' ||
      !this.#snapshot.captureAvailable ||
      !this.#gravity ||
      !this.#angles ||
      !this.#healthy(this.#env.now())
    )
      return;
    this.source.calibrate(this.#gravity);
    this.source.update(this.#angles, this.#env.angle(), this.#env.now());
    this.#set({
      state: 'ready',
      reason: null,
      healthy: true,
      progress: 1,
      calibration: ++this.#calibrationId,
    });
  };
  /** Healthy change-driven orientation can be reused after releasing contacts; no movement is required. */
  restoreInput(): void {
    if (this.#snapshot.state === 'ready' && this.#angles && this.#healthy(this.#env.now()))
      this.source.update(this.#angles, this.#env.angle(), this.#env.now());
  }
  #healthy(now: number): boolean {
    return (
      this.#env.visible() &&
      now - this.#lastMotion <= MOTION_LOSS_MS &&
      this.#gravity !== null &&
      (this.#mismatchAt === null || now - this.#mismatchAt < MOTION_FROZEN_MS) &&
      (this.#invalidAt === null || now - this.#invalidAt < MOTION_FROZEN_MS)
    );
  }
  #check(): void {
    const now = this.#env.now();
    if (!this.#env.visible()) {
      this.suspend('focus');
      return;
    }
    if (
      this.#snapshot.state === 'probing' &&
      (((!this.#gravity || this.#motionCount < 3) && now - this.#started >= MOTION_PROBE_MS) ||
        now - this.#started >= MOTION_MOVEMENT_MS)
    ) {
      this.#stop();
      this.#set({ state: 'unavailable', reason: 'readings' });
      return;
    }
    if ((this.#snapshot.state === 'ready' || this.#snapshot.state === 'calibrating') && !this.#healthy(now))
      this.suspend('health');
  }
  suspend = (reason: MotionReason = 'focus'): void => {
    if (this.#snapshot.state === 'disposed' || this.#snapshot.state === 'idle') return;
    this.#stop();
    this.#set({
      generation: this.#snapshot.generation + 1,
      state: 'interrupted',
      reason,
      healthy: false,
      progress: 0,
      captureAvailable: false,
      calibration: null,
    });
  };
  reset = (): void => {
    if (this.#snapshot.state === 'disposed') return;
    this.#stop();
    this.#set({
      generation: this.#snapshot.generation + 1,
      state: 'idle',
      reason: null,
      healthy: false,
      calibration: null,
      progress: 0,
      captureAvailable: false,
    });
  };
  dispose(): void {
    this.#stop();
    this.#set({
      state: 'disposed',
      generation: this.#snapshot.generation + 1,
      healthy: false,
      calibration: null,
    });
    this.#listeners.clear();
  }
}

export interface MotionGateContext {
  selected: boolean;
  snapshot: MotionSnapshot | null;
  driverKind?: string;
  visible: boolean;
  intent?: boolean;
  armed?: boolean;
  ownsInput?: boolean;
  contactsReleased?: boolean;
}
function baseReady(context: MotionGateContext): boolean {
  return (
    !context.selected ||
    (context.visible &&
      context.driverKind === 'lockstep' &&
      context.snapshot?.state === 'ready' &&
      context.snapshot.healthy &&
      context.snapshot.calibration !== null)
  );
}
export function canStart(context: MotionGateContext): boolean {
  return baseReady(context) && context.intent === true;
}
export function canResume(context: MotionGateContext): boolean {
  return canStart(context) && context.contactsReleased !== false;
}
export function canAdvance(context: MotionGateContext): boolean {
  return baseReady(context) && context.armed === true && context.ownsInput === true;
}
