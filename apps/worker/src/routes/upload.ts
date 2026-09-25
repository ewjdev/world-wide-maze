/**
 * Phase 14 (contracts §10.2): `POST /api/stages/upload` shares a capture that was made in the player's own
 * browser, by the "Maze this page" extension or the bookmarklet.
 *
 * The request is multipart:
 * - `bundle`: the `CaptureBundle` JSON.
 * - `image`: the analysis screenshot as a PNG, exactly `bundle.screenshot` in size.
 * - `texture0 … textureN-1` (optional, all or none): one WebP or PNG texture per stage slice, at scale 1–2.
 *   Without them the Worker crops each slice out of `image` and stores it as a PNG at the image's scale.
 *
 * The capture then goes through the same pipeline as a hosted capture, minus the browser: moderation hook,
 * builder, `validateStage`, the solver hook with seed reroll, and storage. The same limits apply too: the
 * kill switch, the per-IP build limit and the global build cap. The response is `200 {runId, stageIds}` once
 * every slice is stored.
 *
 * Uploaded runs are unlisted: they're reachable by id only and never cached by URL. The server derives the
 * `captureId` from the uploaded bytes, so an upload can never overwrite another run's stages or textures.
 */
import {
  type CaptureBundle,
  CONTRACT_VERSION,
  type CreateStageResponse,
  type JobEvent,
  MAX_PAGE_HEIGHT_PX,
  parseCapture,
  SchemaError,
  sha256Hex,
  sliceCount,
  sliceRange,
} from '@wwm/schema';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env.ts';
import type { StageBuilder } from '../builder.ts';
import type { CaptureOutput, Capturer, SliceTexture } from '../capture/types.ts';
import { errorResponse, ServiceError } from '../errors.ts';
import { defaultSeed } from '../ids.ts';
import { decodePng, readPngHeader } from '../image/png.ts';
import { webpSize } from '../image/webp.ts';
import { type PipelineDeps, runBuildJob, type StageStore } from '../pipeline.ts';
import { BodyTooLargeError, tooLarge } from '../security.ts';
import { encodePngRows } from './upload-png.ts';

/** Upload limits. These add to the v0.2.7 `CaptureBundle` limits that `parseCapture` enforces. */
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

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];
const isPng = (b: Uint8Array) => PNG_SIG.every((v, i) => b[i] === v);

class BadUpload extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const bad = (e: BadUpload) =>
  Response.json(
    { error: e.status === 415 ? 'unsupported media type' : 'bad request', message: e.message },
    { status: e.status, headers: { 'cache-control': 'no-store' } },
  );

/** Read the body with a hard cap (whatever `content-length` claims) and parse it as multipart. */
async function readForm(req: Request): Promise<FormData> {
  const ct = req.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;\s*boundary=/i.test(ct)) throw new BadUpload(`expected multipart/form-data, got ${ct || 'no content-type'}`, 415);
  const declared = Number(req.headers.get('content-length') ?? Number.NaN);
  const max = UPLOAD_LIMITS.bodyBytes;
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLargeError(max);
  if (!req.body) throw new BadUpload('empty body');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(max);
    }
    chunks.push(value);
  }
  const body = new Blob(chunks as BlobPart[]);
  try {
    return await new Response(body, { headers: { 'content-type': ct } }).formData();
  } catch {
    throw new BadUpload('malformed multipart body');
  }
}

async function partBytes(form: FormData, name: string, max: number): Promise<Uint8Array | null> {
  const v = form.get(name);
  if (v === null) return null;
  if (typeof v === 'string') {
    const b = new TextEncoder().encode(v);
    if (b.byteLength > max) throw new BadUpload(`${name} is larger than ${max} bytes`);
    return b;
  }
  if (v.size > max) throw new BadUpload(`${name} is larger than ${max} bytes`);
  return new Uint8Array(await v.arrayBuffer());
}

/** Within one pixel of the expected size (rounding at scale ≠ 1). */
const near = (a: number, b: number) => Math.abs(a - b) <= 1;

export interface ValidUpload {
  bundle: CaptureBundle;
  png: Uint8Array;
  /** One per slice, or empty (the Worker crops them). */
  textures: SliceTexture[];
}

/** Validate a parsed multipart upload. Throws `BadUpload` (400/415) with a message the player can read. */
export async function validateUpload(form: FormData): Promise<ValidUpload> {
  const known = /^(bundle|image|texture\d{1,2})$/;
  for (const k of new Set(form.keys())) if (!known.test(k)) throw new BadUpload(`unexpected field "${k}"`);

  const bundleBytes = await partBytes(form, 'bundle', UPLOAD_LIMITS.bundleBytes);
  if (!bundleBytes) throw new BadUpload('missing "bundle"');
  let bundle: CaptureBundle;
  try {
    bundle = parseCapture(JSON.parse(new TextDecoder().decode(bundleBytes)));
  } catch (e) {
    if (e instanceof SchemaError) throw new BadUpload(`invalid capture: ${e.message.slice(0, 300)}`);
    throw new BadUpload('"bundle" is not JSON');
  }
  let url: URL;
  try {
    url = new URL(bundle.url);
  } catch {
    throw new BadUpload('capture url is not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new BadUpload('only http(s) pages can be shared');
  if (bundle.page.width > UPLOAD_LIMITS.pageWidth)
    throw new BadUpload(`page wider than ${UPLOAD_LIMITS.pageWidth} px`);
  if (bundle.page.height > MAX_PAGE_HEIGHT_PX)
    throw new BadUpload(`page taller than ${MAX_PAGE_HEIGHT_PX} px`);

  const png = await partBytes(form, 'image', UPLOAD_LIMITS.imageBytes);
  if (!png) throw new BadUpload('missing "image"');
  if (!isPng(png)) throw new BadUpload('"image" must be a PNG', 415);
  let head: ReturnType<typeof readPngHeader>;
  try {
    head = readPngHeader(png);
  } catch (e) {
    throw new BadUpload(`"image": ${(e as Error).message}`, 415);
  }
  if (head.width * head.height > UPLOAD_LIMITS.imagePixels)
    throw new BadUpload(`"image" is larger than ${UPLOAD_LIMITS.imagePixels} pixels`);
  const shot = bundle.screenshot;
  if (head.width !== shot.width || head.height !== shot.height)
    throw new BadUpload(
      `"image" is ${head.width}×${head.height}, the bundle says ${shot.width}×${shot.height}`,
    );
  if (!near(shot.width, bundle.page.width * shot.scale) || !near(shot.height, bundle.page.height * shot.scale))
    throw new BadUpload('screenshot size does not match page size × scale');

  const count = sliceCount(bundle);
  const texKeys = [...new Set(form.keys())].filter((k) => k.startsWith('texture'));
  const textures: SliceTexture[] = [];
  if (texKeys.length > 0) {
    if (texKeys.length !== count) throw new BadUpload(`expected ${count} textures, got ${texKeys.length}`);
    for (let i = 0; i < count; i++) {
      const bytes = await partBytes(form, `texture${i}`, UPLOAD_LIMITS.textureBytes);
      if (!bytes) throw new BadUpload(`missing "texture${i}"`);
      const webp = webpSize(bytes);
      let size = webp;
      if (!size && isPng(bytes)) {
        try {
          size = readPngHeader(bytes);
        } catch {
          size = null;
        }
      }
      if (!size) throw new BadUpload(`"texture${i}" must be WebP or PNG`, 415);
      const r = sliceRange(bundle, i);
      const scale = size.width / bundle.page.width;
      if (!(scale >= 0.99 && scale <= UPLOAD_LIMITS.textureScaleMax + 0.01))
        throw new BadUpload(`"texture${i}" scale ${scale.toFixed(2)} is outside 1–2`);
      if (!near(size.height, r.height * scale))
        throw new BadUpload(`"texture${i}" is ${size.width}×${size.height}, expected height ${r.height * scale}`);
      textures.push({
        sliceIndex: i,
        y: r.y,
        height: r.height,
        width: size.width,
        heightPx: size.height,
        scale,
        // The stored object carries its real type; `SliceTexture` only names WebP (see the Phase 14 CCR).
        contentType: (webp ? 'image/webp' : 'image/png') as 'image/webp',
        bytes,
      });
    }
  }
  return { bundle, png, textures };
}

/** A `Capturer` that "captures" what the player uploaded, so the build pipeline runs unchanged. */
export function uploadCapturer(up: ValidUpload): Capturer {
  return {
    name: 'upload',
    async capture(): Promise<CaptureOutput> {
      const t0 = Date.now();
      let textures = up.textures;
      if (textures.length === 0) {
        // No client textures: crop each slice out of the analysis image (PNG at the image's scale).
        const image = await decodePng(up.png, { maxPixels: UPLOAD_LIMITS.imagePixels });
        const scale = up.bundle.screenshot.scale;
        textures = [];
        for (let i = 0; i < sliceCount(up.bundle); i++) {
          const r = sliceRange(up.bundle, i);
          const y0 = Math.min(image.height - 1, Math.round(r.y * scale));
          const h = Math.max(1, Math.min(image.height - y0, Math.round(r.height * scale)));
          textures.push({
            sliceIndex: i,
            y: r.y,
            height: r.height,
            width: image.width,
            heightPx: h,
            scale,
            contentType: 'image/png' as 'image/webp',
            bytes: await encodePngRows(image, y0, h),
          });
        }
      }
      return {
        bundle: up.bundle,
        screenshotPng: up.png,
        textures,
        status: 200,
        timingsMs: { upload: Date.now() - t0 },
        requests: { allowed: 0, blocked: 0, blockedUrls: [] },
      };
    },
  };
}

/** Tag every stage built from an upload (`provenance.notes`, contracts §10.2). */
export function localCaptureBuilder(inner: StageBuilder): StageBuilder {
  return {
    version: inner.version,
    buildStage(input) {
      const r = inner.buildStage(input);
      const notes = r.stage.provenance.notes.includes(LOCAL_CAPTURE_NOTE)
        ? r.stage.provenance.notes
        : [...r.stage.provenance.notes, LOCAL_CAPTURE_NOTE];
      return { ...r, stage: { ...r.stage, provenance: { ...r.stage.provenance, notes } } };
    },
  };
}

/** Storage for uploads: like a hosted capture, but never cached by URL (uploads are unlisted). */
function unlistedStore(s: StageStore): StageStore {
  return {
    putCapture: (b, p) => s.putCapture(b, p),
    putTexture: (c, t) => s.putTexture(c, t),
    putRun: (r) => s.putRun(r),
    putStage: (st, m) => s.putStage(st, m),
    finishRun: (r, i) => s.finishRun(r, i),
    cacheRun: async () => {},
    clearInflightJob: async () => {},
  };
}

/** The server-side capture id: content-derived, so it can't collide with (or overwrite) another run. */
async function uploadCaptureId(bundle: CaptureBundle, png: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', png as Uint8Array<ArrayBuffer>);
  const imageHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sha256Hex(`upload|${CONTRACT_VERSION.split('.')[0]}|${bundle.url}|${bundle.capturedAt}|${imageHash}`);
}

export const uploadRoutes = new Hono<AppEnv>();

uploadRoutes.post('/upload', async (c) => {
  const t0 = Date.now();
  const services = c.get('services');
  const { settings, log, pipeline } = services;

  // Same kill switch as POST /api/stages: while new builds are paused, local captures still play locally.
  if (c.env.CAPTURE_ENABLED === '0' || (await c.env.CACHE.get('kill:capture')) !== null)
    return errorResponse(
      new ServiceError('RATE_LIMITED', 'sharing new mazes is paused right now; your maze still plays here', 3600),
    );

  let up: ValidUpload;
  try {
    up = await validateUpload(await readForm(c.req.raw));
  } catch (e) {
    if (e instanceof BodyTooLargeError) return tooLarge(e);
    if (e instanceof BadUpload) {
      log.info('upload rejected', { reason: e.message });
      return bad(e);
    }
    throw e;
  }

  const host = new URL(up.bundle.url).hostname;
  if (services.policy.isOptedOut && (await services.policy.isOptedOut(host)))
    return errorResponse(new ServiceError('URL_FORBIDDEN', 'this site has opted out of World Wide Maze'));

  const limiter = c.env.LIMITER.get(c.env.LIMITER.idFromName(`build:${c.get('ip')}`));
  const rl = await limiter.hit(settings.buildLimitPerHour, 3600_000);
  if (!rl.ok)
    return errorResponse(
      new ServiceError(
        'RATE_LIMITED',
        `at most ${settings.buildLimitPerHour} new builds per hour`,
        rl.retryAfterSec,
      ),
    );
  const global = c.env.LIMITER.get(c.env.LIMITER.idFromName('build:global'));
  const grl = await global.hit(settings.globalBuildLimitPerHour, 3600_000);
  if (!grl.ok)
    return errorResponse(
      new ServiceError('RATE_LIMITED', 'the maze factory is busy; try again later', grl.retryAfterSec),
    );

  const captureId = await uploadCaptureId(up.bundle, up.png);
  const bundle: CaptureBundle = {
    ...up.bundle,
    captureId,
    screenshot: { ...up.bundle.screenshot, path: 'screenshot.png', format: 'png' },
  };
  const jobId = crypto.randomUUID();
  const deps: PipelineDeps = {
    capturer: uploadCapturer({ ...up, bundle }),
    builder: localCaptureBuilder(pipeline.builder),
    moderate: pipeline.moderate,
    ...(pipeline.validatePlayable ? { validatePlayable: pipeline.validatePlayable } : {}),
    store: unlistedStore(pipeline.store),
    log,
    // No browser: the whole budget is building (with solver rerolls) on the uploaded image.
    slice0BudgetMs: Math.max(settings.slice0BudgetMs, 60_000),
  };
  let failure: Extract<JobEvent, { type: 'error' }> | null = null;
  const result = await runBuildJob(
    {
      jobId,
      url: bundle.url,
      difficulty: 'normal',
      seed: defaultSeed(bundle.url),
      cacheKey: `upload:${captureId}`,
    },
    deps,
    (e) => {
      if (e.type === 'error') failure = e;
    },
  );
  if (!result) {
    const f = failure as Extract<JobEvent, { type: 'error' }> | null;
    return errorResponse(new ServiceError(f?.code ?? 'BUILD_FAILED', f?.message ?? 'build failed'));
  }
  log.info('upload built', {
    runId: result.runId,
    stages: result.stageIds.length,
    elements: bundle.elements.length,
    ms: Date.now() - t0,
  });
  return c.json<CreateStageResponse>(
    { runId: result.runId, stageIds: result.stageIds },
    200,
    { 'cache-control': 'no-store' },
  );
});
