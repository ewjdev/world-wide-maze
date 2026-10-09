import type { GamePhase } from '@wwm/schema';

export type TitleMotion = 'cached' | 10 | 15 | 30;

export function titleMotion(value: string | null): TitleMotion {
  return value === '10' ? 10 : value === '15' ? 15 : value === '30' ? 30 : 'cached';
}

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
  #titleIdle = false;

  reset(): void {
    this.#phase = null;
    this.#lastAt = Number.NEGATIVE_INFINITY;
    this.#elapsed = 0;
    this.#titleIdle = false;
  }

  /** Returns accumulated animation seconds when a render is due, otherwise null. */
  advance(
    nowMs: number,
    dtSec: number,
    phase: GamePhase,
    needsFrame = true,
    motion: TitleMotion = 30,
  ): number | null {
    if (phase !== this.#phase) {
      this.#phase = phase;
      this.#changedAt = nowMs;
    }
    this.#elapsed += dtSec;
    // The map camera blends for 0.9 s. Preserve that transition at display cadence.
    const settling = nowMs - this.#changedAt < 1000;
    if (phase === 'title' && motion === 'cached' && !needsFrame && !settling) {
      this.#elapsed = 0;
      this.#titleIdle = true;
      return null;
    }
    if (this.#titleIdle) {
      this.#titleIdle = false;
      this.#lastAt = Number.NEGATIVE_INFINITY;
      this.#elapsed = dtSec;
    }
    const interval = settling
      ? 0
      : phase === 'paused'
        ? 1000 / 15
        : phase === 'title' && motion !== 'cached'
          ? 1000 / motion
          : SLOW_PHASES.has(phase)
            ? 1000 / 30
            : 0;
    if (nowMs - this.#lastAt + 0.5 < interval) return null;
    this.#lastAt = nowMs;
    const elapsed = this.#elapsed;
    this.#elapsed = 0;
    return elapsed;
  }
}
