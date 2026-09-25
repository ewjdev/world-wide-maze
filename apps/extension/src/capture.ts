/**
 * Full-page capture of the player's tab, as they see it (contracts §10.2):
 *
 *   prepare (freeze motion, load lazy content) → extractPage (DOM, @wwm/capture-script) → frame 0 at the top
 *   → hide fixed/sticky → scroll-stitch the remaining frames with `captureVisibleTab` → restore the page
 *   → one image at min(devicePixelRatio, CAPTURE_DPR) → `CaptureBundle` checked with `parseCapture`.
 *
 * Browser APIs come in through `CaptureDeps`, so the sequence is unit-tested with a mocked `chrome.*`.
 */
import { type ExtractedPage, extractPage, normalizeUrl } from '@wwm/capture-script';
import {
  CAPTURE_DPR,
  CAPTURE_LIMITS,
  type CaptureBundle,
  computeCaptureId,
  MAX_PAGE_HEIGHT_PX,
  parseCapture,
} from '@wwm/schema';
import type { ChromeApi, Tab } from './chrome.ts';
import { type PageMetrics, pageHideFixed, pagePrepare, pageRestore, pageScrollTo } from './page-fns.ts';
import { capturable } from './url.ts';

/** `captureVisibleTab` is limited to 2 calls per second per extension (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND). */
export const FRAME_INTERVAL_MS = 560;
/** Upper bound on the stitched image (RGBA in memory, and the receiver's decode limit). */
export const MAX_IMAGE_PIXELS = 30_000_000;

export type CaptureStep = 'prepare' | 'extract' | 'frames' | 'encode';
export interface CaptureProgress {
  step: CaptureStep;
  /** Frames taken / total, during `frames`. */
  frame?: number;
  frames?: number;
}

export type CaptureErrorCode = 'restricted' | 'empty' | 'script' | 'screenshot' | 'too-large' | 'invalid';
export class CaptureError extends Error {
  constructor(
    readonly code: CaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/** A drawable, decoded frame. */
export interface Frame {
  width: number;
  height: number;
  close?(): void;
}
/** The stitching surface. */
export interface Surface {
  drawImage(
    img: Frame,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  encode(): Promise<{ mime: 'image/png' | 'image/webp'; bytes: ArrayBuffer }>;
}

export interface CaptureDeps {
  api: Pick<ChromeApi, 'scripting' | 'tabs'>;
  decode(dataUrl: string): Promise<Frame>;
  surface(width: number, height: number): Surface;
  sleep(ms: number): Promise<void>;
  now(): Date;
}

export interface CaptureOutput {
  bundle: CaptureBundle;
  image: { mime: 'image/png' | 'image/webp'; bytes: ArrayBuffer };
  frames: number;
  hiddenFixed: number;
}

export { capturable };

async function run<A extends unknown[], R>(
  deps: CaptureDeps,
  tabId: number,
  func: (...args: A) => R,
  args: A,
): Promise<Awaited<R>> {
  let res: { result?: Awaited<R> }[];
  try {
    res = await deps.api.scripting.executeScript({ target: { tabId }, func, args });
  } catch (e) {
    throw new CaptureError('script', `this page can't be read by extensions (${(e as Error).message})`);
  }
  const r = res[0]?.result;
  if (r === undefined) throw new CaptureError('script', 'the page did not answer');
  return r;
}

/** The scroll positions (CSS px) of the frames that cover `[0, pageH)` with a `viewH` viewport. */
export function framePlan(pageH: number, viewH: number): number[] {
  if (pageH <= viewH) return [0];
  const ys: number[] = [];
  for (let y = 0; y < pageH - viewH; y += viewH) ys.push(y);
  ys.push(pageH - viewH);
  return ys;
}

export async function captureTab(
  deps: CaptureDeps,
  tab: Tab,
  onProgress: (p: CaptureProgress) => void = () => {},
): Promise<CaptureOutput> {
  const tabId = tab.id;
  if (tabId === undefined || !capturable(tab.url))
    throw new CaptureError('restricted', 'browsers don’t let extensions capture this kind of page');

  onProgress({ step: 'prepare' });
  const m: PageMetrics = await run(deps, tabId, pagePrepare, [
    { maxHeight: MAX_PAGE_HEIGHT_PX, stepDelayMs: 90 },
  ]);
  let hiddenFixed = 0;
  let frames = 0;
  try {
    onProgress({ step: 'extract' });
    const x: ExtractedPage = await run(deps, tabId, extractPage, [{ maxPageHeight: MAX_PAGE_HEIGHT_PX }]);
    const W = Math.round(x.page.width);
    const H = Math.round(Math.min(x.page.height, MAX_PAGE_HEIGHT_PX));
    if (W < 64 || H < 64) throw new CaptureError('empty', 'the page is empty or too small');

    const plan = framePlan(H, m.innerHeight);
    onProgress({ step: 'frames', frame: 0, frames: plan.length });
    let surface: Surface | null = null;
    let scale = 1;
    let frameScale = 1;
    let last = 0;
    for (const [k, want] of plan.entries()) {
      const y = await run(deps, tabId, pageScrollTo, [want]);
      const wait = FRAME_INTERVAL_MS - (Date.now() - last);
      if (k > 0 && wait > 0) await deps.sleep(wait);
      let url: string;
      try {
        url = await deps.api.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      } catch (e) {
        throw new CaptureError('screenshot', `the screenshot failed (${(e as Error).message})`);
      }
      last = Date.now();
      const img = await deps.decode(url);
      if (!surface) {
        // image px per CSS px of this display (devicePixelRatio × zoom), capped at CAPTURE_DPR and the pixel budget
        frameScale = img.width / m.innerWidth;
        scale = Math.min(frameScale, CAPTURE_DPR, Math.sqrt(MAX_IMAGE_PIXELS / (W * H)));
        scale = Math.max(0.25, Math.round(scale * 1000) / 1000);
        surface = deps.surface(Math.round(W * scale), Math.round(H * scale));
      }
      // this frame covers page y ∈ [y, y + innerHeight); draw the part inside the page width and height
      const hCss = Math.min(m.innerHeight, H - y);
      if (hCss > 0)
        surface.drawImage(
          img,
          0,
          0,
          W * frameScale,
          hCss * frameScale,
          0,
          y * scale,
          W * scale,
          hCss * scale,
        );
      img.close?.();
      frames++;
      onProgress({ step: 'frames', frame: frames, frames: plan.length });
      if (k === 0) hiddenFixed = await run(deps, tabId, pageHideFixed, []);
    }
    if (!surface) throw new CaptureError('screenshot', 'no frames were captured');

    onProgress({ step: 'encode' });
    const image = await surface.encode();
    const capturedAt = deps.now().toISOString();
    let url: string;
    try {
      url = normalizeUrl(m.url);
    } catch {
      throw new CaptureError('invalid', 'the page address is not a URL');
    }
    if (url.length > CAPTURE_LIMITS.url) throw new CaptureError('too-large', 'the page address is too long');
    const candidate: CaptureBundle = {
      schema: 'wwm.capture/1',
      captureId: await computeCaptureId(url, capturedAt),
      url,
      title: (x.title || m.title || '').slice(0, CAPTURE_LIMITS.title),
      capturedAt,
      viewport: x.viewport,
      page: { width: W, height: H },
      screenshot: {
        path: image.mime === 'image/webp' ? 'screenshot.webp' : 'screenshot.png',
        width: Math.round(W * scale),
        height: Math.round(H * scale),
        format: image.mime === 'image/webp' ? 'webp' : 'png',
        scale,
      },
      backgroundColor: x.backgroundColor,
      elements: x.elements,
    };
    let bundle: CaptureBundle;
    try {
      bundle = parseCapture(candidate);
    } catch (e) {
      throw new CaptureError(
        'invalid',
        `the capture didn't pass the checks (${(e as Error).message.slice(0, 200)})`,
      );
    }
    return { bundle, image, frames, hiddenFixed };
  } finally {
    await deps.api.scripting
      .executeScript({ target: { tabId }, func: pageRestore, args: [{ x: m.scrollX, y: m.scrollY }] })
      .catch(() => {});
  }
}

/** Real deps for the service worker: OffscreenCanvas stitching, WebP when the browser can encode it. */
export function workerDeps(api: CaptureDeps['api']): CaptureDeps {
  return {
    api,
    async decode(dataUrl) {
      const blob = await (await fetch(dataUrl)).blob();
      return createImageBitmap(blob);
    },
    surface(width, height) {
      const c = new OffscreenCanvas(width, height);
      const g = c.getContext('2d');
      if (!g) throw new CaptureError('screenshot', 'no 2D canvas in this browser');
      g.imageSmoothingQuality = 'high';
      return {
        drawImage: (img, sx, sy, sw, sh, dx, dy, dw, dh) =>
          g.drawImage(img as ImageBitmap, sx, sy, sw, sh, dx, dy, dw, dh),
        async encode() {
          let blob = await c.convertToBlob({ type: 'image/webp', quality: 0.92 });
          if (blob.type !== 'image/webp') blob = await c.convertToBlob({ type: 'image/png' });
          const mime = blob.type === 'image/webp' ? 'image/webp' : 'image/png';
          return { mime, bytes: await blob.arrayBuffer() };
        },
      };
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
  };
}
