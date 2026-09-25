/**
 * Link targets for captures made before contracts v0.3.0 (`DomElement.href`). A sidecar
 * (`fixtures/builder/links/<slug>.json`, written by capture-script's `scripts/resolve-fixture-links.ts`) maps
 * element ids to recovered targets; `applyLinkTargets` merges it into the capture so the builder can place
 * portals. Pure: no I/O. Only `link`/`button` elements without an `href` are filled, and only when the sidecar
 * was made for this capture.
 */
import type { CaptureBundle } from '@wwm/schema';

export interface LinkTargets {
  captureId: string;
  hrefs: Record<string, string>;
}

export function applyLinkTargets(
  capture: CaptureBundle,
  sidecar: LinkTargets | null | undefined,
): CaptureBundle {
  if (!sidecar || sidecar.captureId !== capture.captureId) return capture;
  let changed = false;
  const elements = capture.elements.map((e) => {
    const href = sidecar.hrefs[String(e.id)];
    if (!href || e.href || (e.kind !== 'link' && e.kind !== 'button') || !/^https?:\/\//i.test(href))
      return e;
    if (href.length > 2048) return e;
    changed = true;
    return { ...e, href };
  });
  return changed ? { ...capture, elements } : capture;
}
