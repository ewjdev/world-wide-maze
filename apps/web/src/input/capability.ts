/**
 * Same-device touch capability. Touch is chosen by capability plus explicit preference, never by viewport width
 * or user-agent alone (plans/mobile-browser-game-execution.md M1.6).
 */
import { MOBILE_CONTROLS_ENABLED } from './flags.ts';

/** The saved choice (`wwm.input.v1`): set by an explicit "play on this device", or "keyboard" on a hybrid. */
export const INPUT_PREF_KEY = 'wwm.input.v1';
export type InputPreference = 'touch' | 'keyboard';

interface Env {
  enabled?: boolean;
  coarse?: boolean;
  touchPoints?: number;
  preference?: string | null;
}

function browserEnv(): Env {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const touchPoints = typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0);
  let preference: string | null = null;
  try {
    preference = localStorage.getItem(INPUT_PREF_KEY);
  } catch {
    // storage unavailable: play must not depend on it
  }
  return { coarse, touchPoints, preference };
}

/** The device can deliver touch at all (phones, tablets, hybrids). Gates the explicit "Play on this device" CTA. */
export function touchCapable(env: Env = browserEnv()): boolean {
  return (env.enabled ?? MOBILE_CONTROLS_ENABLED) && (env.touchPoints ?? 0) > 0;
}

/**
 * Touch is the primary input: a coarse primary pointer with touch points (phones, most tablets), or an explicit
 * saved "touch" choice. A saved "keyboard" choice wins over the coarse-pointer heuristic. A disabled flag wins
 * over everything, including a stale saved preference.
 */
export function preferTouch(env: Env = browserEnv()): boolean {
  if (!touchCapable(env)) return false;
  if (env.preference === 'keyboard') return false;
  return env.preference === 'touch' || !!env.coarse;
}

export function savePreference(pref: InputPreference): void {
  try {
    localStorage.setItem(INPUT_PREF_KEY, pref);
  } catch {
    // ignore
  }
}
