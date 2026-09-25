/**
 * Page → slice conversion of the capture's DOM elements (contracts §3/§4, G0 "Slices"): rects become
 * stage-local, elements straddling the slice boundary are clipped, and elements outside it are dropped with
 * `out-of-slice`. Fixed/sticky elements are dropped with `fixed` (they were captured once, as the header).
 */
import type { CaptureBundle, DomElement, DropReason, ElementKind, Rect, StageSlice } from '@wwm/schema';
import { parseColor } from './color.ts';

export interface SliceElement {
  id: number;
  kind: ElementKind;
  /** Stage-local rect, clipped to the stage. */
  rect: Rect;
  /** Stage-local line rects (clipped; empty lines removed). */
  lines: Rect[];
  bg: [number, number, number] | null;
  depth: number;
  z: number;
  fontSize: number | undefined;
}

export interface SliceElementsResult {
  elements: SliceElement[];
  dropped: { elementId: number; reason: DropReason }[];
}

function clip(r: Rect, dy: number, w: number, h: number): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y - dy);
  const x1 = Math.min(w, r.x + r.w);
  const y1 = Math.min(h, r.y - dy + r.h);
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function sliceElements(capture: CaptureBundle, slice: StageSlice, width: number): SliceElementsResult {
  const elements: SliceElement[] = [];
  const dropped: { elementId: number; reason: DropReason }[] = [];
  const pageW = capture.page.width;
  const pageH = capture.page.height;
  for (const e of capture.elements as DomElement[]) {
    const r = e.rect;
    if (!(r.w > 0 && r.h > 0)) {
      dropped.push({ elementId: e.id, reason: 'too-small' });
      continue;
    }
    if (r.x + r.w <= 0 || r.y + r.h <= 0 || r.x >= pageW || r.y >= pageH) {
      dropped.push({ elementId: e.id, reason: 'offscreen' });
      continue;
    }
    if (e.fixed) {
      dropped.push({ elementId: e.id, reason: 'fixed' });
      continue;
    }
    const rect = clip(r, slice.y, width, slice.height);
    if (!rect) {
      dropped.push({ elementId: e.id, reason: 'out-of-slice' });
      continue;
    }
    const lines: Rect[] = [];
    for (const l of e.lines ?? []) {
      if (!(l.w > 0 && l.h > 0)) continue;
      const c = clip(l, slice.y, width, slice.height);
      if (c) lines.push(c);
    }
    elements.push({
      id: e.id,
      kind: e.kind,
      rect,
      lines,
      bg: parseColor(e.bg),
      depth: e.depth,
      z: e.z,
      fontSize: e.fontSize,
    });
  }
  return { elements, dropped };
}
