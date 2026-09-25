/** sRGB → CIE Lab through a 15-bit lookup table (5 bits per channel), and small color helpers. */

const LUT_BITS = 5;
const LUT_SIZE = 1 << (3 * LUT_BITS);
let labLut: Float32Array | null = null;

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Exact sRGB (0–255) → Lab (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab LUT indexed by `lutIndex(r, g, b)`; built once per process (deterministic). */
export function getLabLut(): Float32Array {
  if (labLut) return labLut;
  const lut = new Float32Array(LUT_SIZE * 3);
  const step = 256 / (1 << LUT_BITS);
  for (let i = 0; i < LUT_SIZE; i++) {
    const r = (i >> (2 * LUT_BITS)) & 31;
    const g = (i >> LUT_BITS) & 31;
    const b = i & 31;
    const lab = rgbToLab((r + 0.5) * step, (g + 0.5) * step, (b + 0.5) * step);
    lut[i * 3] = lab[0];
    lut[i * 3 + 1] = lab[1];
    lut[i * 3 + 2] = lab[2];
  }
  labLut = lut;
  return lut;
}

export function lutIndex(r: number, g: number, b: number): number {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

/** Parse "#rrggbb" / "#rgb" / "rgb(r, g, b)". Returns null for anything else (or transparent). */
export function parseColor(s: string | undefined): [number, number, number] | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) {
    const n = Number.parseInt(m[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) {
    const h = m[1] as string;
    return [0, 1, 2].map((i) => Number.parseInt(h[i] as string, 16) * 17) as [number, number, number];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(t);
  if (m) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number.parseFloat(m[4]);
      if (a < 0.5) return null;
    }
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}
