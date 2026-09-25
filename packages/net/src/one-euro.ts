/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012): an adaptive low-pass filter whose cutoff rises with
 * speed, so slow tilts are smoothed heavily (no jitter) while fast flicks pass with little lag.
 * N: it replaces the 2013 fixed EMA (slerp 0.09 per 60 Hz tick, τ ≈ 0.18 s, fidelity-spec §1).
 *
 * Tilt defaults (radians in, radians out):
 * - `minCutoff` 1.0 Hz: at rest τ = 1/(2π·1.0) ≈ 0.16 s, close to the 2013 τ ≈ 0.18 s.
 * - `beta` 0.8: a 1 rad/s swing raises the cutoff to 1.8 Hz (τ ≈ 0.09 s), so flicks feel responsive.
 * - `dCutoff` 1.0 Hz for the speed estimate.
 */
export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

export const ONE_EURO_TILT_DEFAULTS: Readonly<OneEuroParams> = Object.freeze({
  minCutoff: 1.0,
  beta: 0.8,
  dCutoff: 1.0,
});

function smoothingFactor(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter {
  params: OneEuroParams;
  #x: number | null = null;
  #dx = 0;
  #tMs = 0;

  constructor(params: Partial<OneEuroParams> = {}) {
    this.params = { ...ONE_EURO_TILT_DEFAULTS, ...params };
  }

  /** Filter `value` observed at `tMs` (monotonic ms). A non-increasing timestamp returns the last output. */
  filter(value: number, tMs: number): number {
    if (this.#x === null) {
      this.#x = value;
      this.#dx = 0;
      this.#tMs = tMs;
      return value;
    }
    const dt = (tMs - this.#tMs) / 1000;
    if (!(dt > 0)) return this.#x;
    this.#tMs = tMs;
    const rawDx = (value - this.#x) / dt;
    this.#dx += smoothingFactor(this.params.dCutoff, dt) * (rawDx - this.#dx);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.#dx);
    this.#cutoff = cutoff;
    this.#x += smoothingFactor(cutoff, dt) * (value - this.#x);
    return this.#x;
  }

  #cutoff: number | null = null;

  get value(): number | null {
    return this.#x;
  }

  /** Effective time constant of the last step in ms (1 / 2π·cutoff): the filter's current lag. */
  get lagMs(): number {
    const c = this.#cutoff ?? this.params.minCutoff;
    return 1000 / (2 * Math.PI * c);
  }

  reset(value: number | null = null, tMs = 0): void {
    this.#x = value;
    this.#dx = 0;
    this.#tMs = tMs;
    this.#cutoff = null;
  }
}
