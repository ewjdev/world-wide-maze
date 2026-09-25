/**
 * Touch input for single-device play (N): an on-screen virtual stick plus JUMP and MENU buttons.
 * Stick range is ±1 (y + = forward/up on screen); tilt = stick × KEYBOARD_TILT, magnitude above the
 * deadzone = POWER. UI code either calls the setters directly or uses `attachStick(element)`.
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

export interface PointerTarget {
  addEventListener(type: string, cb: (e: Event) => void): void;
  removeEventListener(type: string, cb: (e: Event) => void): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture?(id: number): void;
}

export class TouchInputSource implements InputSource {
  readonly kind = 'touch' as const;
  readonly #events = new Emitter<Record<InputSourceEvent, () => void>>();
  readonly #frameYaw: () => number;
  #x = 0;
  #y = 0;
  #jumpHeld = false;
  #jumpLatched = false;
  #detach: (() => void)[] = [];

  constructor(opts: InputSourceOptions = {}) {
    this.#frameYaw = opts.frameYaw ?? (() => 0);
  }

  /** Stick deflection, each axis in [-1, 1]; y + = forward. */
  setStick(x: number, y: number): void {
    const m = Math.hypot(x, y);
    const k = m > 1 ? 1 / m : 1;
    this.#x = x * k;
    this.#y = y * k;
  }

  setJump(pressed: boolean): void {
    if (pressed && !this.#jumpHeld) this.#jumpLatched = true;
    this.#jumpHeld = pressed;
  }

  pressMenu(): void {
    this.#events.emit('menu');
  }

  /** Bind pointer events on a round stick element: drag from its centre, radius = half its width. */
  attachStick(el: PointerTarget): () => void {
    let active: number | null = null;
    const move = (ev: Event) => {
      const e = ev as unknown as { pointerId: number; clientX: number; clientY: number };
      if (active !== e.pointerId) return;
      const r = el.getBoundingClientRect();
      const rad = r.width / 2 || 1;
      this.setStick((e.clientX - (r.left + r.width / 2)) / rad, -(e.clientY - (r.top + r.height / 2)) / rad);
    };
    const down = (ev: Event) => {
      const e = ev as unknown as { pointerId: number; preventDefault?: () => void };
      active = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      e.preventDefault?.();
      move(ev);
    };
    const up = (ev: Event) => {
      if ((ev as unknown as { pointerId: number }).pointerId !== active) return;
      active = null;
      this.setStick(0, 0);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    const detach = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    this.#detach.push(detach);
    return detach;
  }

  sample(_nowMs: number): InputSample {
    const s = radialDeadzone(this.#x, this.#y, TOUCH_DEADZONE);
    const jump = this.#jumpHeld || this.#jumpLatched;
    this.#jumpLatched = false;
    return {
      tiltX: s.x * KEYBOARD_TILT,
      tiltZ: s.y * KEYBOARD_TILT,
      frameYaw: this.#frameYaw(),
      power: s.mag > 0,
      jump,
    };
  }

  on(evt: InputSourceEvent, cb: () => void): Unsubscribe {
    return this.#events.on(evt, cb);
  }

  dispose(): void {
    for (const d of this.#detach) d();
    this.#detach = [];
    this.#events.clear();
  }
}
