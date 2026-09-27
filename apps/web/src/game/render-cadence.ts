import type { GamePhase } from '@wwm/schema';

const SLOW_PHASES = new Set<GamePhase>([
  'title',
  'howto',
  'pairing',
  'calibrate',
  'select',
  'building',
  'result',
  'ranking',
  'error',
]);

/** Keep input/physics responsive while inexpensive views submit fewer scene frames. */
export class RenderCadence {
  #phase: GamePhase | null = null;
  #changedAt = 0;
  #lastAt = Number.NEGATIVE_INFINITY;
  #elapsed = 0;

  reset(): void {
    this.#phase = null;
    this.#lastAt = Number.NEGATIVE_INFINITY;
    this.#elapsed = 0;
  }

  /** Returns accumulated animation seconds when a render is due, otherwise null. */
  advance(nowMs: number, dtSec: number, phase: GamePhase): number | null {
    if (phase !== this.#phase) {
      this.#phase = phase;
      this.#changedAt = nowMs;
    }
    this.#elapsed += dtSec;
    // The map camera blends for 0.9 s. Preserve that transition at display cadence.
    const settling = nowMs - this.#changedAt < 1000;
    const interval = settling ? 0 : phase === 'paused' ? 1000 / 15 : SLOW_PHASES.has(phase) ? 1000 / 30 : 0;
    if (nowMs - this.#lastAt + 0.5 < interval) return null;
    this.#lastAt = nowMs;
    const elapsed = this.#elapsed;
    this.#elapsed = 0;
    return elapsed;
  }
}
