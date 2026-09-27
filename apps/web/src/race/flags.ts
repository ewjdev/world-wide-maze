/** Build-time rollback: set VITE_RACE_ENABLED=false to hide entry and disable deep links. */
export const RACE_ENABLED =
  import.meta.env.VITE_RACE_ENABLED === 'true' ||
  (import.meta.env.DEV && import.meta.env.VITE_RACE_ENABLED !== 'false');
