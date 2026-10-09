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
  bloomScale: number;
  maxPixels: number;
}

export const TIERS: readonly TierFeatures[] = [
  {
    envMapUpdates: true,
    renderScale: 1,
    fxaa: true,
    glow: true,
    richBackground: true,
    bloomScale: 0.5,
    maxPixels: 2560 * 1440,
  },
  {
    envMapUpdates: false,
    renderScale: 1,
    fxaa: true,
    glow: true,
    richBackground: true,
    bloomScale: 0.25,
    maxPixels: 2560 * 1440,
  },
  {
    envMapUpdates: false,
    renderScale: 0.7,
    fxaa: false,
    glow: true,
    richBackground: true,
    bloomScale: 0.25,
    maxPixels: 1920 * 1080,
  },
  {
    envMapUpdates: false,
    renderScale: 0.7,
    fxaa: false,
    glow: false,
    richBackground: true,
    bloomScale: 0,
    maxPixels: 1920 * 1080,
  },
  {
    envMapUpdates: false,
    renderScale: 0.7,
    fxaa: false,
    glow: false,
    richBackground: false,
    bloomScale: 0,
    maxPixels: 1280 * 1024,
  },
];
export const MAX_TIER = TIERS.length - 1;

// First enabling emissive MRT/bloom during active play recompiles every scene material.
// Keep Auto on the single-color graph; resolution, FXAA, reflections and decoration still recover.
// Explicit Medium/High retain the full glow profile, prepared before their first stage frame.
const AUTO_TIERS = TIERS.map((tier) => ({ ...tier, glow: false, bloomScale: 0 }));
export function qualityFeatures(setting: QualitySetting, tier: number): TierFeatures {
  return (setting === 'auto' ? AUTO_TIERS : TIERS)[tier] as TierFeatures;
}

/** fps below which a tier is no longer acceptable (index = tier that gets abandoned). */
const DOWN_FPS = [45, 40, 30, 24];
/** Hysteresis: to climb back to tier t, fps must exceed DOWN_FPS[t] + UP_MARGIN for UP_HOLD_SEC. */
const UP_MARGIN = 10;

export interface LadderOptions {
  windowSec?: number;
  warmupSec?: number;
  upHoldSec?: number;
  /** Explicit starting rung for diagnostics. Auto otherwise starts with bounded Low graphics. */
  initialTier?: number;
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
    const initial = Number.isFinite(opts.initialTier) ? (opts.initialTier as number) : 3;
    this.tier = setting === 'auto' ? initial : setting === 'low' ? 3 : setting === 'medium' ? 1 : 0;
    this.tier = Math.max(0, Math.min(MAX_TIER, Math.trunc(this.tier)));
  }

  get features(): TierFeatures {
    return TIERS[this.tier] as TierFeatures;
  }

  /** Rolling mean fps over the window (0 until there is data). */
  get fps(): number {
    return this.sum > 0 ? this.samples.length / this.sum : 0;
  }

  /** Discard timing history across loading, intentional pauses and hidden-tab gaps. */
  suspend(): void {
    this.samples.length = 0;
    this.sum = 0;
    this.sinceChange = 0;
    this.goodFor = 0;
  }

  /** A minimum-tier pressure signal is diagnostic only: gameplay fidelity never changes. */
  get status(): 'fixed' | 'suspended' | 'steady' | 'minimum-tier' {
    if (this.fixed) return 'fixed';
    if (this.samples.length === 0) return 'suspended';
    return this.tier === MAX_TIER && this.fps < (DOWN_FPS[MAX_TIER - 1] as number)
      ? 'minimum-tier'
      : 'steady';
  }

  /** Feed real active-play frame time, independent of simulation clamping. */
  sample(dtSec: number): boolean {
    if (!(dtSec > 0) || !Number.isFinite(dtSec)) return false;
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

/** Bound backing-store pixels as well as DPR; CSS size and gameplay coordinates stay unchanged. */
export function qualityPixelRatio(
  dpr: number,
  width: number,
  height: number,
  features: TierFeatures,
): number {
  return Math.min(dpr * features.renderScale, Math.sqrt(features.maxPixels / Math.max(1, width * height)));
}
