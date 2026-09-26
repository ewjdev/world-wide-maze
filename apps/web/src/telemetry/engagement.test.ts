import type { TelemetryRecord } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { createEngagementMeter, type EngagementState } from './engagement.ts';
import { createTelemetry, noopSink } from './index.ts';

function harness() {
  let time = 0;
  const events: TelemetryRecord[] = [];
  const sink = {
    send(record: TelemetryRecord) {
      events.push(record);
    },
  };
  const target = createTelemetry({ sink });
  const meter = createEngagementMeter(() => time, target);
  const state: EngagementState = {
    phase: 'play',
    run: 'practice',
    slice: 0,
    attempt: crypto.randomUUID(),
    playing: true,
  };
  meter.state(state);
  return {
    meter,
    target,
    sink,
    state,
    events,
    step(ms = 1000) {
      time += ms;
      meter.tick();
    },
  };
}
const total = (events: TelemetryRecord[], key: 'active_ms' | 'play_ms') =>
  events.reduce((sum, event) => sum + (event.name === 'engagement' ? event[key] : 0), 0);

describe('engagement accounting', () => {
  test('interval, phase and exit flushes emit non-overlapping deltas', () => {
    const h = harness();
    h.step();
    h.step();
    h.meter.flush('interval');
    h.step();
    h.meter.state({ ...h.state, phase: 'paused', playing: false });
    h.step();
    h.meter.flush('pagehide');
    h.meter.flush('stop');
    expect(total(h.events, 'active_ms')).toBe(4000);
    expect(total(h.events, 'play_ms')).toBe(3000);
    expect(h.events).toHaveLength(3);
    expect(h.events.map((e) => (e.name === 'engagement' ? e.reason : null))).toEqual([
      'interval',
      'phase',
      'pagehide',
    ]);
  });
  test('paused time remains engagement but cannot increase gameplay duration', () => {
    const h = harness();
    h.step();
    h.meter.state({ ...h.state, phase: 'paused', playing: false });
    h.step();
    h.step();
    h.meter.flush('interval');
    expect(total(h.events, 'play_ms')).toBe(1000);
    expect(total(h.events, 'active_ms')).toBe(3000);
  });
  test('hidden time contributes nothing and visibility return does not bridge the gap', () => {
    const h = harness();
    h.step();
    h.meter.flush('hidden');
    h.meter.visible(false);
    h.step(20_000);
    h.meter.visible(true);
    h.meter.activity();
    h.step();
    h.meter.flush('interval');
    expect(total(h.events, 'active_ms')).toBe(2000);
    expect(total(h.events, 'play_ms')).toBe(2000);
  });
  test('idle accounting stops after 30 seconds; renewed input begins a new active interval', () => {
    const h = harness();
    for (let i = 0; i < 45; i++) h.step();
    h.meter.flush('interval');
    expect(total(h.events, 'play_ms')).toBe(30_000);
    h.meter.activity();
    h.step();
    h.meter.flush('interval');
    expect(total(h.events, 'play_ms')).toBe(31_000);
  });
  test('suspension is capped and opt-out reset cannot spill time into a new identity', () => {
    const h = harness();
    h.step(120_000);
    h.meter.flush('interval');
    expect(total(h.events, 'active_ms')).toBe(2000);
    h.meter.activity();
    h.step();
    h.target.setSink(noopSink);
    h.meter.reset();
    h.step();
    h.meter.flush('interval');
    expect(total(h.events, 'active_ms')).toBe(2000);
    h.target.setSink(h.sink);
    h.meter.reset();
    h.step();
    h.meter.flush('interval');
    expect(total(h.events, 'active_ms')).toBe(2000);
    h.meter.activity();
    h.step();
    h.meter.flush('interval');
    expect(total(h.events, 'active_ms')).toBe(3000);
  });
});
