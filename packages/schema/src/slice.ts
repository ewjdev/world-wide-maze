/**
 * Page → stage slicing (contracts §3/§4). A long page becomes several stages played in order as one run:
 * slice i covers page y ∈ [i·MAX_STAGE_HEIGHT_PX, min((i+1)·MAX_STAGE_HEIGHT_PX, page.height)).
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
  const y = index * MAX_STAGE_HEIGHT_PX;
  const height = Math.min(MAX_STAGE_HEIGHT_PX, capture.page.height - y);
  return { index, count, y, height };
}
