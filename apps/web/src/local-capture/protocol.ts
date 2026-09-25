/**
 * Phase 14 (contracts §10.2): the `/play/local` handoff protocol, shared by the receiver page, the bookmarklet
 * and (as plain strings) the extension.
 *
 * The capture sender (the extension's content script in this same tab, or the bookmarklet's page as
 * `window.opener`) waits for `wwm:ready`, then posts one `wwm:capture`. The receiver answers `wwm:ack` or
 * `wwm:reject {reason}`. Everything else is ignored.
 *
 * Who is trusted (`isTrustedSource`):
 * - `event.source === window` and `event.origin === location.origin`: a content script in this page (the
 *   extension). Page scripts share that origin, and they're ours.
 * - `event.source === window.opener`: the bookmarklet's tab, from whatever origin it runs on.
 * Messages from any other window (frames, other tabs, other origins) are dropped before they are read.
 */
import {
  type CaptureBundle,
  computeCaptureId,
  type LocalCaptureMessage,
  MAX_PAGE_HEIGHT_PX,
  parseCapture,
  SchemaError,
} from '@wwm/schema';

export const MSG = {
  capture: 'wwm:capture',
  ready: 'wwm:ready',
  ack: 'wwm:ack',
  reject: 'wwm:reject',
} as const;

/** Receiver-side limits on top of the v0.2.7 `CaptureBundle` limits (`parseCapture`). */
export const LOCAL_LIMITS = {
  /** Encoded screenshot bytes. A 2× WebP of a 6000 px page is a few MB; PNG can be larger. */
  imageBytes: 64 * 1024 * 1024,
  /** Decoded screenshot pixels (RGBA in the builder worker: 4 B/px). 2560 × 12000 = 30.7 MP. */
  imagePixels: 32_000_000,
  /** `page.width` in CSS px (a 4K window at 100% zoom). */
  pageWidth: 3840,
  /** `screenshot.scale` (device px per CSS px, capped by the sender at CAPTURE_DPR). */
  maxScale: 3,
} as const;

/**
 * A validated handoff. `image` is null in sketch mode (the bookmarklet sends DOM only, see the Phase 14 CCR:
 * `LocalCaptureMessage.image` optional).
 */
export interface LocalCapture {
  bundle: CaptureBundle;
  image: { mime: 'image/png' | 'image/webp'; bytes: ArrayBuffer } | null;
  via: 'extension' | 'bookmarklet';
}

/** What a sender may post: the contract message, or the bookmarklet's DOM-only variant. */
export type IncomingCapture = Omit<LocalCaptureMessage, 'image'> & {
  image: LocalCaptureMessage['image'] | null;
};

export class LocalCaptureError extends Error {
  constructor(
    readonly reason: 'shape' | 'schema' | 'image' | 'too-large',
    message: string,
  ) {
    super(message);
    this.name = 'LocalCaptureError';
  }
}

/** The window the message came from is one we accept captures from (see the file comment). */
export function isTrustedSource(
  e: Pick<MessageEvent, 'source' | 'origin'>,
  self: { window: unknown; opener: unknown; origin: string },
): 'extension' | 'bookmarklet' | null {
  if (e.source !== null && e.source === self.window && e.origin === self.origin) return 'extension';
  if (self.opener != null && e.source === self.opener) return 'bookmarklet';
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Is this a `wwm:capture` message at all (before any validation)? */
export function isCaptureMessage(data: unknown): data is { type: 'wwm:capture' } {
  return isRecord(data) && data.type === MSG.capture;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 2;

/**
 * Validate a `wwm:capture` payload. The bundle goes through `parseCapture` (schema + size limits); the page
 * and screenshot sizes must agree. The capture id is recomputed here from the normalized URL and time (the
 * sender's is never trusted). Throws `LocalCaptureError`.
 */
export async function validateCaptureMessage(
  data: unknown,
  via: LocalCapture['via'],
  normalizeUrl: (u: string) => string,
): Promise<LocalCapture> {
  if (!isRecord(data) || data.type !== MSG.capture || data.version !== 1)
    throw new LocalCaptureError('shape', 'not a version 1 capture message');
  let bundle: CaptureBundle;
  try {
    bundle = parseCapture(data.bundle);
  } catch (e) {
    if (e instanceof SchemaError) throw new LocalCaptureError('schema', e.message.slice(0, 400));
    throw new LocalCaptureError('schema', String(e));
  }
  let url: string;
  try {
    url = normalizeUrl(bundle.url);
  } catch {
    throw new LocalCaptureError('schema', 'the capture url is not a URL');
  }
  if (!/^https?:/i.test(url)) throw new LocalCaptureError('schema', 'only http(s) pages can be mazed');
  if (bundle.page.width > LOCAL_LIMITS.pageWidth || bundle.page.height > MAX_PAGE_HEIGHT_PX)
    throw new LocalCaptureError('too-large', `page ${bundle.page.width}×${bundle.page.height} is too large`);
  if (bundle.page.width < 64 || bundle.page.height < 64)
    throw new LocalCaptureError('schema', 'the page is too small to build a maze');

  let image: LocalCapture['image'] = null;
  if (data.image != null) {
    const img = data.image;
    if (!isRecord(img) || (img.mime !== 'image/png' && img.mime !== 'image/webp'))
      throw new LocalCaptureError('image', 'the screenshot must be PNG or WebP');
    if (!(img.bytes instanceof ArrayBuffer))
      throw new LocalCaptureError('image', 'the screenshot has no bytes');
    if (img.bytes.byteLength > LOCAL_LIMITS.imageBytes)
      throw new LocalCaptureError('too-large', 'the screenshot is too large');
    const s = bundle.screenshot;
    if (s.scale > LOCAL_LIMITS.maxScale) throw new LocalCaptureError('image', `screenshot scale ${s.scale}`);
    if (s.width * s.height > LOCAL_LIMITS.imagePixels)
      throw new LocalCaptureError('too-large', 'the screenshot has too many pixels');
    if (!near(s.width, bundle.page.width * s.scale) || !near(s.height, bundle.page.height * s.scale))
      throw new LocalCaptureError('image', 'screenshot size does not match page size × scale');
    image = { mime: img.mime, bytes: img.bytes };
  } else if (via === 'extension') {
    throw new LocalCaptureError('image', 'the extension capture has no screenshot');
  }

  const captureId = await computeCaptureId(url, bundle.capturedAt);
  return { bundle: { ...bundle, url, captureId }, image, via };
}
