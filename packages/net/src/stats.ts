/**
 * Latency instrumentation for the dev overlay and the Phase 12 measurements: frame rate over the last
 * second, inter-arrival jitter, and seq gaps (lost frames). Pure; feed it timestamps.
 */
import { percentile } from './rtt.ts';

export interface StreamSummary {
  frames: number;
  /** Frames in the last 1000 ms. */
  ratePerSec: number;
  /** Inter-arrival interval stats over the window (ms). */
  intervalP50: number | null;
  intervalP95: number | null;
  /** Std-dev of inter-arrival intervals (ms). */
  jitterMs: number | null;
  /** Frames missing according to seq (u16, wrapping). */
  lost: number;
  /** Intervals > 3× the median: bursty delivery (e.g. Nagle buffering). */
  bursts: number;
}

export class StreamStats {
  readonly #times: number[] = [];
  readonly #intervals: number[] = [];
  readonly #window: number;
  #frames = 0;
  #lost = 0;
  #bursts = 0;
  #lastSeq: number | null = null;

  constructor(window = 240) {
    this.#window = window;
  }

  /** Record one frame at `atMs`; pass `seq` to count gaps. */
  add(atMs: number, seq?: number): void {
    const prev = this.#times.at(-1);
    this.#times.push(atMs);
    if (this.#times.length > this.#window) this.#times.shift();
    if (prev !== undefined) {
      const dt = atMs - prev;
      const med = percentile(this.#intervals, 50);
      if (med !== null && this.#intervals.length >= 30 && dt > 3 * Math.max(med, 5)) this.#bursts++;
      this.#intervals.push(dt);
      if (this.#intervals.length > this.#window) this.#intervals.shift();
    }
    if (seq !== undefined) {
      if (this.#lastSeq !== null) {
        const d = (seq - this.#lastSeq + 0x10000) % 0x10000;
        if (d > 1 && d < 0x8000) this.#lost += d - 1;
      }
      this.#lastSeq = seq;
    }
    this.#frames++;
  }

  /** Forget seq continuity (e.g. after a reconnect). */
  resetSeq(): void {
    this.#lastSeq = null;
  }

  summary(nowMs: number): StreamSummary {
    const iv = this.#intervals;
    let jitter: number | null = null;
    if (iv.length > 1) {
      const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
      jitter = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length);
    }
    return {
      frames: this.#frames,
      ratePerSec: this.#times.filter((t) => nowMs - t <= 1000).length,
      intervalP50: percentile(iv, 50),
      intervalP95: percentile(iv, 95),
      jitterMs: jitter,
      lost: this.#lost,
      bursts: this.#bursts,
    };
  }
}
