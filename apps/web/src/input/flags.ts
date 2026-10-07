/**
 * Build-time switch for same-device touch play (plans/mobile-browser-game-execution.md M1/M5). It follows the
 * Race flag convention (`race/flags.ts`): development defaults on unless explicitly `false`, a production build
 * needs an explicit `true`. It is independent of `VITE_RACE_ENABLED`.
 */
export function mobileControlsEnabled(env: {
  DEV?: boolean;
  VITE_MOBILE_CONTROLS_ENABLED?: string;
}): boolean {
  return (
    env.VITE_MOBILE_CONTROLS_ENABLED === 'true' || (!!env.DEV && env.VITE_MOBILE_CONTROLS_ENABLED !== 'false')
  );
}

export const MOBILE_CONTROLS_ENABLED = mobileControlsEnabled(import.meta.env);

/** Experimental sensor controls require an explicit opt-in even in development. */
export function mobileTiltEnabled(env: { VITE_MOBILE_TILT_ENABLED?: string }): boolean {
  return env.VITE_MOBILE_TILT_ENABLED === 'true';
}
export const MOBILE_TILT_ENABLED =
  MOBILE_CONTROLS_ENABLED &&
  mobileTiltEnabled({ VITE_MOBILE_TILT_ENABLED: import.meta.env.VITE_MOBILE_TILT_ENABLED });
