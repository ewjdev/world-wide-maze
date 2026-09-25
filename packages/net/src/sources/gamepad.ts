/**
 * Gamepad input (N: 2013 had none). Standard mapping:
 * - left stick = tilt (±KEYBOARD_TILT per axis, radial deadzone), stick magnitude above the deadzone = POWER
 * - RT (button 7) also holds POWER, A (button 0) = JUMP, Start (button 9) = map (MENU, rising edge)
 * Polled in `sample()`; `connected` / `disconnected` fire when the pad appears or disappears.
 */
import { type InputSample, KEYBOARD_TILT } from '@wwm/schema';
import { Emitter, type Unsubscribe } from '../emitter.ts';
import {
  type InputSource,
  type InputSourceEvent,
  type InputSourceOptions,
  neutralSample,
  radialDeadzone,
} from '../input-source.ts';

export const GAMEPAD_DEADZONE = 0.2;
export const GAMEPAD_TILT = KEYBOARD_TILT;
const BTN_A = 0;
const BTN_RT = 7;
const BTN_START = 9;

/** The subset of the Gamepad API we read. */
export interface GamepadLike {
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export interface GamepadInputSourceOptions extends InputSourceOptions {
  /** Default `navigator.getGamepads()`. */
  getGamepads?: () => readonly (GamepadLike | null)[];
  deadzone?: number;
}

export class GamepadInputSource implements InputSource {
  readonly kind = 'gamepad' as const;
  readonly #events = new Emitter<Record<InputSourceEvent, () => void>>();
  readonly #get: () => readonly (GamepadLike | null)[];
  readonly #frameYaw: () => number;
  readonly #deadzone: number;
  #present = false;
  #startHeld = false;

  constructor(opts: GamepadInputSourceOptions = {}) {
    this.#get =
      opts.getGamepads ??
      (() => {
        const nav = (globalThis as { navigator?: { getGamepads?: () => (GamepadLike | null)[] } }).navigator;
        return nav?.getGamepads?.() ?? [];
      });
    this.#frameYaw = opts.frameYaw ?? (() => 0);
    this.#deadzone = opts.deadzone ?? GAMEPAD_DEADZONE;
  }

  #pad(): GamepadLike | null {
    for (const p of this.#get()) if (p?.connected) return p;
    return null;
  }

  sample(_nowMs: number): InputSample {
    const pad = this.#pad();
    if (!!pad !== this.#present) {
      this.#present = !!pad;
      this.#events.emit(pad ? 'connected' : 'disconnected');
    }
    if (!pad) {
      this.#startHeld = false;
      return neutralSample(this.#frameYaw());
    }
    const btn = (i: number) => pad.buttons[i];
    const start = !!btn(BTN_START)?.pressed;
    if (start && !this.#startHeld) this.#events.emit('menu');
    this.#startHeld = start;
    // Stick y is + down; forward (away) is tiltZ +.
    const s = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, this.#deadzone);
    const rt = btn(BTN_RT);
    const power = s.mag > 0 || (rt ? rt.pressed || rt.value > 0.3 : false);
    return {
      tiltX: s.x * GAMEPAD_TILT,
      tiltZ: -s.y * GAMEPAD_TILT,
      frameYaw: this.#frameYaw(),
      power,
      jump: !!btn(BTN_A)?.pressed,
    };
  }

  on(evt: InputSourceEvent, cb: () => void): Unsubscribe {
    return this.#events.on(evt, cb);
  }

  dispose(): void {
    this.#events.clear();
  }
}
