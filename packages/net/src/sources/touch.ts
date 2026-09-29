/**
 * Touch input for single-device play (N): an on-screen analog stick plus JUMP and MENU buttons.
 * Stick range is ±1 (y + = forward/up on screen); tilt = stick × KEYBOARD_TILT, magnitude above the
 * deadzone = POWER. UI code either calls the setters directly or binds elements with `attachStick` /
 * `attachButton`, which own their pointers (one contact per control, capture, cancel on loss).
 *
 * Presentation and simulation read the source differently (plans/mobile-browser-game-execution.md §3):
 * `peek()` never changes state, so frames, HUD readouts and ownership checks can call it freely, while
 * `sample()` consumes the pending JUMP press and belongs only in an eligible fixed-step input callback.
 * A render frame with no simulation tick therefore never drops a quick tap.
 */
import { type InputSample, KEYBOARD_TILT } from '@wwm/schema';
import { Emitter, type Unsubscribe } from '../emitter.ts';
import {
  type InputSource,
  type InputSourceEvent,
  type InputSourceOptions,
  radialDeadzone,
} from '../input-source.ts';

export const TOUCH_DEADZONE = 0.12;
/** Adaptive stick: the visual origin may follow the thumb at most this far (× stick radius) from home. */
export const TOUCH_ORIGIN_SHIFT = 0.6;
export const TOUCH_SENSITIVITY_MIN = 0.5;
export const TOUCH_SENSITIVITY_MAX = 1.5;

export interface PointerTarget {
  addEventListener(type: string, cb: (e: Event) => void): void;
  removeEventListener(type: string, cb: (e: Event) => void): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture?(id: number): void;
}

export type StickOrigin = 'adaptive' | 'fixed';

export interface StickOptions {
  /**
   * `adaptive` (default): the origin follows the first contact, up to `TOUCH_ORIGIN_SHIFT` from home, and stays
   * fixed for the whole gesture; deflection is measured from the first contact, so touching off-centre never
   * accelerates. `fixed`: deflection is read from the visible home position.
   */
  origin?: StickOrigin;
  /**
   * Stick radius in CSS px, read once per gesture. Default: half the element's width. Lets a generous
   * activation region (the bound element) drive a smaller visible stick centred in it.
   */
  radius?: () => number;
  /** Called on press/move/release with the stick geometry, for the visual thumb (coalesce in the caller). */
  onChange?: (state: StickVisual) => void;
}

/** Geometry for drawing the stick, in CSS px relative to the element's own centre. */
export interface StickVisual {
  active: boolean;
  /** Where the base ring sits (adaptive origin shift; 0,0 at home). */
  originX: number;
  originY: number;
  /** Thumb offset from the base, clamped to the radius. */
  thumbX: number;
  thumbY: number;
}

export interface ButtonOptions {
  onChange?: (pressed: boolean) => void;
}

interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  preventDefault?: () => void;
}

const HOME_VISUAL: StickVisual = { active: false, originX: 0, originY: 0, thumbX: 0, thumbY: 0 };

export class TouchInputSource implements InputSource {
  readonly kind = 'touch' as const;
  readonly #events = new Emitter<Record<InputSourceEvent, () => void>>();
  readonly #frameYaw: () => number;
  #x = 0;
  #y = 0;
  #sensitivity = 1;
  #jumpHeld = false;
  #jumpLatched = false;
  /** A JUMP that was already down when input became ineligible (countdown, panel) must be released first. */
  #jumpSuppressed = false;
  #detach: (() => void)[] = [];
  /** Reset callbacks of every bound control: `reset()` drops their pointer ownership too. */
  #resets = new Set<() => void>();

  constructor(opts: InputSourceOptions = {}) {
    this.#frameYaw = opts.frameYaw ?? (() => 0);
  }

  /** Stick deflection, each axis in [-1, 1]; y + = forward. Applies the sensitivity (bounded, default 1). */
  setStick(x: number, y: number): void {
    const m = Math.hypot(x, y);
    const k = m > 1 ? 1 / m : 1;
    this.#x = x * k;
    this.#y = y * k;
  }

  /** Bounded stick sensitivity: scales deflection before the dead zone (1 = raw). */
  setSensitivity(k: number): void {
    this.#sensitivity = Number.isFinite(k)
      ? Math.min(TOUCH_SENSITIVITY_MAX, Math.max(TOUCH_SENSITIVITY_MIN, k))
      : 1;
  }

  setJump(pressed: boolean): void {
    if (pressed && !this.#jumpHeld) this.#jumpLatched = true;
    if (!pressed) this.#jumpSuppressed = false;
    this.#jumpHeld = pressed;
  }

  pressMenu(): void {
    this.#events.emit('menu');
  }

  /** Any stick deflection, held JUMP or pending press: the source is in use. */
  get active(): boolean {
    return this.#x !== 0 || this.#y !== 0 || this.#jumpHeld || this.#jumpLatched;
  }

  /**
   * Bind pointer events on a stick element (round: radius = half its width, its centre = home). One pointer owns
   * the stick; a second contact cannot steal it. Geometry is read once per gesture, not on every move.
   */
  attachStick(el: PointerTarget, opts: StickOptions = {}): () => void {
    const fixed = opts.origin === 'fixed';
    let active: number | null = null;
    let captured = false;
    let rad = 1;
    let homeX = 0;
    let homeY = 0;
    // The point deflection is measured from (screen px), and the visual base position (relative to home).
    let anchorX = 0;
    let anchorY = 0;
    let originX = 0;
    let originY = 0;
    const emit = (thumbX: number, thumbY: number) =>
      opts.onChange?.({ active: active !== null, originX, originY, thumbX, thumbY });
    const release = () => {
      if (active === null) return;
      active = null;
      captured = false;
      originX = 0;
      originY = 0;
      this.setStick(0, 0);
      opts.onChange?.(HOME_VISUAL);
    };
    const drive = (e: PointerLike) => {
      let dx = (e.clientX - anchorX) / rad;
      let dy = (e.clientY - anchorY) / rad;
      const m = Math.hypot(dx, dy);
      if (m > 1) {
        dx /= m;
        dy /= m;
      }
      const k = this.#sensitivity;
      this.setStick(dx * k, -dy * k);
      emit(dx * rad, dy * rad);
    };
    const down = (ev: Event) => {
      const e = ev as unknown as PointerLike;
      if (active !== null) return; // the first contact owns the stick
      const r = el.getBoundingClientRect();
      rad = opts.radius?.() || r.width / 2 || 1;
      homeX = r.left + r.width / 2;
      homeY = r.top + r.height / 2;
      if (fixed) {
        anchorX = homeX;
        anchorY = homeY;
      } else {
        const ox = e.clientX - homeX;
        const oy = e.clientY - homeY;
        const cap = rad * TOUCH_ORIGIN_SHIFT;
        const m = Math.hypot(ox, oy);
        const k = m > cap ? cap / m : 1;
        originX = ox * k;
        originY = oy * k;
        // deflection is measured from the first contact: no jump from an off-centre press
        anchorX = e.clientX;
        anchorY = e.clientY;
      }
      active = e.pointerId;
      try {
        el.setPointerCapture?.(e.pointerId);
        captured = el.setPointerCapture !== undefined;
      } catch {
        captured = false;
      }
      e.preventDefault?.();
      drive(e);
    };
    const move = (ev: Event) => {
      const e = ev as unknown as PointerLike;
      if (active !== e.pointerId) return;
      drive(e);
    };
    const up = (ev: Event) => {
      if ((ev as unknown as PointerLike).pointerId !== active) return;
      release();
    };
    // Without capture, events stop when the thumb leaves the element: treat that as a release.
    const leave = (ev: Event) => {
      if (!captured && (ev as unknown as PointerLike).pointerId === active) release();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('pointerleave', leave);
    this.#resets.add(release);
    const detach = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      el.removeEventListener('pointerleave', leave);
      this.#resets.delete(release);
      release();
    };
    this.#detach.push(detach);
    return detach;
  }

  /** Bind a press-and-hold button (JUMP by default). One pointer owns it; the rest are ignored. */
  attachButton(
    el: PointerTarget,
    opts: ButtonOptions & { onPress?: (pressed: boolean) => void } = {},
  ): () => void {
    const set = opts.onPress ?? ((p: boolean) => this.setJump(p));
    let active: number | null = null;
    let captured = false;
    const release = () => {
      if (active === null) return;
      active = null;
      captured = false;
      set(false);
      opts.onChange?.(false);
    };
    const down = (ev: Event) => {
      const e = ev as unknown as PointerLike;
      if (active !== null) return;
      active = e.pointerId;
      try {
        el.setPointerCapture?.(e.pointerId);
        captured = el.setPointerCapture !== undefined;
      } catch {
        captured = false;
      }
      e.preventDefault?.();
      set(true);
      opts.onChange?.(true);
    };
    const up = (ev: Event) => {
      if ((ev as unknown as PointerLike).pointerId !== active) return;
      release();
    };
    const leave = (ev: Event) => {
      if (!captured && (ev as unknown as PointerLike).pointerId === active) release();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('pointerleave', leave);
    this.#resets.add(release);
    const detach = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      el.removeEventListener('pointerleave', leave);
      this.#resets.delete(release);
      release();
    };
    this.#detach.push(detach);
    return detach;
  }

  /**
   * Drop every held and pending action and release every bound control's pointer, so old contacts are ignored
   * until they lift and a new one lands. Use on cancellation, capture loss, pause, focus/visibility loss,
   * panel ownership, disruptive relayout and source switches. The next sample is neutral.
   */
  reset(): void {
    for (const release of [...this.#resets]) release();
    this.#x = 0;
    this.#y = 0;
    this.#jumpHeld = false;
    this.#jumpLatched = false;
    this.#jumpSuppressed = false;
  }

  /**
   * Forget a pending JUMP press and ignore a held JUMP until it is pressed again. For phases where the
   * simulation isn't eligible to consume input (intro, countdown), so a press can't fire at "Go".
   */
  clearPending(): void {
    this.#jumpLatched = false;
    if (this.#jumpHeld) this.#jumpSuppressed = true;
  }

  #read(consume: boolean): InputSample {
    const s = radialDeadzone(this.#x, this.#y, TOUCH_DEADZONE);
    const jump = !this.#jumpSuppressed && (this.#jumpHeld || this.#jumpLatched);
    if (consume) this.#jumpLatched = false;
    return {
      tiltX: s.x * KEYBOARD_TILT,
      tiltZ: s.y * KEYBOARD_TILT,
      frameYaw: this.#frameYaw(),
      power: s.mag > 0,
      jump,
    };
  }

  /** Current input without acknowledging anything: for frames, readouts and ownership checks. */
  peek(_nowMs: number): InputSample {
    return this.#read(false);
  }

  /** Current input, acknowledging the pending JUMP press. Call only from an eligible simulation tick. */
  sample(_nowMs: number): InputSample {
    return this.#read(true);
  }

  on(evt: InputSourceEvent, cb: () => void): Unsubscribe {
    return this.#events.on(evt, cb);
  }

  dispose(): void {
    for (const d of [...this.#detach]) d();
    this.#detach = [];
    this.#resets.clear();
    this.reset();
    this.#events.clear();
  }
}
