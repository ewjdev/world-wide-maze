import type { AnalyticsPhase, AnalyticsRun } from '@wwm/schema';
import { beforeAnalyticsRouteChange, type Telemetry, telemetry } from './index.ts';

export interface EngagementState {
  phase: AnalyticsPhase;
  run: AnalyticsRun;
  slice: number;
  attempt: string;
  playing: boolean;
}
const initialState = (): EngagementState => ({
  phase: 'none',
  run: 'unknown',
  slice: 0,
  attempt: crypto.randomUUID(),
  playing: false,
});
/** Monotonic deltas, capped after suspension. A held game control refreshes activity on the host. */
export function createEngagementMeter(now: () => number, target: Telemetry) {
  let state = initialState();
  let last = now();
  let activeUntil = last + 30_000;
  let active = 0;
  let play = 0;
  let visible = true;
  const tick = () => {
    const time = now();
    const delta = Math.max(0, Math.min(2000, Math.min(time, activeUntil) - last));
    if (visible && target.enabled) {
      active += delta;
      if (state.playing) play += delta;
    }
    last = time;
  };
  const flush = (reason: 'interval' | 'hidden' | 'pagehide' | 'route' | 'phase' | 'stop') => {
    tick();
    if (active || play)
      target.track({
        name: 'engagement',
        active_ms: Math.round(active),
        play_ms: Math.round(play),
        phase: state.phase,
        run: state.run,
        slice: state.slice,
        attempt: state.attempt,
        reason,
      });
    active = 0;
    play = 0;
  };
  return {
    tick,
    activity() {
      tick();
      activeUntil = now() + 30_000;
    },
    visible(value: boolean) {
      tick();
      visible = value;
      if (value) last = now();
    },
    state(next: EngagementState) {
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      flush('phase');
      state = next;
    },
    reset() {
      active = 0;
      play = 0;
      last = now();
      activeUntil = last;
    },
    flush,
  };
}
let meter: ReturnType<typeof createEngagementMeter> | undefined;
export function gameActivity(): void {
  meter?.activity();
}
export function gameEngagement(state: EngagementState): void {
  meter?.state(state);
}
export function stopGameEngagement(): void {
  meter?.state(initialState());
}
export function installEngagement(win: Window = window): () => void {
  meter = createEngagementMeter(() => win.performance.now(), telemetry);
  const m = meter;
  m.visible(win.document.visibilityState !== 'hidden');
  const activity = () => m.activity();
  const visibility = () => {
    if (win.document.visibilityState === 'hidden') m.flush('hidden');
    m.visible(win.document.visibilityState !== 'hidden');
  };
  const pagehide = () => m.flush('pagehide');
  const reset = () => m.reset();
  win.addEventListener('pointerdown', activity, { passive: true });
  win.addEventListener('keydown', activity);
  win.addEventListener('scroll', activity, { passive: true });
  win.addEventListener('pagehide', pagehide);
  win.addEventListener('wwm-analytics-preference', reset);
  const storage = (e: StorageEvent) => {
    if (e.key === 'wwm.analytics.preference') reset();
  };
  win.addEventListener('storage', storage);
  win.document.addEventListener('visibilitychange', visibility);
  beforeAnalyticsRouteChange(() => m.flush('route'));
  const tick = setInterval(() => m.tick(), 1000);
  const flush = setInterval(() => m.flush('interval'), 15_000);
  return () => {
    m.flush('stop');
    clearInterval(tick);
    clearInterval(flush);
    win.removeEventListener('pointerdown', activity);
    win.removeEventListener('keydown', activity);
    win.removeEventListener('scroll', activity);
    win.removeEventListener('pagehide', pagehide);
    win.removeEventListener('wwm-analytics-preference', reset);
    win.removeEventListener('storage', storage);
    win.document.removeEventListener('visibilitychange', visibility);
    beforeAnalyticsRouteChange();
    meter = undefined;
  };
}
