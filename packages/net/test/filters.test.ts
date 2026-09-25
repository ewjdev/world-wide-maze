import { describe, expect, test } from 'vitest';
import { OneEuroFilter } from '../src/one-euro.ts';
import { RttTracker } from '../src/rtt.ts';
import { StreamStats } from '../src/stats.ts';

describe('OneEuroFilter', () => {
  test('passes the first value through and holds a constant input', () => {
    const f = new OneEuroFilter();
    expect(f.filter(0.3, 0)).toBe(0.3);
    for (let t = 16; t < 1000; t += 16) expect(f.filter(0.3, t)).toBeCloseTo(0.3, 12);
  });

  test('small step at rest follows the minCutoff time constant (≈0.16 s at 1 Hz)', () => {
    const f = new OneEuroFilter({ beta: 0 });
    f.filter(0, 0);
    let t = 0;
    let y = 0;
    // Step to 0.01 rad; sample at 120 Hz. After τ = 1/(2π) s ≈ 159 ms, output ≈ 63% (discrete ≈ 60–66%).
    while (t < 159) {
      t += 1000 / 120;
      y = f.filter(0.01, t);
    }
    expect(y / 0.01).toBeGreaterThan(0.58);
    expect(y / 0.01).toBeLessThan(0.7);
    // Converged after 1 s.
    while (t < 1200) {
      t += 1000 / 120;
      y = f.filter(0.01, t);
    }
    expect(y).toBeCloseTo(0.01, 4);
  });

  test('beta speeds up fast motion (less lag on a ramp than a fixed low-pass)', () => {
    const adaptive = new OneEuroFilter({ beta: 0.8 });
    const fixed = new OneEuroFilter({ beta: 0 });
    let ea = 0;
    let ef = 0;
    for (let i = 0; i <= 60; i++) {
      const t = i * (1000 / 60);
      const x = (t / 1000) * 2; // 2 rad/s swing
      ea = x - adaptive.filter(x, t);
      ef = x - fixed.filter(x, t);
    }
    expect(ea).toBeLessThan(ef * 0.7);
    expect(adaptive.lagMs).toBeLessThan(fixed.lagMs);
  });

  test('removes sensor jitter', () => {
    const f = new OneEuroFilter();
    let seed = 1;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    const out: number[] = [];
    for (let i = 0; i < 600; i++) out.push(f.filter(0.2 + 0.02 * rand(), i * (1000 / 60)));
    const tail = out.slice(120);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const sd = Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
    // Raw noise sd = 0.02/sqrt(12) ≈ 0.0058
    expect(sd).toBeLessThan(0.0058 / 3);
    expect(mean).toBeCloseTo(0.2, 2);
  });

  test('ignores non-increasing timestamps', () => {
    const f = new OneEuroFilter();
    f.filter(0, 0);
    const y = f.filter(1, 100);
    expect(f.filter(5, 100)).toBe(y);
    expect(f.filter(5, 50)).toBe(y);
  });
});

describe('RttTracker', () => {
  test('p50/p95 by nearest rank over a sliding window', () => {
    const r = new RttTracker(100);
    for (let i = 1; i <= 100; i++) r.add(i);
    expect(r.summary()).toMatchObject({ count: 100, last: 100, p50: 50, p95: 95, min: 1, max: 100 });
    for (let i = 0; i < 100; i++) r.add(1000);
    expect(r.percentile(50)).toBe(1000);
    r.add(Number.NaN);
    r.add(-1);
    expect(r.summary().count).toBe(200);
  });
});

describe('StreamStats', () => {
  test('rate, jitter, seq gaps and bursts', () => {
    const s = new StreamStats();
    let seq = 0;
    for (let i = 0; i < 60; i++) s.add(i * 16.7, seq++);
    let sum = s.summary(60 * 16.7);
    expect(sum.ratePerSec).toBeGreaterThanOrEqual(59);
    expect(sum.jitterMs).toBeLessThan(0.01);
    expect(sum.lost).toBe(0);
    seq += 3; // 3 frames lost
    s.add(61 * 16.7, seq++);
    s.add(61 * 16.7 + 500, seq++); // a 500 ms gap: Nagle-style burst
    sum = s.summary(61 * 16.7 + 500);
    expect(sum.lost).toBe(3);
    expect(sum.bursts).toBe(1);
    // Wraparound is not a gap.
    const w = new StreamStats();
    w.add(0, 0xffff);
    w.add(16, 0);
    expect(w.summary(16).lost).toBe(0);
  });
});
