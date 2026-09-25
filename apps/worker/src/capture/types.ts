/**
 * The `Capturer` seam. Implementations:
 * - `BrowserRunCapturer` (src/capture/browser-run.ts): Cloudflare Browser Run via `@cloudflare/playwright`.
 *   Also works in `wrangler dev`, which starts a local Chrome for the binding.
 * - `LocalChromiumCapturer` (node/local-chromium.ts): Node + Playwright Chromium, for tests and benchmarks.
 * - `HttpCapturer` (src/capture/http-capturer.ts): the Worker calls a Node sidecar that runs the local one.
 * All three share `capture/core.ts`, so SSRF enforcement and the capture sequence are identical.
 */
import type { CaptureBundle } from '@wwm/schema';

/** A slice texture cropped by the browser: exactly `stage.size × scale` (contracts §3). */
export interface SliceTexture {
  sliceIndex: number;
  /** Page-space slice origin and height (CSS px), as `sliceRange`. */
  y: number;
  height: number;
  /** Image px. */
  width: number;
  heightPx: number;
  /** Image px per CSS px (CAPTURE_DPR). */
  scale: number;
  contentType: 'image/webp';
  bytes: Uint8Array;
}

export interface CaptureOutput {
  /** `screenshot` describes `screenshotPng`: the 1× analysis image (see README "Why the builder sees 1×"). */
  bundle: CaptureBundle;
  screenshotPng: Uint8Array;
  textures: SliceTexture[];
  /** HTTP status of the main document. */
  status: number;
  timingsMs: Record<string, number>;
  requests: { allowed: number; blocked: number; blockedUrls: string[] };
}

export type CaptureStep = 'extracting';

export interface CaptureRequest {
  /** Already normalized and policy-checked top-level URL. */
  url: string;
  /** Absolute epoch ms: the capture must finish (or fail with CAPTURE_TIMEOUT) by then. */
  deadline: number;
  onStep?: (step: CaptureStep) => void;
  now?: () => Date;
}

export interface Capturer {
  readonly name: string;
  capture(req: CaptureRequest): Promise<CaptureOutput>;
}
