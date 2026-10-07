/** Active-time countdown: pausing retains the fractional next beat; a completed record never repeats Go. */
export const COUNTDOWN_BEAT_SEC = 0.6;
export class Countdown {
  beat = 3;
  remaining = COUNTDOWN_BEAT_SEC;
  advance(seconds: number): number[] {
    const beats: number[] = [];
    if (this.beat === 0) return beats;
    this.remaining -= Math.max(0, seconds);
    while (this.remaining <= 0 && this.beat > 0) {
      beats.push(--this.beat);
      this.remaining += COUNTDOWN_BEAT_SEC;
    }
    return beats;
  }
}
