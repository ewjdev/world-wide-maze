/**
 * Automatic quality ladder (pure). The 2013 performance adjuster (E: `game/performanceadjuster` @863421)
 * stepped down: <45 fps env map off · <40 render scale 0.7 and FXAA off · <30 glow off. We keep those rungs,
 * add a cheap-background rung (N) and recover with hysteresis (N; 2013 only went down).
 *
 * Tier 0 = everything on. Each tier includes the ones before it.
 */

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';

export interface TierFeatures {
  envMapUpdates: boolean;
  renderScale: number;
  fxaa: boolean;
  glow: boolean;
  richBackground: boolean;
}

export const TIERS: readonly TierFeatures[] = [
  { envMapUpdates: true, renderScale: 1, fxaa: true, glow: true, richBackground: true },
  { envMapUpdates: false, renderScale: 1, fxaa: true, glow: true, richBackground: true },
  { envMapUpdates: false, renderScale: 0.7, fxaa: false, glow: true, richBackground: true },
  { envMapUpdates: false, renderScale: 0.7, fxaa: false, glow: false, richBackground: true },
  { envMapUpdates: false, renderScale: 0.7, fxaa: false, glow: false, richBackground: false },
];
export const MAX_TIER = TIERS.length - 1;

/** fps below which a tier is no longer acceptable (index = tier that gets abandoned). */
const DOWN_FPS = [45, 40, 30, 24];
/** Hysteresis: to climb back to tier t, fps must exceed DOWN_FPS[t] + UP_MARGIN for UP_HOLD_SEC. */
const UP_MARGIN = 10;

export interface LadderOptions {
  windowSec?: number;
  warmupSec?: number;
  upHoldSec?: number;
}

export class QualityLadder {
  tier: number;
  private readonly fixed: boolean;
  private samples: number[] = [];
  private sum = 0;
  private elapsed = 0;
  private sinceChange = 0;
  private goodFor = 0;
  private readonly windowSec: number;
  private readonly warmupSec: number;
  private readonly upHoldSec: number;
  /** Recent tier changes (for the sandbox / evidence). */
  readonly log: { atSec: number; from: number; to: number; fps: number }[] = [];

  constructor(setting: QualitySetting = 'auto', opts: LadderOptions = {}) {
    this.windowSec = opts.windowSec ?? 2;
    this.warmupSec = opts.warmupSec ?? 1.5;
    this.upHoldSec = opts.upHoldSec ?? 6;
    this.fixed = setting !== 'auto';
    this.tier = setting === 'low' ? 3 : setting === 'medium' ? 1 : 0;
  }

  get features(): TierFeatures {
    return TIERS[this.tier] as TierFeatures;
  }

  /** Rolling mean fps over the window (0 until there is data). */
  get fps(): number {
    return this.sum > 0 ? this.samples.length / this.sum : 0;
  }

  /** Feed one frame time. Returns true when the tier changed. */
  sample(dtSec: number): boolean {
    if (!(dtSec > 0) || dtSec > 1) return false; // tab switches, breakpoints
    this.elapsed += dtSec;
    this.samples.push(dtSec);
    this.sum += dtSec;
    while (this.sum > this.windowSec && this.samples.length > 1) this.sum -= this.samples.shift() as number;
    if (this.fixed || this.elapsed < this.warmupSec) return false;
    this.sinceChange += dtSec;
    if (this.sinceChange < this.windowSec) return false; // let the window refill after a change
    const fps = this.fps;
    const down = DOWN_FPS[this.tier];
    if (down !== undefined && fps < down && this.tier < MAX_TIER) return this.change(this.tier + 1, fps);
    const upNeed = this.tier > 0 ? (DOWN_FPS[this.tier - 1] as number) + UP_MARGIN : Number.POSITIVE_INFINITY;
    if (fps > upNeed) {
      this.goodFor += dtSec;
      if (this.goodFor >= this.upHoldSec) return this.change(this.tier - 1, fps);
    } else this.goodFor = 0;
    return false;
  }

  private change(to: number, fps: number): boolean {
    this.log.push({ atSec: this.elapsed, from: this.tier, to, fps });
    if (this.log.length > 32) this.log.shift();
    this.tier = to;
    this.sinceChange = 0;
    this.goodFor = 0;
    return true;
  }
}
