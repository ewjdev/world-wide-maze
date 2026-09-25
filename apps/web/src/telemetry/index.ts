/**
 * Minimal, privacy-respecting client telemetry (Phase 12). **Off by default**: the default sink drops every event.
 *
 * What an event can carry is fixed by the `TelemetryEvent` union: enums, small integers and error codes. No URLs,
 * page titles, player names, scores, room codes, user agents or stable identifiers. The only correlation key is a
 * random id generated per page load and never stored (no cookies, no localStorage), so events can be grouped
 * into one visit but not linked across visits. Do Not Track / Global Privacy Control turn it off entirely.
 *
 * Enabling (needs the user's approval, see docs/launch/checklist.md):
 *   - build the web app with `VITE_TELEMETRY_URL=/api/t`, and
 *   - set the Worker var `TELEMETRY_INGEST=1`, which logs each accepted event as one structured Workers Logs line.
 *
 * Funnel (docs/launch/runbook.md): `title` → `paired` (phone only) → `played` → `finished`, plus `ended`
 * (game over / time up), `build_failed` (with the contract error code; `UNPLAYABLE` = the solver rejected the
 * stage) and `client_error` (uncaught errors: kind + a short, URL-stripped message).
 */

export type RunKind = 'practice' | 'fixture' | 'api';
export type TelemetryEvent =
  | { name: 'title' }
  | { name: 'paired'; input: 'phone' }
  | { name: 'played'; input: 'keyboard' | 'phone' | 'unknown'; run: RunKind; slice: number }
  | { name: 'finished'; run: RunKind; slice: number }
  | { name: 'ended'; reason: 'gameover' | 'timeup'; run: RunKind; slice: number }
  | { name: 'build_failed'; code: string }
  | { name: 'client_error'; kind: string; message: string };

export type TelemetryName = TelemetryEvent['name'];
export const TELEMETRY_NAMES: readonly TelemetryName[] = [
  'title',
  'paired',
  'played',
  'finished',
  'ended',
  'build_failed',
  'client_error',
];

/** What a sink receives: the event plus the per-page-load visit id and a relative timestamp (ms). */
export type TelemetryRecord = TelemetryEvent & { visit: string; ms: number };

export interface TelemetrySink {
  send(record: TelemetryRecord): void;
  flush?(): void;
}

export const noopSink: TelemetrySink = { send() {} };

export interface Telemetry {
  track(event: TelemetryEvent): void;
  setSink(sink: TelemetrySink): void;
  readonly enabled: boolean;
}

function randomVisitId(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Strip anything URL-like, long digit runs (room codes, ids) and cap the length. */
export function scrubMessage(message: string): string {
  return message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/\b\d{4,}\b/g, '<n>')
    .replace(/[0-9a-f]{16,}/gi, '<id>')
    .slice(0, 160);
}

export function createTelemetry(
  opts: { sink?: TelemetrySink; now?: () => number; visit?: string } = {},
): Telemetry {
  let sink = opts.sink ?? noopSink;
  const now = opts.now ?? (() => Math.round(performance.now()));
  const visit = opts.visit ?? randomVisitId();
  return {
    track(event) {
      try {
        sink.send({ ...event, visit, ms: now() });
      } catch {
        // telemetry must never break the game
      }
    },
    setSink(s) {
      sink = s;
    },
    get enabled() {
      return sink !== noopSink;
    },
  };
}

/**
 * Batches records and POSTs them as JSON to `url` (same origin), at most every `intervalMs`, and with
 * `navigator.sendBeacon` when the page is hidden. Drops events beyond `maxQueue` rather than growing.
 */
export function beaconSink(
  url: string,
  opts: { intervalMs?: number; maxQueue?: number; win?: Window } = {},
): TelemetrySink {
  const intervalMs = opts.intervalMs ?? 10_000;
  const maxQueue = opts.maxQueue ?? 50;
  const win = opts.win ?? (typeof window === 'undefined' ? undefined : window);
  let queue: TelemetryRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (queue.length === 0) return;
    const body = JSON.stringify({ events: queue });
    queue = [];
    const nav = win?.navigator;
    if (nav?.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
    void fetch(url, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      keepalive: true,
    }).catch(() => {});
  };
  win?.addEventListener('pagehide', flush);
  win?.document?.addEventListener('visibilitychange', () => {
    if (win.document.visibilityState === 'hidden') flush();
  });
  return {
    send(record) {
      if (queue.length >= maxQueue) return;
      queue.push(record);
      if (!timer) timer = setTimeout(flush, intervalMs);
    },
    flush,
  };
}

/** Honour Do Not Track and Global Privacy Control. */
export function privacySignalsSet(nav: Navigator | undefined): boolean {
  if (!nav) return false;
  const n = nav as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
  return n.globalPrivacyControl === true || n.doNotTrack === '1';
}

/** The app-wide instance (the no-op sink until `installTelemetry` picks a real one). */
export const telemetry: Telemetry = createTelemetry();

/**
 * Called once from main.tsx: picks the sink from the build-time `VITE_TELEMETRY_URL` (unset = no-op) and reports
 * uncaught errors. Returns the sink in use (tests).
 */
export function installTelemetry(
  opts: { url?: string | undefined; win?: Window; target?: Telemetry } = {},
): TelemetrySink {
  const target = opts.target ?? telemetry;
  const win = opts.win ?? (typeof window === 'undefined' ? undefined : window);
  const url = opts.url;
  if (!url || !win || privacySignalsSet(win.navigator)) return noopSink;
  const sink = beaconSink(url, { win });
  target.setSink(sink);
  let errors = 0;
  const report = (kind: string, message: string) => {
    if (errors++ >= 5) return; // a broken page shouldn't flood the endpoint
    target.track({ name: 'client_error', kind: kind.slice(0, 40), message: scrubMessage(message) });
  };
  win.addEventListener('error', (e) => report(e.error?.name ?? 'Error', e.message ?? ''));
  win.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { name?: string; message?: string } | undefined;
    report(r?.name ?? 'UnhandledRejection', r?.message ?? String(e.reason));
  });
  return sink;
}

// ── game funnel ─────────────────────────────────────────────────────────────────────────────────────

/** The slice of the game's view the funnel reads (structural, so this module doesn't import the game). */
export interface FunnelView {
  phase: string;
  inputMode: 'keyboard' | 'phone' | null;
  room: { controllerConnected: boolean };
  run: { kind: string; index: number } | null;
  error: { code: string } | null;
}

export interface FunnelSource {
  subscribe(listener: () => void): () => void;
  getView(): FunnelView;
}

const runKind = (k: string | undefined): RunKind =>
  k === 'practice' || k === 'fixture' || k === 'api' ? k : 'api';

/** Derive the funnel events from the game's state changes. Returns the unsubscribe function. */
export function observeGame(game: FunnelSource, t: Telemetry = telemetry): () => void {
  let prev: FunnelView | null = null;
  let sawTitle = false;
  const onChange = () => {
    const v = game.getView();
    const p = prev;
    prev = v;
    const run = runKind(v.run?.kind);
    const slice = Math.max(0, Math.min(99, v.run?.index ?? 0));
    if (v.phase === 'title' && !sawTitle) {
      sawTitle = true;
      t.track({ name: 'title' });
    }
    if (v.room.controllerConnected && !p?.room.controllerConnected)
      t.track({ name: 'paired', input: 'phone' });
    if (v.phase !== p?.phase) {
      // A stage starts at GO (countdown → play), or straight after the intro on the tutorial game.
      if (v.phase === 'play' && (p?.phase === 'countdown' || p?.phase === 'intro'))
        t.track({ name: 'played', input: v.inputMode ?? 'unknown', run, slice });
      else if (v.phase === 'goal') t.track({ name: 'finished', run, slice });
      else if (v.phase === 'gameover' || v.phase === 'timeup')
        t.track({ name: 'ended', reason: v.phase, run, slice });
    }
    if (v.error && v.error !== p?.error)
      t.track({ name: 'build_failed', code: String(v.error.code).slice(0, 24) });
  };
  const off = game.subscribe(onChange);
  onChange();
  return off;
}
