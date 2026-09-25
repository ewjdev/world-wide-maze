/**
 * Phase 14 sketch mode (N): the bookmarklet sends the DOM only, with no screenshot. This draws a stand-in
 * "screenshot" from the element list: every box in its own background colour, its text in a colour that reads
 * on that background, and images as hatched frames. The builder then treats it like a real screenshot, and the
 * same bitmap textures the islands.
 */
import type { CaptureBundle, DomElement, Rect } from '@wwm/schema';

/** Sketch textures are drawn at 2× so the text stays legible up close (CAPTURE_DPR). */
export const SKETCH_SCALE = 2;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink for text on `bg`: near-black on light surfaces, near-white on dark ones. */
export function inkOn(bg: string): string {
  return luminance(bg) > 0.22 ? '#1c2127' : '#f4f5f6';
}

/** A tone a little away from `bg`, for image frames and control outlines. */
export function toneOn(bg: string, amount = 0.16): string {
  const [r, g, b] = rgb(bg);
  const t = luminance(bg) > 0.22 ? 0 : 255;
  const mix = (c: number) => Math.round(c + (t - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

const contains = (a: Rect, x: number, y: number) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h;

/** The background an element sits on: its own, else the nearest painted box under its centre, else the page. */
function surfaceOf(el: DomElement, painted: DomElement[], page: string): string {
  if (el.bg) return el.bg;
  const cx = el.rect.x + el.rect.w / 2;
  const cy = el.rect.y + el.rect.h / 2;
  for (let i = painted.length - 1; i >= 0; i--) {
    const p = painted[i] as DomElement;
    if (p.bg && contains(p.rect, cx, cy)) return p.bg;
  }
  return page;
}

interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  scale(x: number, y: number): void;
}

/** Split `text` over the element's line boxes, word by word, so each line gets roughly what fits. */
function flow(g: Ctx2D, text: string, lines: Rect[]): { line: Rect; text: string }[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: { line: Rect; text: string }[] = [];
  let w = 0;
  for (const [i, line] of lines.entries()) {
    const last = i === lines.length - 1;
    let s = '';
    while (w < words.length) {
      const next = s ? `${s} ${words[w]}` : (words[w] as string);
      if (s && g.measureText(next).width > line.w * 1.02 && !last) break;
      s = next;
      w++;
    }
    if (s) out.push({ line, text: s });
    if (w >= words.length) break;
  }
  return out;
}

/** Paint the sketch of `bundle` into `g` (page CSS px; the caller scales). Exported for tests. */
export function paintSketch(g: Ctx2D, bundle: CaptureBundle): void {
  const W = bundle.page.width;
  const H = bundle.page.height;
  const page = bundle.backgroundColor;
  g.fillStyle = page;
  g.fillRect(0, 0, W, H);
  const els = [...bundle.elements]
    .filter((e) => e.rect.y < H && e.rect.y + e.rect.h > 0 && e.rect.w > 0 && e.rect.h > 0)
    .sort((a, b) => a.depth - b.depth || a.id - b.id);
  const painted: DomElement[] = [];
  for (const el of els) {
    const r = el.rect;
    const surface = surfaceOf(el, painted, page);
    if (el.kind === 'image' || el.kind === 'video' || el.kind === 'canvas') {
      // Hatched frame: reads as "picture here" and gives the builder a solid island.
      g.fillStyle = toneOn(surface, 0.22);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.save();
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.clip();
      g.strokeStyle = toneOn(surface, 0.34);
      g.lineWidth = 1.5;
      g.beginPath();
      for (let d = -r.h; d < r.w; d += 10) {
        g.moveTo(r.x + d, r.y + r.h);
        g.lineTo(r.x + d + r.h, r.y);
      }
      g.stroke();
      g.restore();
      painted.push({ ...el, bg: el.bg ?? undefined });
      continue;
    }
    if (el.bg) {
      g.fillStyle = el.bg;
      g.fillRect(r.x, r.y, r.w, r.h);
      painted.push(el);
    }
    if (el.kind === 'button' || el.kind === 'input') {
      g.strokeStyle = toneOn(surface, 0.45);
      g.lineWidth = 1.5;
      g.strokeRect(r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5);
    }
    if (!el.text) continue;
    const size = Math.max(9, Math.min(64, el.fontSize ?? 16));
    const bold = el.kind === 'heading' || el.kind === 'button' ? 700 : 450;
    g.font = `${bold} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textBaseline = 'middle';
    const ink = el.kind === 'link' ? (luminance(surface) > 0.22 ? '#1f5fa8' : '#9cc9f5') : inkOn(surface);
    g.fillStyle = ink;
    const lines = el.lines?.length
      ? el.lines
      : [
          {
            x: r.x + 2,
            y: r.y + Math.max(0, (r.h - size * 1.3) / 2),
            w: r.w - 4,
            h: Math.min(r.h, size * 1.3),
          },
        ];
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    for (const { line, text } of flow(g, el.text, lines)) {
      g.fillText(text, line.x, line.y + line.h / 2, Math.max(line.w, 8) * 1.05);
      if (el.kind === 'link') {
        g.fillRect(line.x, line.y + line.h - 1.5, Math.min(line.w, g.measureText(text).width), 1);
      }
    }
    g.restore();
  }
}

/** Render the sketch texture of a DOM-only capture at `SKETCH_SCALE`. */
export async function renderSketch(bundle: CaptureBundle): Promise<ImageBitmap> {
  const s = SKETCH_SCALE;
  const c = new OffscreenCanvas(Math.round(bundle.page.width * s), Math.round(bundle.page.height * s));
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  g.scale(s, s);
  paintSketch(g as unknown as Ctx2D, bundle);
  return c.transferToImageBitmap();
}

/** The bundle as it describes the sketch texture (sketch mode records the generated image). */
export function sketchBundle(bundle: CaptureBundle): CaptureBundle {
  const s = SKETCH_SCALE;
  return {
    ...bundle,
    screenshot: {
      path: 'sketch.png',
      width: Math.round(bundle.page.width * s),
      height: Math.round(bundle.page.height * s),
      format: 'png',
      scale: s,
    },
  };
}
