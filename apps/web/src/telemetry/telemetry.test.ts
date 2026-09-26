import type { TelemetryRecord } from '@wwm/schema';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { pageContext, routeName } from './context.ts';
import { beaconSink, createTelemetry, installTelemetry, noopSink } from './index.ts';
import { type FunnelView, observeGame } from './observe-game.ts';
import {
  createIdentity,
  preference,
  privacySignalsSet,
  setPreference,
  VISIT_IDLE_MS,
  VISITOR_KEY,
} from './preferences.ts';

function storage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}
function windowStub(url = 'https://wwm.ewj.dev/', nav: object = {}): Window {
  return Object.assign(new EventTarget(), {
    location: new URL(url),
    localStorage: storage(),
    sessionStorage: storage(),
    navigator: { userAgent: 'Chrome/130 Mobile', language: 'en-US', ...nav },
    document: Object.assign(new EventTarget(), { referrer: '', visibilityState: 'visible' }),
  }) as unknown as Window;
}
function recorder() {
  const records: TelemetryRecord[] = [];
  return {
    records,
    target: createTelemetry({
      sink: {
        send: (r) => {
          records.push(r);
        },
      },
    }),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('analytics normalization and identities', () => {
  test('normalizes paths, campaign values and referral content before capture', () => {
    const win = windowStub(
      'https://wwm.ewj.dev/c/123456?utm_source=private@example.com&utm_medium=secret&utm_campaign=private-project#p=pair-secret',
    );
    Object.defineProperty(win.document, 'referrer', { value: 'https://private.example.com/a?token=secret' });
    const context = pageContext(win);
    expect(context).toEqual({
      route: 'controller',
      surface: 'controller',
      device: 'mobile',
      browser: 'Chrome',
      language: 'en',
      source: 'other',
      medium: 'other',
      campaign: 'other',
    });
    expect(JSON.stringify(context)).not.toMatch(/123456|secret|private|example/);
    expect(routeName('/j/encoded-player-name')).toBe('journey');
    expect(routeName('/play/a-private-stage-id')).toBe('play');
    expect(routeName('/not-a-known-route')).toBe('other');
    expect(
      pageContext(
        windowStub('https://wwm.ewj.dev/?utm_source=linkedin&utm_medium=social&utm_campaign=launch'),
      ).source,
    ).toBe('linkedin');
  });
  test('uses a visit identity by default, restores it within the visit, and expires idle visits', () => {
    const win = windowStub();
    let time = 1000;
    const identity = createIdentity(win, () => time);
    const first = identity('visit');
    expect(first.identity).toBe('visit');
    expect(first).not.toHaveProperty('visitor');
    expect(win.localStorage.getItem(VISITOR_KEY)).toBeNull();
    expect(createIdentity(win, () => time)('visit').visit).toBe(first.visit);
    time += VISIT_IDLE_MS;
    expect(identity('visit').visit).not.toBe(first.visit);
  });
  test('persistent browser identity requires opt-in and disappears on visit/off preference', () => {
    const win = windowStub();
    expect(preference(win)).toBe('visit');
    setPreference('browser', win);
    const first = createIdentity(win)('browser');
    expect(first.identity).toBe('browser');
    expect(first.visitor).toMatch(/^[0-9a-f-]{36}$/);
    expect(createIdentity(win)('browser').visitor).toBe(first.visitor);
    setPreference('visit', win);
    expect(win.localStorage.getItem(VISITOR_KEY)).toBeNull();
    expect(createIdentity(win)('visit')).not.toHaveProperty('visitor');
    setPreference('off', win);
    expect(preference(win)).toBe('off');
  });
  test('blocked storage falls back to a page visit without a persistent identifier', () => {
    const win = windowStub();
    Object.defineProperty(win, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    });
    Object.defineProperty(win, 'sessionStorage', {
      get() {
        throw new Error('blocked');
      },
    });
    expect(preference(win)).toBe('visit');
    expect(createIdentity(win)('browser').identity).toBe('visit');
  });
  test('denied storage writes preserve the current page choice and cannot claim browser identity', () => {
    const win = windowStub();
    win.localStorage.setItem = () => {
      throw new Error('quota exceeded');
    };
    setPreference('off', win);
    expect(preference(win)).toBe('off');
    expect(createIdentity(win)('browser')).toMatchObject({ identity: 'visit' });
    expect(createIdentity(win)('browser')).not.toHaveProperty('visitor');
  });
  test.each([{ doNotTrack: '1' }, { globalPrivacyControl: true }])(
    'privacy signal suppresses capture: %j',
    (nav) => {
      const win = windowStub(undefined, nav);
      const target = createTelemetry();
      expect(privacySignalsSet(win.navigator)).toBe(true);
      expect(installTelemetry({ url: '/api/t', win, target })).toBe(noopSink);
      expect(target.enabled).toBe(false);
    },
  );
  test('unset/external endpoint and off preference suppress capture', () => {
    const win = windowStub();
    const target = createTelemetry();
    expect(installTelemetry({ win, target })).toBe(noopSink);
    expect(installTelemetry({ url: 'https://collector.example/t', win, target })).toBe(noopSink);
    setPreference('off', win);
    expect(installTelemetry({ url: '/api/t', win, target })).toBe(noopSink);
    expect(target.enabled).toBe(false);
  });
});

describe('transport and game lifecycle', () => {
  test('opting out disposes queued data and suppresses future captures', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    const win = windowStub();
    const target = createTelemetry();
    installTelemetry({ url: '/api/t', win, target });
    target.track({ name: 'start_clicked' });
    setPreference('off', win);
    target.track({ name: 'page_viewed' });
    await vi.advanceTimersByTimeAsync(6000);
    expect(target.enabled).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  test('transient retry retains event UUID; permanent errors are not retried', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const sink = beaconSink('/api/t', { win: windowStub(), fetcher, intervalMs: 10 });
    const target = createTelemetry({ sink });
    target.track({ name: 'title' });
    await vi.advanceTimersByTimeAsync(1010);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
    fetcher.mockResolvedValue(new Response(null, { status: 400 }));
    target.track({ name: 'page_viewed' });
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    sink.dispose?.();
  });
  test('build, play, pause, completion and failure use bounded events and attempt correlation', () => {
    const { records, target } = recorder();
    let view: FunnelView = {
      phase: 'title',
      inputMode: null,
      room: { controllerConnected: false },
      run: null,
      error: null,
    };
    let listener = () => {};
    const source = {
      getView: () => view,
      subscribe(fn: () => void) {
        listener = fn;
        return () => {
          listener = () => {};
        };
      },
    };
    let time = 0;
    const off = observeGame(source, target, () => time);
    const set = (patch: Partial<FunnelView>) => {
      view = { ...view, ...patch };
      listener();
    };
    set({ phase: 'pairing' });
    set({ room: { controllerConnected: true }, inputMode: 'phone' });
    set({ phase: 'building', run: { kind: 'fixture', index: 0 } });
    time = 1250;
    set({ phase: 'intro' });
    set({ phase: 'play' });
    set({ phase: 'paused' });
    set({ phase: 'play' });
    set({ phase: 'goal' });
    const played = records.filter((e) => e.name === 'played');
    expect(played).toHaveLength(1);
    expect(records.find((e) => e.name === 'stage_loaded')).toMatchObject({
      duration_ms: 1250,
      attempt: played[0]?.attempt,
    });
    expect(records.find((e) => e.name === 'finished')).toMatchObject({ attempt: played[0]?.attempt });
    set({ phase: 'building' });
    set({ phase: 'error', error: { code: 'https://private.example/secret' } });
    expect(records.find((e) => e.name === 'build_failed')).toMatchObject({ code: 'OTHER' });
    expect(JSON.stringify(records)).not.toContain('private.example');
    off();
  });
});
