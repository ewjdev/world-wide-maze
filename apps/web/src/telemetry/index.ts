/** Bounded, explicit first-party events. No third-party browser SDK, replay, or DOM autocapture. */
import type { TelemetryContext, TelemetryEvent, TelemetryRecord } from '@wwm/schema';
import { ANALYTICS_VERSION } from '@wwm/schema/constants';
import { pageContext } from './context.ts';
import {
  type AnalyticsPreference,
  createIdentity,
  PREFERENCE_EVENT,
  PREFERENCE_KEY,
  preference,
  privacySignalsSet,
} from './preferences.ts';

export type { TelemetryEvent, TelemetryRecord } from '@wwm/schema';
export { privacySignalsSet } from './preferences.ts';

export interface TelemetrySink {
  send(record: TelemetryRecord): void;
  flush?(): void;
  dispose?(): void;
}
export interface Telemetry {
  track(event: TelemetryEvent): void;
  setSink(sink: TelemetrySink): void;
  readonly enabled: boolean;
}
export const noopSink: TelemetrySink = { send() {} };
const DEFAULT_CONTEXT: TelemetryContext = {
  route: 'other',
  surface: 'site',
  device: 'desktop',
  browser: 'Other',
  language: 'other',
  source: 'direct',
  medium: 'none',
  campaign: 'none',
};
export function createTelemetry(
  opts: {
    sink?: TelemetrySink;
    now?: () => number;
    visit?: string;
    context?: () => TelemetryContext;
    identity?: () => { visit: string; visitor?: string; identity: 'visit' | 'browser' };
  } = {},
): Telemetry {
  let sink = opts.sink ?? noopSink;
  const visit = opts.visit ?? crypto.randomUUID();
  return {
    track(event) {
      if (sink === noopSink) return;
      try {
        sink.send({
          ...event,
          version: ANALYTICS_VERSION,
          event_id: crypto.randomUUID(),
          ...(opts.identity?.() ?? { visit, identity: 'visit' as const }),
          timestamp: (opts.now ?? Date.now)(),
          context: opts.context?.() ?? DEFAULT_CONTEXT,
        });
      } catch {
        /* Analytics must never break gameplay. */
      }
    },
    setSink(next) {
      if (sink !== next) sink.dispose?.();
      sink = next;
    },
    get enabled() {
      return sink !== noopSink;
    },
  };
}

/** Retry only transient failures, with the same event UUIDs for provider deduplication. */
export function beaconSink(
  url: string,
  opts: { intervalMs?: number; maxQueue?: number; win?: Window; fetcher?: typeof fetch } = {},
): TelemetrySink {
  const win = opts.win ?? window;
  const fetcher = opts.fetcher ?? fetch;
  let queue: TelemetryRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const abort = new AbortController();
  const post = async (events: TelemetryRecord[], attempt = 0): Promise<void> => {
    if (disposed) return;
    try {
      const response = await fetcher(url, {
        method: 'POST',
        body: JSON.stringify({ events }),
        headers: { 'content-type': 'application/json' },
        keepalive: true,
        signal: abort.signal,
      });
      if (response.ok || response.status < 500) return;
    } catch {
      if (disposed) return;
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      await post(events, attempt + 1);
    }
  };
  const flush = (leaving = false) => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || !queue.length) return;
    const events = queue;
    queue = [];
    const body = JSON.stringify({ events });
    // Keep batches comfortably below the browser's shared 64 KiB keepalive budget.
    if (leaving && win.navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
    void post(events);
  };
  const hide = () => {
    if (win.document.visibilityState === 'hidden') flush(true);
  };
  const leave = () => flush(true);
  win.addEventListener('pagehide', leave);
  win.document.addEventListener('visibilitychange', hide);
  return {
    send(record) {
      if (disposed) return;
      if (queue.length >= (opts.maxQueue ?? 20)) flush();
      queue.push(record);
      if (!timer) timer = setTimeout(() => flush(), opts.intervalMs ?? 5000);
    },
    flush: () => flush(true),
    dispose() {
      disposed = true;
      abort.abort();
      queue = [];
      clearTimeout(timer);
      win.removeEventListener('pagehide', leave);
      win.document.removeEventListener('visibilitychange', hide);
    },
  };
}

let currentContext = DEFAULT_CONTEXT;
let currentIdentity: (() => { visit: string; visitor?: string; identity: 'visit' | 'browser' }) | undefined;
export const telemetry = createTelemetry({
  context: () => currentContext,
  identity: () => currentIdentity?.() ?? { visit: fallbackVisit, identity: 'visit' },
});
const fallbackVisit = crypto.randomUUID();
let beforeRoute: (() => void) | undefined;
export function beforeAnalyticsRouteChange(callback?: () => void): void {
  beforeRoute = callback;
}
export function trackPage(win: Window = window, target: Telemetry = telemetry): void {
  beforeRoute?.();
  currentContext = pageContext(win);
  target.track({ name: 'page_viewed' });
}

export function installTelemetry(
  opts: { url?: string; win?: Window; target?: Telemetry } = {},
): TelemetrySink {
  const win = opts.win ?? (typeof window === 'undefined' ? undefined : window);
  const target = opts.target ?? telemetry;
  if (!win || !opts.url || opts.url !== '/api/t') return noopSink;
  let mode = preference(win);
  let identity = createIdentity(win);
  currentIdentity = () => identity(mode);
  currentContext = pageContext(win);
  let sink = noopSink;
  const apply = () => {
    sink =
      mode === 'off' || privacySignalsSet(win.navigator) ? noopSink : beaconSink(opts.url as string, { win });
    target.setSink(sink);
  };
  apply();
  win.addEventListener(PREFERENCE_EVENT, (e) => {
    mode = (e as CustomEvent<AnalyticsPreference>).detail;
    identity = createIdentity(win);
    apply();
    if (target.enabled) trackPage(win, target);
  });
  win.addEventListener('storage', (e) => {
    if (e.key !== PREFERENCE_KEY) return;
    mode = preference(win);
    identity = createIdentity(win);
    apply();
  });
  let errors = 0;
  const report = (name: string) => {
    if (errors++ >= 5) return;
    const kind = [
      'Error',
      'TypeError',
      'RangeError',
      'ReferenceError',
      'SyntaxError',
      'UnhandledRejection',
    ].includes(name)
      ? (name as Extract<TelemetryEvent, { name: 'client_error' }>['kind'])
      : 'Other';
    target.track({ name: 'client_error', kind });
  };
  win.addEventListener('error', (e) => report(e.error?.name ?? 'Error'));
  win.addEventListener('unhandledrejection', () => report('UnhandledRejection'));
  win.addEventListener('pageshow', (e) => {
    if (e.persisted) trackPage(win, target);
  });
  win.addEventListener('pagehide', () => {
    target.track({ name: 'page_left' });
    sink.flush?.();
  });
  win.document.addEventListener('click', (e) => {
    const anchor = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    try {
      const href = new URL(anchor.href);
      if (!['http:', 'https:'].includes(href.protocol) || href.origin === win.location.origin) return;
      target.track({
        name: 'outbound_clicked',
        destination:
          href.hostname === 'github.com'
            ? 'github'
            : ['twitter.com', 'x.com', 'facebook.com', 'linkedin.com'].includes(href.hostname)
              ? 'social'
              : 'other',
      });
    } catch {
      /* Malformed link. */
    }
  });
  return sink;
}
