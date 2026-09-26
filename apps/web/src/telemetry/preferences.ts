/** Persistent analytics identity is opt-in. Visit identity expires after 30 minutes of inactivity. */
export const PREFERENCE_KEY = 'wwm.analytics.preference';
export const VISITOR_KEY = 'wwm.analytics.visitor';
export const VISIT_KEY = 'wwm.analytics.visit';
export const PREFERENCE_EVENT = 'wwm-analytics-preference';
export const VISIT_IDLE_MS = 30 * 60_000;
const VISITOR_TTL_MS = 90 * 86_400_000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type AnalyticsPreference = 'visit' | 'browser' | 'off';
const pagePreferences = new WeakMap<Window, AnalyticsPreference>();
export function privacySignalsSet(nav: Navigator | undefined): boolean {
  const n = nav as (Navigator & { globalPrivacyControl?: boolean }) | undefined;
  return n?.globalPrivacyControl === true || n?.doNotTrack === '1';
}
export function preference(win: Window): AnalyticsPreference {
  const pageChoice = pagePreferences.get(win);
  if (pageChoice) return pageChoice;
  try {
    const value = win.localStorage.getItem(PREFERENCE_KEY);
    return value === 'off' || value === 'browser' ? value : 'visit';
  } catch {
    return 'visit';
  }
}
export function setPreference(value: AnalyticsPreference, win: Window = window): void {
  pagePreferences.set(win, value);
  try {
    win.localStorage.setItem(PREFERENCE_KEY, value);
    if (value !== 'browser') win.localStorage.removeItem(VISITOR_KEY);
    win.sessionStorage.removeItem(VISIT_KEY);
    pagePreferences.delete(win);
  } catch {
    /* Storage unavailable: the current page still honors the choice. */
  }
  win.dispatchEvent(new CustomEvent(PREFERENCE_EVENT, { detail: value }));
}
export function createIdentity(win: Window, now = () => Date.now()) {
  let visit = crypto.randomUUID();
  let last = now();
  try {
    const saved = JSON.parse(win.sessionStorage.getItem(VISIT_KEY) ?? 'null');
    if (
      ID.test(saved?.id) &&
      Number.isFinite(saved?.last) &&
      now() - saved.last >= 0 &&
      now() - saved.last < VISIT_IDLE_MS
    ) {
      visit = saved.id;
      last = saved.last;
    }
  } catch {
    /* Per-page fallback. */
  }
  return (mode: AnalyticsPreference) => {
    const time = now();
    if (time - last >= VISIT_IDLE_MS) visit = crypto.randomUUID();
    last = time;
    try {
      win.sessionStorage.setItem(VISIT_KEY, JSON.stringify({ id: visit, last }));
    } catch {
      /* Per-page fallback. */
    }
    let visitor: string | undefined;
    if (mode === 'browser') {
      try {
        const saved = JSON.parse(win.localStorage.getItem(VISITOR_KEY) ?? 'null');
        if (ID.test(saved?.id) && saved?.expires > time && saved.expires <= time + VISITOR_TTL_MS)
          visitor = saved.id;
        else {
          visitor = crypto.randomUUID();
          win.localStorage.setItem(
            VISITOR_KEY,
            JSON.stringify({ id: visitor, expires: time + VISITOR_TTL_MS }),
          );
        }
      } catch {
        /* No persistent tracking when storage is blocked. */
        visitor = undefined;
      }
    }
    return {
      visit,
      ...(visitor ? { visitor } : {}),
      identity: visitor ? ('browser' as const) : ('visit' as const),
    };
  };
}
