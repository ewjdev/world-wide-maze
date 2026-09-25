/**
 * Page → stage slicing (contracts §3/§4). A long page becomes several stages played in order as one run:
 * the page is split into n = ceil(height / MAX_STAGE_HEIGHT_PX) slices of balanced height (no tiny tail slice);
 * slice i covers page y ∈ [round(i·h/n), round((i+1)·h/n)).
 * Pure math, shared by the builder (which re-exports `sliceCount`), the capture service and the game.
 */
import { MAX_STAGE_HEIGHT_PX } from './constants.ts';
import type { CaptureBundle, StageSlice } from './types.ts';

/** Anything with the capture's `page` size (a full `CaptureBundle` works). */
export type PageSized = Pick<CaptureBundle, 'page'>;

/** Number of stage slices for a capture (≥ 1). */
export function sliceCount(capture: PageSized): number {
  const h = capture.page.height;
  if (!(h > 0)) return 1;
  return Math.max(1, Math.ceil(h / MAX_STAGE_HEIGHT_PX));
}

/**
 * The page-space extent of slice `index`, in the exact shape of `StageData.source.slice`.
 * Throws RangeError for an index outside [0, sliceCount).
 */
export function sliceRange(capture: PageSized, index: number): StageSlice {
  const count = sliceCount(capture);
  if (!Number.isInteger(index) || index < 0 || index >= count)
    throw new RangeError(`sliceRange: index ${index} outside [0, ${count})`);
  const h = capture.page.height;
  const y = Math.round((index * h) / count);
  const height = Math.round(((index + 1) * h) / count) - y;
  return { index, count, y, height };
}
