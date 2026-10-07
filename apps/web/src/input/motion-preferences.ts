import { MOBILE_TILT_ENABLED } from './flags.ts';

export const MOTION_PREF_KEY = 'wwm.motion.v1';
export interface MotionPreferences {
  mode: 'tilt' | 'joystick';
  sensitivity: number;
  showJump: boolean;
}
const defaults: MotionPreferences = { mode: 'tilt', sensitivity: 1, showJump: false };
export function readMotionPreferences(storage?: Pick<Storage, 'getItem'>): MotionPreferences {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(MOTION_PREF_KEY) ?? 'null');
    return {
      mode: value?.mode === 'joystick' ? 'joystick' : 'tilt',
      sensitivity:
        typeof value?.sensitivity === 'number' && Number.isFinite(value.sensitivity)
          ? Math.min(1.5, Math.max(0.5, value.sensitivity))
          : 1,
      showJump: value?.showJump === true,
    };
  } catch {
    return { ...defaults };
  }
}
export function saveMotionPreferences(value: MotionPreferences, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(MOTION_PREF_KEY, JSON.stringify(value));
  } catch {
    /* optional */
  }
}
export function localTouchMode(storage?: Pick<Storage, 'getItem'>): 'touch' | 'tilt' {
  return MOBILE_TILT_ENABLED && readMotionPreferences(storage).mode === 'tilt' ? 'tilt' : 'touch';
}
