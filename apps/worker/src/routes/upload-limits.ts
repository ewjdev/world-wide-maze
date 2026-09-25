/**
 * Phase 14 `POST /api/stages/upload` limits. They add to the v0.2.7 `CaptureBundle` limits that
 * `parseCapture` enforces. Kept free of Worker types so Node tests can import them.
 */
export const UPLOAD_LIMITS = {
  /** The whole multipart body. */
  bodyBytes: 40 * 1024 * 1024,
  /** The `bundle` JSON part. */
  bundleBytes: 8 * 1024 * 1024,
  /** The `image` PNG part. */
  imageBytes: 16 * 1024 * 1024,
  /**
   * Analysis image pixels. The Worker decodes it to RGBA (4 B/px), sometimes twice, under a 128 MB isolate.
   * 8 MP is a 1280 × 6000 page at scale 1 with room to spare.
   */
  imagePixels: 8_000_000,
  /** Largest `page.width`, in CSS px. */
  pageWidth: 2560,
  /** One `texture<i>` part. */
  textureBytes: 12 * 1024 * 1024,
  /** Slice textures are at scale 1 to 2 (CAPTURE_DPR). */
  textureScaleMax: 2,
} as const;

/** `provenance.notes` tag for stages built from a local capture (contracts §10.2). */
export const LOCAL_CAPTURE_NOTE = 'local-capture';
