/**
 * Phase 14 Share: upload a local capture to `POST /api/stages/upload` (contracts §10.2) so it gets a link.
 * Only this uploads anything, and only when the player presses Share.
 *
 * The request carries a 1× analysis PNG (what the Worker decodes, ≤ 8 MP) and one WebP texture per slice at
 * up to 2×, so the shared maze looks as sharp as the local one.
 */
import { type ApiErrorCode, type CaptureBundle, isApiErrorCode, sliceCount, sliceRange } from '@wwm/schema';

/** Mirrors the Worker's `UPLOAD_LIMITS` (apps/worker/src/routes/upload.ts). */
export const SHARE_LIMITS = { imagePixels: 8_000_000, textureBytes: 12 * 1024 * 1024 } as const;

export class ShareError extends Error {
  constructor(
    readonly code: ApiErrorCode | 'NETWORK' | 'BAD_REQUEST',
    message: string,
  ) {
    super(message);
    this.name = 'ShareError';
  }
}

async function blobOf(
  source: ImageBitmap,
  crop: { sx: number; sy: number; sw: number; sh: number },
  size: { w: number; h: number },
  type: 'image/png' | 'image/webp',
): Promise<Blob> {
  const c = new OffscreenCanvas(size.w, size.h);
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.w, size.h);
  return c.convertToBlob(type === 'image/webp' ? { type, quality: 0.9 } : { type });
}

/** Build the multipart body: `bundle`, `image` and `texture0…n-1`. */
export async function buildUpload(bundle: CaptureBundle, source: ImageBitmap): Promise<FormData> {
  const W = bundle.page.width;
  const H = bundle.page.height;
  const sc = bundle.screenshot.scale;
  // analysis image: scale ≤ 1 and within the Worker's pixel budget
  const s1 = Math.min(1, Math.sqrt((SHARE_LIMITS.imagePixels * 0.98) / (W * H)));
  const size1 = { w: Math.round(W * s1), h: Math.round(H * s1) };
  const png = await blobOf(source, { sx: 0, sy: 0, sw: source.width, sh: source.height }, size1, 'image/png');
  // scale from the rounded width, so the Worker's size check (page × scale, ±1 px) holds
  const scale1 = s1 === 1 ? 1 : size1.w / W;
  const up: CaptureBundle = {
    ...bundle,
    screenshot: { path: 'screenshot.png', width: size1.w, height: size1.h, format: 'png', scale: scale1 },
  };

  const form = new FormData();
  form.append('bundle', JSON.stringify(up));
  form.append('image', png, 'screenshot.png');

  // slice textures at min(2, source scale), never below 1
  const ts = Math.max(1, Math.min(2, sc));
  const textures: Blob[] = [];
  for (let i = 0; i < sliceCount(bundle); i++) {
    const r = sliceRange(bundle, i);
    const sy = Math.round(r.y * sc);
    const sh = Math.min(source.height - sy, Math.round(r.height * sc));
    let b = await blobOf(
      source,
      { sx: 0, sy, sw: source.width, sh },
      { w: Math.round(W * ts), h: Math.round(r.height * ts) },
      'image/webp',
    );
    if (b.type !== 'image/webp')
      b = await blobOf(
        source,
        { sx: 0, sy, sw: source.width, sh },
        { w: Math.round(W * ts), h: Math.round(r.height * ts) },
        'image/png',
      );
    if (b.size > SHARE_LIMITS.textureBytes) return form; // too big: the Worker crops textures from `image`
    textures.push(b);
  }
  textures.forEach((b, i) => {
    form.append(`texture${i}`, b, `texture${i}.${b.type === 'image/webp' ? 'webp' : 'png'}`);
  });
  return form;
}

/** Upload and return the shared run. Throws `ShareError`. */
export async function shareCapture(
  bundle: CaptureBundle,
  source: ImageBitmap,
  opts: { origin?: string; fetch?: typeof fetch } = {},
): Promise<{ runId: string; stageIds: string[] }> {
  const body = await buildUpload(bundle, source);
  let r: Response;
  try {
    r = await (opts.fetch ?? fetch)(`${opts.origin ?? ''}/api/stages/upload`, { method: 'POST', body });
  } catch (e) {
    throw new ShareError('NETWORK', String(e));
  }
  let j: unknown = null;
  try {
    j = await r.json();
  } catch {
    // not JSON
  }
  const o = (j ?? {}) as { runId?: string; stageIds?: string[]; code?: string; message?: string };
  if (r.ok && o.runId && Array.isArray(o.stageIds) && o.stageIds.length > 0)
    return { runId: o.runId, stageIds: o.stageIds };
  if (o.code && isApiErrorCode(o.code)) throw new ShareError(o.code, o.message ?? o.code);
  if (r.status >= 400 && r.status < 500 && r.status !== 429)
    throw new ShareError('BAD_REQUEST', o.message ?? `HTTP ${r.status}`);
  throw new ShareError(r.status === 429 ? 'RATE_LIMITED' : 'NETWORK', o.message ?? `HTTP ${r.status}`);
}
