/**
 * Tiny RGBA raster for thumbnails (no canvas dependency): alpha-blended fills, thick lines, circles.
 * Coordinates are image pixels (floats).
 */
export type RGBA = [number, number, number, number];

export class Raster {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  blend(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const a = c[3] / 255;
    const d = this.data;
    d[i] = Math.round((d[i] as number) * (1 - a) + c[0] * a);
    d[i + 1] = Math.round((d[i + 1] as number) * (1 - a) + c[1] * a);
    d[i + 2] = Math.round((d[i + 2] as number) * (1 - a) + c[2] * a);
    d[i + 3] = 255;
  }

  fill(c: RGBA): void {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) this.blend(x, y, c);
  }

  disc(cx: number, cy: number, r: number, c: RGBA): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.blend(x, y, c);
  }

  ring(cx: number, cy: number, r: number, w: number, c: RGBA): void {
    for (let y = Math.floor(cy - r - w); y <= Math.ceil(cy + r + w); y++)
      for (let x = Math.floor(cx - r - w); x <= Math.ceil(cx + r + w); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (Math.abs(d - r) <= w / 2) this.blend(x, y, c);
      }
  }

  /** Thick line (square-ish caps), each pixel blended once. */
  line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGBA): void {
    const minX = Math.floor(Math.min(x0, x1) - w);
    const maxX = Math.ceil(Math.max(x0, x1) + w);
    const minY = Math.floor(Math.min(y0, y1) - w);
    const maxY = Math.ceil(Math.max(y0, y1) + w);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy || 1e-9;
    const h = w / 2;
    for (let y = Math.max(0, minY); y <= Math.min(this.height - 1, maxY); y++)
      for (let x = Math.max(0, minX); x <= Math.min(this.width - 1, maxX); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
        if (Math.hypot(x0 + dx * t - px, y0 + dy * t - py) <= h) this.blend(x, y, c);
      }
  }

  polyline(pts: readonly (readonly [number, number])[], w: number, c: RGBA, closed = false): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as readonly [number, number];
      const b = pts[i + 1] as readonly [number, number];
      this.line(a[0], a[1], b[0], b[1], w, c);
    }
    if (closed && pts.length > 2) {
      const a = pts[pts.length - 1] as readonly [number, number];
      const b = pts[0] as readonly [number, number];
      this.line(a[0], a[1], b[0], b[1], w, c);
    }
  }

  cross(cx: number, cy: number, r: number, w: number, c: RGBA): void {
    this.line(cx - r, cy - r, cx + r, cy + r, w, c);
    this.line(cx - r, cy + r, cx + r, cy - r, w, c);
  }
}
