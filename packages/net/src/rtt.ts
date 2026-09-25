/**
 * Round-trip-time tracker over a sliding window of samples (ping/pong, contracts §6).
 * Reports p50/p95 for the latency overlay and the Phase 12 session summary.
 */
export interface RttSummary {
  count: number;
  last: number | null;
  p50: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
}

/** Nearest-rank percentile of `values` (unsorted), `p` in [0, 100]. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
}

export class RttTracker {
  readonly #window: number;
  readonly #samples: number[] = [];
  #count = 0;
  #last: number | null = null;

  constructor(window = 120) {
    this.#window = window;
  }

  add(rttMs: number): void {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    this.#samples.push(rttMs);
    if (this.#samples.length > this.#window) this.#samples.shift();
    this.#count++;
    this.#last = rttMs;
  }

  percentile(p: number): number | null {
    return percentile(this.#samples, p);
  }

  summary(): RttSummary {
    const s = this.#samples;
    return {
      count: this.#count,
      last: this.#last,
      p50: percentile(s, 50),
      p95: percentile(s, 95),
      min: s.length ? Math.min(...s) : null,
      max: s.length ? Math.max(...s) : null,
    };
  }

  reset(): void {
    this.#samples.length = 0;
    this.#count = 0;
    this.#last = null;
  }
}
