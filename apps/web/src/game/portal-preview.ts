/**
 * Portal windows (N; plans/portal-windows-execution.md): pictures of each portal's destination for the engine's
 * tear windows. One source so far, the offline fixtures: a portal whose target is a bundled capture shows that
 * page's top square. Every other link portal shows the postcard (host colour and monogram) until M3 adds pictures
 * of sites already built on the service.
 *
 * Behind `VITE_PORTAL_WINDOWS_ENABLED`, which needs an explicit `'true'` even in development (like tilt).
 */
import type { StageData } from '@wwm/schema';
import { isLearningHref } from '../learning/href.ts';
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
}

/**
 * The pictures for one loaded stage at a time. `start` aborts the previous stage's work, so a late picture never
 * lands on another stage; `show` is also gated by `current()` (the title's attract stage reuses the engine without
 * changing the played stage). Pip gates are never touched: they keep the Phase 13 gate look.
 */
export class PortalPreviews {
  readonly #sources: PreviewSources;
  #ac: AbortController | null = null;
  #states = new Map<number, PreviewState>();

  constructor(sources: PreviewSources = { fixture: fixturePicture }) {
    this.#sources = sources;
  }

  start(stage: StageData, show: PreviewShow, current: () => boolean = () => true): void {
    this.stop();
    const ac = new AbortController();
    this.#ac = ac;
    const fixtures = new Map(previewablePortals(stage).map((p) => [p.id, p.entry]));
    for (const p of stage.portals ?? []) {
      if (isLearningHref(p.href)) continue;
      const entry = fixtures.get(p.id);
      show(p.id, 'postcard');
      if (!entry) {
        this.#states.set(p.id, 'postcard');
        continue;
      }
      this.#states.set(p.id, 'looking-up');
      void this.#sources.fixture(entry).then(
        (img) => {
          if (ac.signal.aborted) return;
          this.#states.set(p.id, img ? 'ready' : 'postcard');
          if (img && current()) show(p.id, img);
        },
        () => {
          if (!ac.signal.aborted) this.#states.set(p.id, 'postcard');
        },
      );
    }
  }

  /** Leave the stage: pending pictures are dropped. Cached pictures stay for the next load. */
  stop(): void {
    this.#ac?.abort();
    this.#ac = null;
    this.#states.clear();
  }

  /** e2e / debug: each link portal's state. */
  states(): Record<number, PreviewState> {
    return Object.fromEntries(this.#states);
  }
}
