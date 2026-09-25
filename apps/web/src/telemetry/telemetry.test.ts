import { describe, expect, test } from 'vitest';
import {
  createTelemetry,
  type FunnelView,
  installTelemetry,
  noopSink,
  observeGame,
  privacySignalsSet,
  scrubMessage,
  type TelemetryRecord,
} from './index.ts';

function recorder() {
  const records: TelemetryRecord[] = [];
  return { records, sink: { send: (r: TelemetryRecord) => void records.push(r) } };
}

function fakeGame(initial: FunnelView) {
  let view = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getView: () => view,
    set(patch: Partial<FunnelView>) {
      view = { ...view, ...patch };
      for (const l of listeners) l();
    },
  };
}

const base: FunnelView = {
  phase: 'title',
  inputMode: null,
  room: { controllerConnected: false },
  run: null,
  error: null,
};

describe('telemetry', () => {
  test('is a no-op by default and never throws', () => {
    const t = createTelemetry();
    expect(t.enabled).toBe(false);
    t.track({ name: 'title' });
    const broken = createTelemetry({
      sink: {
        send() {
          throw new Error('boom');
        },
      },
    });
    expect(() => broken.track({ name: 'title' })).not.toThrow();
  });

  test('records carry only the event, a per-load visit id and a relative time', () => {
    const { records, sink } = recorder();
    const t = createTelemetry({ sink, now: () => 42, visit: 'v1' });
    t.track({ name: 'build_failed', code: 'UNPLAYABLE' });
    expect(records).toEqual([{ name: 'build_failed', code: 'UNPLAYABLE', visit: 'v1', ms: 42 }]);
  });

  test('the funnel follows the game: title → paired → played → finished / ended, build failures', () => {
    const { records, sink } = recorder();
    const t = createTelemetry({ sink, now: () => 0, visit: 'v' });
    const g = fakeGame(base);
    const off = observeGame(g, t);
    g.set({ phase: 'pairing' });
    g.set({ room: { controllerConnected: true }, inputMode: 'phone' });
    g.set({ phase: 'intro', run: { kind: 'fixture', index: 0 } });
    g.set({ phase: 'countdown' });
    g.set({ phase: 'play' });
    g.set({ phase: 'paused' });
    g.set({ phase: 'play' }); // resuming is not a new play
    g.set({ phase: 'goal' });
    g.set({ phase: 'intro', run: { kind: 'fixture', index: 1 } });
    g.set({ phase: 'play' });
    g.set({ phase: 'timeup' });
    g.set({ phase: 'error', error: { code: 'CAPTURE_TIMEOUT' } });
    off();
    g.set({ phase: 'title' });
    expect(records.map(({ visit: _v, ms: _m, ...e }) => e)).toEqual([
      { name: 'title' },
      { name: 'paired', input: 'phone' },
      { name: 'played', input: 'phone', run: 'fixture', slice: 0 },
      { name: 'finished', run: 'fixture', slice: 0 },
      { name: 'played', input: 'phone', run: 'fixture', slice: 1 },
      { name: 'ended', reason: 'timeup', run: 'fixture', slice: 1 },
      { name: 'build_failed', code: 'CAPTURE_TIMEOUT' },
    ]);
  });

  test('error messages lose URLs, ids and long numbers', () => {
    expect(
      scrubMessage('fetch https://example.com/a?b=1 failed for room 123456 id 0123456789abcdef0123'),
    ).toBe('fetch <url> failed for room <n> id <id>');
    expect(scrubMessage('x'.repeat(500))).toHaveLength(160);
  });

  test('install: no URL, Do Not Track or GPC → no-op sink', () => {
    const t = createTelemetry();
    const win = (nav: object) =>
      ({ navigator: nav, addEventListener() {}, document: { addEventListener() {} } }) as unknown as Window;
    expect(installTelemetry({ win: win({}), target: t })).toBe(noopSink);
    expect(installTelemetry({ url: '/api/t', win: win({ doNotTrack: '1' }), target: t })).toBe(noopSink);
    expect(privacySignalsSet({ globalPrivacyControl: true } as unknown as Navigator)).toBe(true);
    expect(t.enabled).toBe(false);
    expect(installTelemetry({ url: '/api/t', win: win({}), target: t })).not.toBe(noopSink);
    expect(t.enabled).toBe(true);
  });
});
