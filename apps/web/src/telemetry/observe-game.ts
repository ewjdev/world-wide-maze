import {
  ANALYTICS_PHASES,
  type AnalyticsPhase,
  type AnalyticsRun,
  API_ERROR_CODES,
  type TelemetryEvent,
} from '@wwm/schema';
import { gameEngagement, stopGameEngagement } from './engagement.ts';
import { type Telemetry, telemetry } from './index.ts';

export interface FunnelView {
  phase: string;
  inputMode: 'keyboard' | 'phone' | null;
  room: { controllerConnected: boolean; status?: string };
  run: { kind: string; index: number } | null;
  error: { code: string } | null;
  calibrateTimedOut?: boolean;
  hold?: string | null;
  portal?: unknown;
  travel?: unknown;
}
export interface FunnelSource {
  subscribe(listener: () => void): () => void;
  getView(): FunnelView;
}
export function analyticsRun(k: string | undefined): AnalyticsRun {
  return ['practice', 'fixture', 'api', 'local', 'sketch'].includes(k ?? '')
    ? (k as AnalyticsRun)
    : 'unknown';
}
const phase = (p: string | undefined): AnalyticsPhase =>
  ANALYTICS_PHASES.includes(p as AnalyticsPhase) ? (p as AnalyticsPhase) : 'none';
const errorCode = (code: string): Extract<TelemetryEvent, { name: 'build_failed' }>['code'] =>
  [...API_ERROR_CODES, 'NETWORK', 'NOT_FOUND'].includes(code)
    ? (code as Extract<TelemetryEvent, { name: 'build_failed' }>['code'])
    : 'OTHER';

export function observeGame(
  game: FunnelSource,
  t: Telemetry = telemetry,
  now = () => performance.now(),
): () => void {
  let previous: FunnelView | null = null;
  let attempt = crypto.randomUUID();
  let started = false;
  let buildAt = now();
  let sawTitle = false;
  const onChange = () => {
    const v = game.getView();
    const p = previous;
    previous = v;
    const stage = {
      run: analyticsRun(v.run?.kind),
      slice: Math.max(0, Math.min(999, v.run?.index ?? 0)),
      attempt,
    };
    if (v.phase !== p?.phase) {
      if (v.phase === 'building') {
        attempt = crypto.randomUUID();
        stage.attempt = attempt;
        started = false;
        buildAt = now();
        t.track({ name: 'build_started', attempt });
      }
      if (p?.phase === 'building' && ['select', 'title'].includes(v.phase))
        t.track({ name: 'build_cancelled', attempt, duration_ms: Math.round(now() - buildAt) });
      t.track({ name: 'game_phase', from: phase(p?.phase), phase: phase(v.phase), attempt });
      if (v.phase === 'title' && !sawTitle) {
        sawTitle = true;
        t.track({ name: 'title' });
      }
      if (v.phase === 'pairing') t.track({ name: 'pairing_started' });
      if (v.phase === 'intro')
        t.track({ name: 'stage_loaded', ...stage, duration_ms: Math.round(now() - buildAt) });
      if (v.phase === 'play' && !started) {
        started = true;
        t.track({ name: 'played', ...stage, input: v.inputMode ?? 'unknown' });
      }
      if (v.phase === 'goal') t.track({ name: 'finished', ...stage });
      if (v.phase === 'gameover' || v.phase === 'timeup')
        t.track({ name: 'ended', ...stage, reason: v.phase });
    }
    if (v.room.controllerConnected && !p?.room.controllerConnected)
      t.track({ name: 'paired', input: 'phone' });
    if (!v.room.controllerConnected && p?.room.controllerConnected)
      t.track({ name: 'controller_disconnected' });
    if (v.inputMode && v.inputMode !== p?.inputMode) t.track({ name: 'input_selected', input: v.inputMode });
    if (v.room.status === 'error' && p?.room.status !== 'error')
      t.track({ name: 'pairing_failed', reason: 'room_error' });
    if (v.calibrateTimedOut && !p?.calibrateTimedOut)
      t.track({ name: 'pairing_failed', reason: 'calibration_timeout' });
    if (v.error && v.error !== p?.error)
      t.track({ name: 'build_failed', attempt, code: errorCode(v.error.code) });
    gameEngagement({
      ...stage,
      attempt,
      phase: phase(v.phase),
      playing: v.phase === 'play' && !v.hold && !v.portal && !v.travel,
    });
  };
  const off = game.subscribe(onChange);
  onChange();
  return () => {
    off();
    stopGameEngagement();
  };
}
