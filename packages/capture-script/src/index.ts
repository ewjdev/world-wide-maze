/**
 * @wwm/capture-script — the in-page DOM extraction (`extractPage`), page preparation helpers, and the
 * shared capture sequence. Used by tools/fixture-capture (Phase 02) and apps/worker (Phase 07).
 */
export {
  type CaptureOptions,
  type CapturePageLike,
  type CaptureResult,
  capturePage,
  normalizeUrl,
  pngSize,
} from './capture.ts';
export { type ExtractedPage, type ExtractOptions, extractPage } from './extract.ts';
export { pageExpression } from './page-expr.ts';
export {
  COOKIE_BUTTON_SELECTORS,
  COOKIE_CONTAINER_SELECTORS,
  COOKIE_TEXT_FALLBACK,
  dismissCookieBanners,
  freezeMotion,
  hideFixedElements,
  type PageLike,
  type PrepareOptions,
  type PrepareReport,
  preparePage,
  scrollThrough,
  waitForAssets,
} from './prepare.ts';
