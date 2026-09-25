/**
 * End-to-end capture on an already-created page: navigate → prepare → extract → hide fixed → screenshot.
 * Shared by tools/fixture-capture (local Playwright) and apps/worker (Browser Rendering, Phase 07) so the
 * fixtures and hosted captures go through identical steps. SSRF checks, timeouts around the whole thing,
 * and storage are the caller's job.
 */
import { type CaptureBundle, computeCaptureId, DEFAULT_VIEWPORT, MAX_PAGE_HEIGHT_PX } from '@wwm/schema';
import { type ExtractedPage, type ExtractOptions, extractPage } from './extract.ts';
import { pageExpression } from './page-expr.ts';
import { hideFixedElements, type PageLike, type PrepareReport, preparePage } from './prepare.ts';

/** The subset of Playwright's `Page` that `capturePage` uses. */
export interface CapturePageLike extends PageLike {
  goto(
    url: string,
    opts?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number },
  ): Promise<unknown>;
  url(): string;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  screenshot(opts: {
    clip?: { x: number; y: number; width: number; height: number };
    fullPage?: boolean;
    type?: 'png' | 'jpeg';
  }): Promise<Uint8Array>;
}

export interface CaptureOptions {
  /** Where the screenshot will be stored, recorded in `bundle.screenshot.path`. */
  screenshotPath: string;
  viewport?: { width: number; height: number };
  maxPageHeight?: number;
  navigationTimeoutMs?: number;
  /** Override the clock (tests / reproducible fixtures). */
  now?: () => Date;
  extract?: Omit<ExtractOptions, 'maxPageHeight'>;
}

export interface CaptureResult {
  bundle: CaptureBundle;
  /** PNG bytes, `bundle.screenshot.width × height`. */
  png: Uint8Array;
  prepare: PrepareReport;
  hiddenFixed: number;
}

/**
 * Normalize a URL for caching/ids: lower-case scheme and host, drop default ports, the fragment, and
 * common tracking params (utm_*, fbclid, gclid…), sort remaining query params. Throws on invalid URLs.
 */
export function normalizeUrl(input: string): string {
  const u = new URL(input.trim());
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443'))
    u.port = '';
  const drop = [...u.searchParams.keys()].filter((k) =>
    /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i.test(k),
  );
  for (const k of drop) u.searchParams.delete(k);
  u.searchParams.sort();
  return u.toString();
}

export async function capturePage(
  page: CapturePageLike,
  url: string,
  opts: CaptureOptions,
): Promise<CaptureResult> {
  const viewport = opts.viewport ?? { ...DEFAULT_VIEWPORT };
  const maxH = opts.maxPageHeight ?? MAX_PAGE_HEIGHT_PX;
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: 'load', timeout: opts.navigationTimeoutMs ?? 30_000 });
  const prepare = await preparePage(page, { maxHeight: maxH });
  const extracted = (await page.evaluate(
    pageExpression(extractPage, { ...opts.extract, maxPageHeight: maxH }),
  )) as ExtractedPage;
  const hiddenFixed = await hideFixedElements(page);

  const width = viewport.width;
  const height = Math.min(extracted.page.height, maxH);
  const png = await page.screenshot({ type: 'png', fullPage: true, clip: { x: 0, y: 0, width, height } });

  const capturedAt = (opts.now ?? (() => new Date()))().toISOString();
  const finalUrl = normalizeUrl(page.url() || extracted.url);
  const bundle: CaptureBundle = {
    schema: 'wwm.capture/1',
    captureId: await computeCaptureId(finalUrl, capturedAt),
    url: finalUrl,
    title: extracted.title,
    capturedAt,
    viewport: extracted.viewport,
    page: extracted.page,
    screenshot: { path: opts.screenshotPath, width, height, format: 'png' },
    backgroundColor: extracted.backgroundColor,
    elements: extracted.elements,
  };
  return { bundle, png, prepare, hiddenFixed };
}
