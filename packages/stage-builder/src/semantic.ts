/**
 * Step 3: semantic fill from the DOM (2013: "fill each img rectangle solid"; improvement N: text lines too).
 *
 * - `image` / `video` / `canvas` / `button` / `input` rects are filled solid.
 * - `text` / `heading` / `link` line rects are padded (0.5 × line height sideways, 0.2 × vertically) so glyphs
 *   clump into blocks; lines of one paragraph touch, separate paragraphs / list rows keep a small gap.
 * - A rect is only filled if some of it is visibly foreground in the pixel mask (skips lazy-loaded or hidden media).
 * - Containers (`block`, `nav`, `header`, `footer`) and `adlike` contribute pixels only.
 */
import type { Rect } from '@wwm/schema';
import { type Grid, rectToCells } from './grid.ts';
import type { BuildParams } from './params.ts';
import type { SliceElement } from './slice-elements.ts';

export interface SemanticResult {
  mask: Uint8Array;
  /** Element ids that painted into the semantic mask. */
  filledElementIds: number[];
}

const SOLID_KINDS = new Set(['image', 'video', 'canvas', 'button', 'input']);
const TEXT_KINDS = new Set(['text', 'heading', 'link']);

function visibleShare(grid: Grid, fg: Uint8Array, rect: Rect): number {
  const { c0, c1, r0, r1 } = rectToCells(grid, rect);
  let n = 0;
  let on = 0;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      n++;
      if (fg[r * grid.cols + c]) on++;
    }
  }
  return n === 0 ? 0 : on / n;
}

function paint(grid: Grid, mask: Uint8Array, rect: Rect): void {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(grid.width, rect.x + rect.w);
  const y1 = Math.min(grid.height, rect.y + rect.h);
  if (!(x1 > x0 && y1 > y0)) return;
  // A cell is painted when the rect covers at least half of it on each axis (keeps 1-cell gaps open).
  const { cell, cols } = grid;
  const c0 = Math.max(0, Math.round(x0 / cell));
  const c1 = Math.min(grid.cols, Math.round(x1 / cell));
  const r0 = Math.max(0, Math.round(y0 / cell));
  const r1 = Math.min(grid.rows, Math.round(y1 / cell));
  for (let r = r0; r < r1; r++) mask.fill(1, r * cols + c0, r * cols + c1);
}

export function semanticFill(
  grid: Grid,
  elements: readonly SliceElement[],
  backgroundMask: Uint8Array,
  params: BuildParams,
): SemanticResult {
  const n = grid.cols * grid.rows;
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = backgroundMask[i] ? 0 : 1;
  const mask = new Uint8Array(n);
  const filled: number[] = [];
  const minShare = params.semanticVisibleShare;

  for (const e of elements) {
    if (SOLID_KINDS.has(e.kind)) {
      if (e.rect.w < 2 || e.rect.h < 2) continue;
      if (visibleShare(grid, fg, e.rect) < minShare) continue;
      paint(grid, mask, e.rect);
      filled.push(e.id);
      continue;
    }
    if (!TEXT_KINDS.has(e.kind)) continue;
    let lines = e.lines;
    if (lines.length === 0) {
      // Single-box text: only when it is line-sized (containers mislabeled as text would flood the page).
      const fs = e.fontSize ?? 16;
      if (e.rect.h > fs * 3) continue;
      lines = [e.rect];
    }
    let any = false;
    const shown: Rect[] = [];
    for (const l of lines) {
      if (visibleShare(grid, fg, l) < minShare) continue;
      const padX = params.textPadXPerLine * l.h;
      const padY = params.textPadYPerLine * l.h;
      paint(grid, mask, { x: l.x - padX, y: l.y - padY, w: l.w + 2 * padX, h: l.h + 2 * padY });
      shown.push(l);
      any = true;
    }
    // Lines of one element are one paragraph: join vertically adjacent lines over their shared x-range, so the
    // leading inside a paragraph never splits it while gaps *between* elements (paragraphs, list rows) survive.
    shown.sort((p, q) => p.y - q.y || p.x - q.x);
    for (let k = 0; k + 1 < shown.length; k++) {
      const p = shown[k] as Rect;
      const q = shown[k + 1] as Rect;
      const gap = q.y - (p.y + p.h);
      const x0 = Math.max(p.x, q.x);
      const x1 = Math.min(p.x + p.w, q.x + q.w);
      if (gap <= 0 || gap > params.paragraphJoinPerLine * Math.max(p.h, q.h) || x1 <= x0) continue;
      paint(grid, mask, { x: x0, y: p.y + p.h - 1, w: x1 - x0, h: gap + 2 });
    }
    if (any) filled.push(e.id);
  }
  return { mask, filledElementIds: filled };
}
