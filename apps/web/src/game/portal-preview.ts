/**
 * Portal windows (N; plans/portal-windows-execution.md): pictures of each portal's destination for the engine's
 * tear windows. M0 has one source, the offline fixtures: a portal whose target is a bundled capture shows that
 * page's top square. Every other portal keeps the Phase 13 vortex.
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
async function decodeTop(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  const res = await fetch(url, { signal });
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

function fixturePicture(entry: CatalogEntry): Promise<ImageBitmap | null> {
  let p = cache.get(entry.slug);
  if (!p) {
    const ac = new AbortController();
    p = fixtureScreenshotUrl(entry)
      .then((url) => (url ? decodeTop(url, ac.signal) : null))
      .catch(() => null);
    // a failure isn't cached, so the next stage load can try again
    void p.then((b) => {
      if (!b) cache.delete(entry.slug);
    });
    cache.set(entry.slug, p);
  }
  return p;
}

/** The link portals that can show a picture now (M0: those whose target is a bundled fixture). */
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
 * Give every previewable portal of `stage` its picture. `show` is called only while `current()` is still true,
 * so a picture that arrives after the stage changed is dropped. The engine copies the picture into its atlas and
 * keeps no reference; the cached bitmap stays here for the next load of the same fixture.
 */
export function loadPortalPreviews(
  stage: StageData,
  show: (portalId: number, image: ImageBitmap) => void,
  current: () => boolean,
): void {
  for (const { id, entry } of previewablePortals(stage))
    void fixturePicture(entry).then((img) => {
      if (img && current()) show(id, img);
    });
}
