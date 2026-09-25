/**
 * The one input abstraction Phase 08 consumes. Every source returns a contract `InputSample` (§5);
 * `frameYaw` comes from the `frameYaw` option (the renderer's camera yaw), default 0.
 */
import type { InputSample } from '@wwm/schema';
import type { Unsubscribe } from './emitter.ts';

export type InputSourceKind = 'phone' | 'keyboard' | 'gamepad' | 'touch';
export type InputSourceEvent = 'menu' | 'disconnected' | 'connected';

export interface InputSource {
  readonly kind: InputSourceKind;
  /** Current input at `nowMs` (monotonic ms, e.g. performance.now()). Safe to call at any rate. */
  sample(nowMs: number): InputSample;
  on(evt: InputSourceEvent, cb: () => void): Unsubscribe;
  dispose(): void;
}

export interface InputSourceOptions {
  /** Heading of the frame tilt is relative to (the renderer's camera yaw). Default: 0. */
  frameYaw?: () => number;
}

export function neutralSample(frameYaw = 0): InputSample {
  return { tiltX: 0, tiltZ: 0, frameYaw, power: false, jump: false };
}

/** Move `current` toward `target` by at most `maxStep`. */
export function approach(current: number, target: number, maxStep: number): number {
  if (current < target) return Math.min(target, current + maxStep);
  if (current > target) return Math.max(target, current - maxStep);
  return current;
}

/** Scale a stick vector by a radial deadzone: 0 inside `dz`, then rescaled to reach 1 at the rim. */
export function radialDeadzone(x: number, y: number, dz: number): { x: number; y: number; mag: number } {
  const m = Math.hypot(x, y);
  if (m <= dz || m === 0) return { x: 0, y: 0, mag: 0 };
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  return { x: (x / m) * scaled, y: (y / m) * scaled, mag: scaled };
}
