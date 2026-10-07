/** Same-device tilt. Browser permission/lifecycle lives in the web adapter; this source owns tick input. */
import { type InputSample, MAX_TILT_PITCH, MAX_TILT_ROLL } from '@wwm/schema';
import { Emitter, type Unsubscribe } from '../emitter.ts';
import type { InputSource, InputSourceEvent, InputSourceOptions } from '../input-source.ts';
import { OneEuroFilter } from '../one-euro.ts';
import { clampTilt, type OrientationAngles, orientationToTilt, type Vec3 } from '../tilt.ts';

interface TapTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  setPointerCapture?(id: number): void;
}
/** Structural event keeps this shared package usable without the browser DOM type library. */
interface TapPointer extends Event {
  pointerId: number;
  pointerType: string;
}

export class TiltInputSource implements InputSource {
  readonly kind = 'tilt' as const;
  #events = new Emitter<Record<InputSourceEvent, () => void>>();
  #yaw: () => number;
  #zero: Vec3 | null = null;
  #x = 0;
  #z = 0;
  #power = false;
  #sensitivity = 1;
  #fx = new OneEuroFilter({ minCutoff: 3, beta: 1.5 });
  #fz = new OneEuroFilter({ minCutoff: 3, beta: 1.5 });
  #pending: { token: number; completed: boolean } | null = null;
  #lastJump = false;
  #nextToken = 0;
  #resets = new Set<() => void>();
  #detaches = new Set<() => void>();
  #contacts = 0;

  constructor(options: InputSourceOptions = {}) {
    this.#yaw = options.frameYaw ?? (() => 0);
  }
  get contactsActive(): boolean {
    return this.#contacts > 0;
  }
  calibrate(zero: Vec3): void {
    this.reset();
    this.#zero = [...zero];
  }
  setSensitivity(value: number): void {
    this.#sensitivity = Number.isFinite(value) ? Math.max(0.5, Math.min(1.5, value)) : 1;
    this.reset();
  }
  update(angles: OrientationAngles, screenAngle: number, now: number): boolean {
    if (!this.#zero) return false;
    const reading = orientationToTilt(angles, screenAngle, this.#zero);
    if (!reading) {
      this.reset();
      return false;
    }
    const tilt = clampTilt({
      tiltX: this.#fx.filter(reading.raw.tiltX, now) * this.#sensitivity,
      tiltZ: this.#fz.filter(reading.raw.tiltZ, now) * this.#sensitivity,
    });
    const magnitude = Math.hypot(tilt.tiltX / MAX_TILT_ROLL, tilt.tiltZ / MAX_TILT_PITCH);
    this.#power = magnitude > (this.#power ? 0.08 : 0.12);
    const gain = this.#power ? Math.max(0, (magnitude - 0.08) / magnitude) : 0;
    this.#x = tilt.tiltX * gain;
    this.#z = tilt.tiltZ * gain;
    return true;
  }
  /** Multiple contacts before a tick coalesce; a later cancellation cannot erase a completed earlier tap. */
  requestJump(): number {
    const token = ++this.#nextToken;
    this.#pending ??= { token, completed: false };
    return token;
  }
  completeJump(token: number): void {
    if (this.#pending?.token === token) this.#pending.completed = true;
  }
  cancelJump(token: number): void {
    if (this.#pending?.token === token && !this.#pending.completed) this.#pending = null;
  }
  clearPending(): void {
    this.#pending = null;
    // Keep the neutral-tick requirement across a pause/reset: the simulation may still remember jump=true.
  }
  #read(): InputSample {
    return {
      tiltX: this.#x,
      tiltZ: this.#z,
      frameYaw: this.#yaw(),
      power: this.#power,
      jump: !!this.#pending && !this.#lastJump,
    };
  }
  peek(_now: number): InputSample {
    return this.#read();
  }
  sample(_now: number): InputSample {
    const sample = this.#read();
    if (sample.jump) this.#pending = null;
    this.#lastJump = sample.jump;
    return sample;
  }
  attachSurface(target: TapTarget, eligible: (event: TapPointer) => boolean): () => void {
    let active: { id: number; token: number } | null = null;
    const release = (cancel: boolean) => {
      if (!active) return;
      if (cancel) this.cancelJump(active.token);
      else this.completeJump(active.token);
      active = null;
      this.#contacts--;
    };
    const down = (event: Event) => {
      const pointer = event as TapPointer;
      if (active || pointer.pointerType !== 'touch' || !eligible(pointer)) return;
      active = { id: pointer.pointerId, token: this.requestJump() };
      this.#contacts++;
      try {
        target.setPointerCapture?.(pointer.pointerId);
      } catch {
        /* cancellation still works */
      }
      pointer.preventDefault();
    };
    const up = (event: Event) => {
      if (active?.id === (event as TapPointer).pointerId) release(false);
    };
    const cancel = (event: Event) => {
      // Normal implicit capture release follows pointerup, which has already cleared active.
      if (active?.id === (event as TapPointer).pointerId) release(true);
    };
    const reset = () => release(true);
    const bindings = [
      ['pointerdown', down],
      ['pointerup', up],
      ['pointercancel', cancel],
      ['lostpointercapture', cancel],
    ] as const;
    for (const [type, listener] of bindings) target.addEventListener(type, listener);
    this.#resets.add(reset);
    const detach = () => {
      for (const [type, listener] of bindings) target.removeEventListener(type, listener);
      reset();
      this.#resets.delete(reset);
      this.#detaches.delete(detach);
      this.clearPending();
    };
    this.#detaches.add(detach);
    return detach;
  }
  reset(): void {
    for (const reset of this.#resets) reset();
    this.clearPending();
    this.#x = this.#z = 0;
    this.#power = false;
    this.#fx.reset();
    this.#fz.reset();
  }
  on(event: InputSourceEvent, callback: () => void): Unsubscribe {
    return this.#events.on(event, callback);
  }
  dispose(): void {
    for (const detach of [...this.#detaches]) detach();
    this.reset();
    this.#zero = null;
    this.#events.clear();
  }
}
