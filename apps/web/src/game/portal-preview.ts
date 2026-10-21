/**
 * Portal windows (N; plans/portal-windows-execution.md): pictures of each portal's destination for the engine's
 * tear windows. One source so far, the offline fixtures: a portal whose target is a bundled capture shows that
 * page's top square; and (M3) sites already built on the capture service, through `POST /api/portals/previews`.
 * Every other link portal shows the postcard (host colour and monogram).
 *
 * Behind `VITE_PORTAL_WINDOWS_ENABLED`, which needs an explicit `'true'` even in development (like tilt).
 */
import { type PortalPreviewsRequest, PortalPreviewsResponseSchema, type StageData } from '@wwm/schema';
import { isLearningHref } from '../learning/href.ts';
import { serviceFetch } from '../service-mode.ts';
import type { CatalogEntry } from './catalog.ts';
import { fixtureFor } from './journey.ts';
import { fixtureScreenshotUrl } from './stages.ts';

export function portalWindowsEnabled(env: { VITE_PORTAL_WINDOWS_ENABLED?: string }): boolean {
  return env.VITE_PORTAL_WINDOWS_ENABLED === 'true';
}
export const PORTAL_WINDOWS_ENABLED = portalWindowsEnabled({
  VITE_PORTAL_WINDOWS_ENABLED: import.meta.env.VITE_PORTAL_WINDOWS_ENABLED,
});

/** Picture size handed to the engine (its atlas cell is 320 px; a little extra keeps the downscale sharp). */
export const PREVIEW_PX = 384;

/** Width and height from a PNG's IHDR chunk, or null if `bytes` isn't a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** The top square of a page, centred: what a window shows (above the fold). */
export function topSquare(width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  const side = Math.min(width, height);
  return { sx: Math.round((width - side) / 2), sy: 0, sw: side, sh: side };
}

/**
 * Decode only the top square of a fixture screenshot, already downscaled. Fixture screenshots reach
 * 2560 × 12000 px, so decoding the whole page for a 384 px picture would waste tens of MB.
 */
async function decodeTop(url: string): Promise<ImageBitmap | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  const size = pngSize(new Uint8Array(await blob.slice(0, 24).arrayBuffer()));
  if (!size) return null;
  const { sx, sy, sw, sh } = topSquare(size.width, size.height);
  return createImageBitmap(blob, sx, sy, sw, sh, {
    resizeWidth: PREVIEW_PX,
    resizeHeight: PREVIEW_PX,
    resizeQuality: 'high',
  });
}

/** Decoded pictures by fixture slug. There are only a handful of fixtures, so this never needs evicting. */
const cache = new Map<string, Promise<ImageBitmap | null>>();

/** A fixture's picture, decoded once per session. A failure isn't cached, so a later stage load can try again. */
export function fixturePicture(entry: CatalogEntry): Promise<ImageBitmap | null> {
  let p = cache.get(entry.slug);
  if (!p) {
    p = fixtureScreenshotUrl(entry)
      .then((url) => (url ? decodeTop(url) : null))
      .catch(() => null);
    void p.then((b) => {
      if (!b) cache.delete(entry.slug);
    });
    cache.set(entry.slug, p);
  }
  return p;
}

/** The link portals that can show a picture now (M0–M2: those whose target is a bundled fixture). */
export function previewablePortals(stage: StageData): { id: number; entry: CatalogEntry }[] {
  const out: { id: number; entry: CatalogEntry }[] = [];
  for (const p of stage.portals ?? []) {
    if (isLearningHref(p.href)) continue;
    const entry = fixtureFor(p.href);
    if (entry) out.push({ id: p.id, entry });
  }
  return out;
}

/**
 * Per portal: `looking-up` while its picture is being fetched (the postcard shows meanwhile), then `ready` (the
 * picture shows) or `postcard` (none exists or it failed; no retry within the stage). Plan §6.2.
 */
export type PreviewState = 'looking-up' | 'ready' | 'postcard';

/** What the loader hands the engine for a portal (`Engine.setPortalPreview`). */
export type PreviewShow = (portalId: number, preview: ImageBitmap | 'postcard') => void;

export interface PreviewSources {
  fixture(entry: CatalogEntry): Promise<ImageBitmap | null>;
  /** The full-size picture the travel window grows (top-anchored). */
  fixtureUrl?(entry: CatalogEntry): Promise<string | null>;
  /** A built site's texture, downscaled for the atlas (the engine crops its top square). */
  decode?(blob: Blob): Promise<ImageBitmap | null>;
}

/**
 * The capture service's side (M3, contracts §10.6): which targets already have a servable run, and their slice-0
 * textures. Only consulted when `online()` says the service answers.
 */
export interface PreviewService {
  online(): Promise<boolean>;
  /** One batched `POST /api/portals/previews`: a stage id per href (same order), or null. */
  lookup(hrefs: string[], signal: AbortSignal): Promise<(string | null)[]>;
  texture(stageId: string, signal: AbortSignal): Promise<Blob | null>;
}

/** The real service, through `serviceFetch` (so a resting service never gets hammered). Any non-200: nothing. */
export function apiPreviewService(origin: string, online: () => Promise<boolean>): PreviewService {
  return {
    online,
    async lookup(hrefs, signal) {
      const res = await serviceFetch(`${origin}/api/portals/previews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls: hrefs } satisfies PortalPreviewsRequest),
        signal,
      });
      if (!res.ok) return hrefs.map(() => null);
      const body = PortalPreviewsResponseSchema.safeParse(await res.json());
      if (!body.success) return hrefs.map(() => null);
      return hrefs.map((_, i) => {
        const id = body.data.items[i]?.stageId;
        return typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) ? id : null;
      });
    },
    async texture(stageId, signal) {
      const res = await serviceFetch(`${origin}/api/stages/${stageId}/texture`, { signal });
      return res.ok ? res.blob() : null;
    },
  };
}

function decodeBlob(blob: Blob): Promise<ImageBitmap | null> {
  return createImageBitmap(blob, { resizeWidth: PREVIEW_PX, resizeQuality: 'high' }).catch(() => null);
}

/**
 * The pictures for one loaded stage at a time. `start` aborts the previous stage's work, so a late picture never
 * lands on another stage; `show` is also gated by `current()` (the title's attract stage reuses the engine without
 * changing the played stage). Pip gates are never touched: they keep the Phase 13 gate look.
 *
 * Sources: bundled fixtures (offline, no request), then (M3) sites already built on the service. A built site's
 * texture is kept as its compressed Blob for the stage: its `blob:` URL feeds the travel window, a retry of the
 * same stage reuses it without new requests, and every URL is revoked when the stage is left, except the one
 * `take()` handed to the travel (the game revokes that one when the window is done).
 */
export class PortalPreviews {
  readonly #sources: PreviewSources;
  #ac: AbortController | null = null;
  #states = new Map<number, PreviewState>();
  /** Full-resolution source per ready portal, for the travel window. */
  #urls = new Map<number, string>();
  /** Built-site textures of the current stage by href (null: none), reused by a retry of the same stage. */
  #memo: { stageId: string; blobs: Map<string, Blob | null> } | null = null;

  constructor(
    sources: PreviewSources = {
      fixture: fixturePicture,
      fixtureUrl: fixtureScreenshotUrl,
      decode: decodeBlob,
    },
  ) {
    this.#sources = sources;
  }

  start(
    stage: StageData,
    show: PreviewShow,
    current: () => boolean = () => true,
    service: PreviewService | null = null,
  ): void {
    this.stop();
    const ac = new AbortController();
    this.#ac = ac;
    if (this.#memo?.stageId !== stage.stageId) this.#memo = { stageId: stage.stageId, blobs: new Map() };
    const memo = this.#memo;
    const fixtures = new Map(previewablePortals(stage).map((p) => [p.id, p.entry]));
    const remote: { id: number; href: string }[] = [];
    for (const p of stage.portals ?? []) {
      if (isLearningHref(p.href)) continue;
      const entry = fixtures.get(p.id);
      show(p.id, 'postcard');
      if (!entry) {
        if (service) {
          this.#states.set(p.id, 'looking-up');
          remote.push({ id: p.id, href: p.href });
        } else this.#states.set(p.id, 'postcard');
        continue;
      }
      this.#states.set(p.id, 'looking-up');
      void this.#sources.fixture(entry).then(
        async (img) => {
          if (ac.signal.aborted) return;
          const url = img ? await this.#sources.fixtureUrl?.(entry).catch(() => null) : null;
          if (ac.signal.aborted) return;
          if (img && url) this.#urls.set(p.id, url);
          this.#states.set(p.id, img ? 'ready' : 'postcard');
          if (img && current()) show(p.id, img);
        },
        () => {
          if (!ac.signal.aborted) this.#states.set(p.id, 'postcard');
        },
      );
    }
    if (service && remote.length > 0)
      void this.#fromService(remote, service, memo.blobs, show, current, ac.signal).catch(() => {
        if (ac.signal.aborted) return;
        for (const r of remote)
          if (this.#states.get(r.id) === 'looking-up') this.#states.set(r.id, 'postcard');
      });
  }

  async #fromService(
    remote: { id: number; href: string }[],
    service: PreviewService,
    blobs: Map<string, Blob | null>,
    show: PreviewShow,
    current: () => boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const postcard = (id: number) => {
      if (!signal.aborted) this.#states.set(id, 'postcard');
    };
    const unknown = [...new Set(remote.map((r) => r.href))].filter((h) => !blobs.has(h));
    if (unknown.length > 0) {
      if (!(await service.online()) || signal.aborted) {
        for (const r of remote) if (!blobs.has(r.href)) postcard(r.id);
        if (unknown.length === remote.length) return;
      } else {
        const ids = await service.lookup(unknown, signal);
        await Promise.all(
          unknown.map(async (href, i) => {
            const id = ids[i];
            blobs.set(href, id ? await service.texture(id, signal).catch(() => null) : null);
          }),
        );
      }
    }
    await Promise.all(
      remote.map(async ({ id, href }) => {
        const blob = blobs.get(href) ?? null;
        const img = blob ? await (this.#sources.decode ?? decodeBlob)(blob) : null;
        if (signal.aborted) {
          img?.close();
          return;
        }
        if (!blob || !img) return postcard(id);
        this.#urls.set(id, URL.createObjectURL(blob));
        this.#states.set(id, 'ready');
        if (current()) show(id, img);
        img.close();
      }),
    );
  }

  /** Leave the stage: pending pictures are dropped and this stage's `blob:` URLs revoked (cached pictures stay). */
  stop(): void {
    this.#ac?.abort();
    this.#ac = null;
    this.#states.clear();
    for (const url of this.#urls.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    this.#urls.clear();
  }

  /** The full-resolution picture of portal `id` for the travel window, or null (the window shows the postcard). */
  source(id: number): string | null {
    return this.#urls.get(id) ?? null;
  }

  /**
   * Hand portal `id`'s picture to the travel: it is no longer revoked when the stage is left. A `blob:` URL is then
   * the caller's to revoke.
   */
  take(id: number): string | null {
    const url = this.#urls.get(id) ?? null;
    this.#urls.delete(id);
    return url;
  }

  /** e2e / debug: each link portal's state. */
  states(): Record<number, PreviewState> {
    return Object.fromEntries(this.#states);
  }
}
