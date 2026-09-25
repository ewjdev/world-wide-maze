/**
 * Keyboard input (E: `app/keycontrol`, fidelity-spec §1):
 * - Arrows set a target tilt of ±KEYBOARD_TILT (25°) per axis, ramped at 162°/s (2.7° per 60 Hz tick).
 * - Any arrow held = POWER on; POWER stays on for 100 ms after the last arrow is released.
 * - Space = JUMP, M = map (MENU).
 * - N: WASD mirror the arrows, Esc also opens the map, Shift forces POWER.
 * Window blur releases every key (so a stuck key can't keep tilting).
 */
import { type InputSample, KEYBOARD_TILT } from '@wwm/schema';
import { Emitter, type Unsubscribe } from '../emitter.ts';
import {
  approach,
  type InputSource,
  type InputSourceEvent,
  type InputSourceOptions,
} from '../input-source.ts';

export const KEYBOARD_RAMP_RAD_PER_SEC = (162 * Math.PI) / 180;
export const KEYBOARD_POWER_RELEASE_MS = 100;

/** Minimal event target (window/document in browsers; a plain EventTarget in tests). */
export interface KeyTarget {
  addEventListener(type: string, cb: (e: Event) => void): void;
  removeEventListener(type: string, cb: (e: Event) => void): void;
}

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

interface KeyLike {
  code?: string;
  key?: string;
  repeat?: boolean;
  target?: unknown;
  preventDefault?: () => void;
}

function keyCode(e: KeyLike): string {
  if (e.code) return e.code;
  // Fallback for synthetic events that only set `key`.
  switch (e.key) {
    case ' ':
      return 'Space';
    case 'm':
    case 'M':
      return 'KeyM';
    case 'Shift':
      return 'ShiftLeft';
    default:
      return e.key ?? '';
  }
}

function isEditable(t: unknown): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

export interface KeyboardInputSourceOptions extends InputSourceOptions {
  /** Where to listen (default `window`). */
  target?: KeyTarget;
  /** Monotonic clock used to timestamp key events (default performance.now). */
  now?: () => number;
}

export class KeyboardInputSource implements InputSource {
  readonly kind = 'keyboard' as const;
  readonly #events = new Emitter<Record<InputSourceEvent, () => void>>();
  readonly #target: KeyTarget;
  readonly #now: () => number;
  readonly #frameYaw: () => number;
  readonly #held = new Set<Dir>();
  #shift = false;
  #space = false;
  #jumpLatched = false;
  #lastArrowUpAt = Number.NEGATIVE_INFINITY;
  #tiltX = 0;
  #tiltZ = 0;
  #lastSampleAt: number | null = null;

  constructor(opts: KeyboardInputSourceOptions = {}) {
    this.#target = opts.target ?? (globalThis as unknown as KeyTarget);
    this.#now = opts.now ?? (() => performance.now());
    this.#frameYaw = opts.frameYaw ?? (() => 0);
    this.#target.addEventListener('keydown', this.#onDown);
    this.#target.addEventListener('keyup', this.#onUp);
    this.#target.addEventListener('blur', this.#onBlur);
  }

  #onDown = (ev: Event): void => {
    const e = ev as unknown as KeyLike;
    if (isEditable(e.target)) return;
    const code = keyCode(e);
    const dir = DIRS[code];
    if (dir) {
      this.#held.add(dir);
      e.preventDefault?.();
    } else if (code === 'Space') {
      if (!e.repeat && !this.#space) this.#jumpLatched = true;
      this.#space = true;
      e.preventDefault?.();
    } else if (code === 'KeyM' || code === 'Escape') {
      if (!e.repeat) this.#events.emit('menu');
    } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
      this.#shift = true;
    }
  };

  #onUp = (ev: Event): void => {
    const code = keyCode(ev as unknown as KeyLike);
    const dir = DIRS[code];
    if (dir) {
      this.#held.delete(dir);
      if (this.#held.size === 0) this.#lastArrowUpAt = this.#now();
    } else if (code === 'Space') this.#space = false;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') this.#shift = false;
  };

  #onBlur = (): void => {
    if (this.#held.size > 0) this.#lastArrowUpAt = this.#now();
    this.#held.clear();
    this.#space = false;
    this.#shift = false;
  };

  sample(nowMs: number): InputSample {
    const dt = this.#lastSampleAt === null ? 0 : Math.max(0, (nowMs - this.#lastSampleAt) / 1000);
    this.#lastSampleAt = nowMs;
    const h = this.#held;
    const tx = ((h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0)) * KEYBOARD_TILT;
    const tz = ((h.has('up') ? 1 : 0) - (h.has('down') ? 1 : 0)) * KEYBOARD_TILT;
    const step = KEYBOARD_RAMP_RAD_PER_SEC * dt;
    this.#tiltX = approach(this.#tiltX, tx, step);
    this.#tiltZ = approach(this.#tiltZ, tz, step);
    const power = h.size > 0 || this.#shift || nowMs - this.#lastArrowUpAt <= KEYBOARD_POWER_RELEASE_MS;
    const jump = this.#space || this.#jumpLatched;
    this.#jumpLatched = false;
    return { tiltX: this.#tiltX, tiltZ: this.#tiltZ, frameYaw: this.#frameYaw(), power, jump };
  }

  on(evt: InputSourceEvent, cb: () => void): Unsubscribe {
    return this.#events.on(evt, cb);
  }

  dispose(): void {
    this.#target.removeEventListener('keydown', this.#onDown);
    this.#target.removeEventListener('keyup', this.#onUp);
    this.#target.removeEventListener('blur', this.#onBlur);
    this.#events.clear();
  }
}
