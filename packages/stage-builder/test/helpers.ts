import type { CaptureBundle, DomElement, ElementKind, Rect, RGBAImage } from '@wwm/schema';

export interface SynthBlock {
  rect: Rect;
  color?: [number, number, number];
  kind?: ElementKind;
  /** Element `bg` (for local-background tests). */
  bg?: string;
  lines?: Rect[];
  /** Paint the rect into the screenshot (default true). */
  paint?: boolean;
}

/** A capture whose screenshot is a flat background with solid colored blocks (page px × scale). */
export function synthCapture(
  width: number,
  height: number,
  blocks: SynthBlock[],
  opts: { bg?: [number, number, number]; scale?: number; id?: string } = {},
): { capture: CaptureBundle; image: RGBAImage } {
  const scale = opts.scale ?? 1;
  const bg = opts.bg ?? [255, 255, 255];
  const iw = Math.round(width * scale);
  const ih = Math.round(height * scale);
  const data = new Uint8ClampedArray(iw * ih * 4);
  for (let i = 0; i < iw * ih; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4);
  const elements: DomElement[] = [];
  blocks.forEach((b, id) => {
    if (b.paint !== false) {
      const c = b.color ?? [40, 40, 40];
      for (let y = Math.round(b.rect.y * scale); y < Math.round((b.rect.y + b.rect.h) * scale); y++)
        for (let x = Math.round(b.rect.x * scale); x < Math.round((b.rect.x + b.rect.w) * scale); x++)
          if (x >= 0 && y >= 0 && x < iw && y < ih) data.set([c[0], c[1], c[2], 255], (y * iw + x) * 4);
    }
    const el: DomElement = { id, kind: b.kind ?? 'block', rect: b.rect, depth: 3, z: 0, fixed: false };
    if (b.bg) el.bg = b.bg;
    if (b.lines) el.lines = b.lines;
    elements.push(el);
  });
  const hex = `#${bg.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const capture: CaptureBundle = {
    schema: 'wwm.capture/1',
    captureId: opts.id ?? 'synthetic',
    url: 'https://example.test/',
    title: 'Synthetic',
    capturedAt: '2026-09-25T00:00:00.000Z',
    viewport: { width, height: Math.min(height, 800) },
    page: { width, height },
    screenshot: { path: 'screenshot.png', width: iw, height: ih, format: 'png', scale },
    backgroundColor: hex,
    elements,
  };
  return { capture, image: { width: iw, height: ih, data } };
}

/** Binary mask from rows of '#'/'.' characters. */
export function maskFrom(rows: string[]): { mask: Uint8Array; cols: number; rows: number } {
  const cols = (rows[0] as string).length;
  const mask = new Uint8Array(cols * rows.length);
  rows.forEach((r, y) => {
    for (let x = 0; x < cols; x++) mask[y * cols + x] = r[x] === '#' ? 1 : 0;
  });
  return { mask, cols, rows: rows.length };
}

export function maskToRows(mask: ArrayLike<number>, cols: number, rows: number): string[] {
  const out: string[] = [];
  for (let y = 0; y < rows; y++) {
    let s = '';
    for (let x = 0; x < cols; x++) s += mask[y * cols + x] ? '#' : '.';
    out.push(s);
  }
  return out;
}
