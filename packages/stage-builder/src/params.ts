/**
 * Every tunable of the stage builder, in one place.
 *
 * Units: lengths are stage px unless the name ends in `D` (ball diameters, 1 D = PX_PER_METER = 13.5 px).
 * Provenance tags on each value:
 *  - **E**  evidenced by the 2013 build / the WWMMM AID-DCC stage (docs/reference/stage-format.md, fidelity-spec §6)
 *  - **C**  calibrated: tuned in the stage debugger until the output distribution matched the 2013 stage
 *  - **N**  chosen (new): a design choice with no 2013 evidence
 * The 2013 stage used 10.8 px per D; our scale is 13.5 px per D (×1.25), so 2013 px × 1.25 = our px.
 */

import type { Difficulty } from '@wwm/schema';
import { MAX_LARGE_ITEMS, MIN_BRIDGE_WIDTH_PX, MIN_ISLAND_SIZE_PX, PX_PER_METER } from '@wwm/schema';

/** 1 ball diameter in px. */
export const D = PX_PER_METER;

export interface BuildParams {
  // ── grid ──
  /** Work-grid cell size, stage px. N (G0 suggests 2–3 px at the faithful scale). */
  cellPx: number;

  // ── background ──
  /** CIE76 ΔE below which a pixel counts as background. C. */
  bgDeltaE: number;
  /** Fraction of a cell's samples that must be foreground for the cell to be foreground. C. */
  fgCellFraction: number;
  /** An element's own `bg` becomes local background when its rect covers at least this share of the viewport. C. */
  bgRegionMinViewportShare: number;

  // ── semantic ──
  /** Text line rects are padded horizontally by this × line height (each side). N (brief: 0.5 × line height). */
  textPadXPerLine: number;
  /** …and vertically by this × line height (each side). C (HN list rows are only 5 px apart). */
  textPadYPerLine: number;
  /** Lines of one element closer than this × line height are joined into one paragraph block. C. */
  paragraphJoinPerLine: number;
  /** A DOM rect is only filled solid if at least this share of its cells is visibly foreground (skips lazy/hidden media). N. */
  semanticVisibleShare: number;

  // ── morphology ──
  /** Opening radius (cells) applied to the raw pixel mask: removes hairlines, borders and anti-aliasing specks. C. */
  pixelOpenCells: number;
  /** Closing radius (cells) after the semantic OR: merges near-touching fragments (≈ 2013 dilate → blur → threshold). C. */
  closeCellsX: number;
  closeCellsY: number;
  /** Holes smaller than this area are filled. C. */
  holeFillMaxPx2: number;
  /** Final opening radius (cells): cuts necks too thin for the ball. C. */
  neckOpenCells: number;
  /** Thin components (one text line, a slim bar) grow by up to this many cells per side to reach the minimum thickness. N. */
  thickenMaxCells: number;

  // ── islands ──
  /** An island must contain a disc of this diameter (distance-transform max ≥ half of it). E (MIN_ISLAND_SIZE_PX = 2 D). */
  minIslandThicknessPx: number;
  /** Minimum island area. C (2013 min 727 2013-px² ≈ 6 D²). */
  minIslandAreaPx2: number;
  /** Components larger than this are split along natural gaps. C (2013's single giant island was ≈ 2700 D²). */
  splitAreaPx2: number;
  /** Target tile edge when splitting. N. */
  splitTilePx: number;
  /** Width of the channel cut between split tiles, cells. N. */
  splitChannelCells: number;

  // ── contours ──
  /** Douglas–Peucker tolerance, px. N (≈ 1/3 cell: keeps islands ≥ 1 cell apart after simplification). */
  simplifyEpsPx: number;
  /** Corner bevel length, px (a light Chaikin cut; 2013 islands are rounded-corner rectangles, median 8 vertices). C. */
  cornerBevelPx: number;

  // ── bridges ──
  /** Deck width range, px. E 1.6–3.6 D, clamped up to the contract minimum 2.5 D. */
  bridgeWidthMinPx: number;
  bridgeWidthMaxPx: number;
  /** Longest gap a bridge may span, px. E (2013 max 459 2013-px ≈ 42.5 D). */
  maxBridgeSpanPx: number;
  /** Bridge ends are pushed this far into each island so the deck overlaps the slab. N. */
  bridgeInsetPx: number;
  /** Extra free space (cells) required on each side of a bridge band. N. */
  bridgeSideClearCells: number;
  /** Minimum share of the deck width that must touch each island at the mouth. N. */
  bridgeMinContact: number;

  // ── maze ──
  /** Share of non-tree candidate edges added back as loops, per difficulty. G0: easy 15 %, normal 0, hard 0 (N). */
  loopShare: Record<Difficulty, number>;

  // ── heights (R: the 2013 method is unknown) ──
  /** Island level range, D. E (2013: 9.3–23.2 D). */
  levelMin: number;
  levelMax: number;
  /** Mid level for "main content". C (2013 median ≈ 17 D). */
  levelMid: number;
  /** Seeded noise amplitude on the per-island target level, D. C. */
  levelNoise: number;
  /** Share of the level range spanned by the top → bottom trend (2013: start 22.7 D top-left, goal 12.8 D bottom). C. */
  levelTrend: number;
  /** An eligible short edge only becomes an elevator when the target asks for at least this rise, D. C. */
  elevatorMinWantD: number;
  /** Ramp slope used when assigning heights (kept below MAX_RAMP_SLOPE = 0.1765 for float safety). E-derived. */
  rampSlope: number;
  /** Probability that a tree edge is kept flat. C (2013: 11 of 31 static bridges flat). */
  flatChance: number;
  /** Gaps up to this length (px, a→b) may become elevators. E (2013 elevator gaps 4–10 2013-px). */
  elevatorMaxSpanPx: number;
  /** Elevator rises, D. E (2013: 40/60/80 2013-px = 3.70/5.56/7.41 D). */
  elevatorRisesD: number[];
  /** Probability that an eligible short edge becomes an elevator. C (2013: 6 of 37 links). */
  elevatorChance: number;

  // ── placement ──
  /** Small-item inset rings, px from the edge. E (0.9 D and 2.3 D). */
  itemRingsPx: number[];
  /** Small-item spacing along a ring, px. E (1.5 D). */
  itemSpacingPx: number;
  /** Seeded jitter applied to item positions, px. N. */
  itemJitterPx: number;
  /** Share of islands that carry small items (2013: 22 of 38). C. */
  itemIslandShare: number;
  /** Target small items per D² of island area overall. E (≈ 1 per 10 D²). */
  itemsPerD2: number;
  /** Keep small items this far from start / goal / large items, px. N. */
  itemKeepOutPx: number;
  /** Restart inset rings, px from the edge. E (0.56 D and 1.3 D; the inner ring is lifted to clear BALL_RADIUS_PX). */
  restartRingsPx: number[];
  /** Restart spacing along a ring, px. E (1.4–1.9 D). */
  restartSpacingPx: number;
  /** Large items per px² of island area. E (0.66 per 100k 2013-px² → ÷1.5625). */
  largePerPx2: number;
  maxLargeItems: number;
}

export const DEFAULT_PARAMS: BuildParams = {
  cellPx: 3,

  bgDeltaE: 9,
  fgCellFraction: 0.12,
  bgRegionMinViewportShare: 0.15,

  textPadXPerLine: 0.5,
  textPadYPerLine: 0.1,
  paragraphJoinPerLine: 0.8,
  semanticVisibleShare: 0.04,

  pixelOpenCells: 2,
  closeCellsX: 2,
  closeCellsY: 0,
  holeFillMaxPx2: 36 * D * D,
  neckOpenCells: 2,
  thickenMaxCells: 3,

  minIslandThicknessPx: MIN_ISLAND_SIZE_PX,
  minIslandAreaPx2: 8 * D * D,
  splitAreaPx2: 2500 * D * D,
  splitTilePx: 24 * D,
  splitChannelCells: 2,

  simplifyEpsPx: 1,
  cornerBevelPx: 0.25 * D,

  bridgeWidthMinPx: Math.max(MIN_BRIDGE_WIDTH_PX, 2.5 * D),
  bridgeWidthMaxPx: 3.6 * D,
  maxBridgeSpanPx: 45 * D,
  bridgeInsetPx: 3,
  bridgeSideClearCells: 1,
  bridgeMinContact: 0.6,

  loopShare: { easy: 0.15, normal: 0, hard: 0 },

  levelMin: 9.3,
  levelMax: 23.2,
  levelMid: 17,
  levelNoise: 4,
  levelTrend: 0.6,
  elevatorMinWantD: 2,
  rampSlope: 0.17,
  flatChance: 0.35,
  elevatorMaxSpanPx: 1.2 * D,
  elevatorRisesD: [3.7, 5.56, 7.41],
  elevatorChance: 0.6,

  itemRingsPx: [0.9 * D, 2.3 * D],
  itemSpacingPx: 1.5 * D,
  itemJitterPx: 0.15 * D,
  itemIslandShare: 0.6,
  itemsPerD2: 1 / 10,
  itemKeepOutPx: 1.5 * D,
  restartRingsPx: [0.6 * D, 1.3 * D],
  restartSpacingPx: 1.6 * D,
  largePerPx2: 0.66 / 100_000 / 1.5625,
  maxLargeItems: MAX_LARGE_ITEMS,
};

/** Merge overrides into the defaults (shallow; `loopShare` merged per key). */
export function resolveParams(overrides?: Partial<BuildParams>): BuildParams {
  if (!overrides) return DEFAULT_PARAMS;
  return {
    ...DEFAULT_PARAMS,
    ...overrides,
    loopShare: { ...DEFAULT_PARAMS.loopShare, ...(overrides.loopShare ?? {}) },
  };
}
