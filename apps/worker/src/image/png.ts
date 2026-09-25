/**
 * Minimal streaming PNG decoder for Chromium screenshots → `RGBAImage` (contracts §4 `BuildInput.image`).
 *
 * Why not a WASM codec: Workers have a native zlib inflater (`DecompressionStream('deflate')`), and the
 * screenshots we decode always come from Chromium (8-bit, non-interlaced, RGB or RGBA). Inflating in a
 * stream and un-filtering row by row straight into the output keeps peak memory ≈ one RGBA image
 * (1280×6000×4 ≈ 31 MB) instead of two, which matters under the 128 MB isolate limit.
 */
import type { RGBAImage } from '@wwm/schema';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

function u32(b: Uint8Array, o: number): number {
  return (
    (((b[o] as number) << 24) |
      ((b[o + 1] as number) << 16) |
      ((b[o + 2] as number) << 8) |
      (b[o + 3] as number)) >>>
    0
  );
}

export function readPngHeader(bytes: Uint8Array): PngHeader {
  if (bytes.byteLength < 33 || SIGNATURE.some((v, i) => bytes[i] !== v)) throw new Error('not a PNG');
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') throw new Error('PNG: missing IHDR');
  return {
    width: u32(bytes, 16),
    height: u32(bytes, 20),
    bitDepth: bytes[24] as number,
    colorType: bytes[25] as number,
    interlace: bytes[28] as number,
  };
}

/** Channels per pixel for the supported 8-bit colour types (0 gray, 2 RGB, 4 gray+alpha, 6 RGBA). */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export async function decodePng(bytes: Uint8Array, opts: { maxPixels?: number } = {}): Promise<RGBAImage> {
  const h = readPngHeader(bytes);
  const channels = CHANNELS[h.colorType];
  if (h.bitDepth !== 8 || channels === undefined || h.interlace !== 0)
    throw new Error(
      `PNG: unsupported format (depth ${h.bitDepth}, colour ${h.colorType}, interlace ${h.interlace})`,
    );
  const maxPixels = opts.maxPixels ?? 1280 * 2 * 6000 * 2;
  if (h.width * h.height > maxPixels) throw new Error(`PNG: ${h.width}×${h.height} exceeds ${maxPixels} px`);

  // Feed IDAT payloads (in order) into a zlib inflater.
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const feed = (async () => {
    let o = 8;
    while (o + 8 <= bytes.byteLength) {
      const len = u32(bytes, o);
      const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
      if (type === 'IDAT')
        await writer.write(new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset + o + 8, len));
      if (type === 'IEND') break;
      o += 12 + len;
    }
    await writer.close();
  })();

  const stride = h.width * channels;
  const out = new Uint8ClampedArray(h.width * h.height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  const row = new Uint8Array(stride + 1); // filter byte + scanline
  let rowFill = 0;
  let y = 0;

  const finishRow = () => {
    const filter = row[0] as number;
    const src = row.subarray(1);
    const bpp = channels;
    for (let i = 0; i < stride; i++) {
      const x = src[i] as number;
      const a = i >= bpp ? (cur[i - bpp] as number) : 0;
      const b = prev[i] as number;
      let v: number;
      switch (filter) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4: {
          const c = i >= bpp ? (prev[i - bpp] as number) : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`PNG: bad filter ${filter} on row ${y}`);
      }
      cur[i] = v & 0xff;
    }
    const base = y * h.width * 4;
    if (channels === 4) out.set(cur, base);
    else
      for (let x = 0, s = 0, d = base; x < h.width; x++, s += channels, d += 4) {
        if (channels === 3) {
          out[d] = cur[s] as number;
          out[d + 1] = cur[s + 1] as number;
          out[d + 2] = cur[s + 2] as number;
          out[d + 3] = 255;
        } else {
          const g = cur[s] as number;
          out[d] = g;
          out[d + 1] = g;
          out[d + 2] = g;
          out[d + 3] = channels === 2 ? (cur[s + 1] as number) : 255;
        }
      }
    const t = prev;
    prev = cur;
    cur = t;
    y++;
  };

  const reader = ds.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    let o = 0;
    while (o < value.byteLength && y < h.height) {
      const n = Math.min(row.length - rowFill, value.byteLength - o);
      row.set(value.subarray(o, o + n), rowFill);
      rowFill += n;
      o += n;
      if (rowFill === row.length) {
        finishRow();
        rowFill = 0;
      }
    }
  }
  await feed;
  if (y !== h.height) throw new Error(`PNG: truncated image data (${y}/${h.height} rows)`);
  return { width: h.width, height: h.height, data: out };
}
