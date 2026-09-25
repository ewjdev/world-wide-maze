/**
 * Share cards (Phase 18): a small picture of one stage's part of the page, from the capture's PNG screenshot.
 *
 * Stage textures are WebP, which resvg can't decode; the 1× analysis screenshot (`captures/<id>/screenshot.png`)
 * is PNG. It can be a whole tall page, so it is never decoded whole: rows stream through the platform zlib
 * inflater, rows above the slice are only un-filtered, rows inside it are box-averaged straight into a small RGB
 * buffer, and the stream is cancelled after the slice's last row. Peak memory ≈ two scanlines + the thumbnail.
 * `encodePng` writes the thumbnail back as a PNG for resvg. Pure (Web Streams only), so Node tests run it too.
 */

export interface RgbImage {
  width: number;
  height: number;
  /** RGB, 3 bytes per pixel, row-major. */
  data: Uint8Array;
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

const u32 = (b: Uint8Array, o: number) =>
  (((b[o] as number) << 24) |
    ((b[o + 1] as number) << 16) |
    ((b[o + 2] as number) << 8) |
    (b[o + 3] as number)) >>>
  0;

export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.byteLength < 33 || SIG.some((v, i) => b[i] !== v)) return null;
  return { width: u32(b, 16), height: u32(b, 20) };
}

/**
 * Rows [y0, y1) of the PNG, downscaled by the integer factor `k` (box filter). Composites alpha over white.
 * Throws on formats Chromium doesn't produce (16-bit, palette, interlaced).
 */
export async function pngCropThumb(bytes: Uint8Array, y0: number, y1: number, k: number): Promise<RgbImage> {
  const size = pngSize(bytes);
  if (!size) throw new Error('not a PNG');
  const { width } = size;
  const depth = bytes[24];
  const colorType = bytes[25] as number;
  const interlace = bytes[28];
  const ch = CHANNELS[colorType];
  if (depth !== 8 || ch === undefined || interlace !== 0) throw new Error('PNG: unsupported format');
  const top = Math.max(0, Math.min(size.height, Math.floor(y0)));
  const bottom = Math.max(top, Math.min(size.height, Math.ceil(y1)));
  k = Math.max(1, Math.floor(k));
  const outW = Math.max(1, Math.floor(width / k));
  const outH = Math.max(1, Math.floor((bottom - top) / k));
  const acc = new Float64Array(outW * 3);
  const out = new Uint8Array(outW * outH * 3);

  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const feed = (async () => {
    let o = 8;
    try {
      while (o + 8 <= bytes.byteLength) {
        const len = u32(bytes, o);
        const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
        if (type === 'IDAT')
          await writer.write(new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset + o + 8, len));
        if (type === 'IEND') break;
        o += 12 + len;
      }
      await writer.close();
    } catch {
      // the reader cancelled after the last row we need
    }
  })();

  const stride = width * ch;
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  const row = new Uint8Array(stride + 1);
  let fill = 0;
  let y = 0;
  const unfilter = () => {
    const f = row[0] as number;
    for (let i = 0; i < stride; i++) {
      const x = row[i + 1] as number;
      const a = i >= ch ? (cur[i - ch] as number) : 0;
      const b = prev[i] as number;
      let v: number;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) {
        const c = i >= ch ? (prev[i - ch] as number) : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`PNG: bad filter ${f}`);
      cur[i] = v & 0xff;
    }
  };
  const accumulate = () => {
    for (let ox = 0; ox < outW; ox++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let dx = 0; dx < k; dx++) {
        const s = (ox * k + dx) * ch;
        let pr: number;
        let pg: number;
        let pb: number;
        let al = 255;
        if (ch >= 3) {
          pr = cur[s] as number;
          pg = cur[s + 1] as number;
          pb = cur[s + 2] as number;
          if (ch === 4) al = cur[s + 3] as number;
        } else {
          pr = pg = pb = cur[s] as number;
          if (ch === 2) al = cur[s + 1] as number;
        }
        if (al < 255) {
          const t = al / 255;
          pr = pr * t + 255 * (1 - t);
          pg = pg * t + 255 * (1 - t);
          pb = pb * t + 255 * (1 - t);
        }
        r += pr;
        g += pg;
        bl += pb;
      }
      acc[ox * 3] = (acc[ox * 3] as number) + r;
      acc[ox * 3 + 1] = (acc[ox * 3 + 1] as number) + g;
      acc[ox * 3 + 2] = (acc[ox * 3 + 2] as number) + bl;
    }
  };

  const reader = ds.readable.getReader();
  const lastRow = top + outH * k; // rows past the last full block are dropped
  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    let o = 0;
    while (o < value.byteLength) {
      const n = Math.min(row.length - fill, value.byteLength - o);
      row.set(value.subarray(o, o + n), fill);
      fill += n;
      o += n;
      if (fill < row.length) continue;
      fill = 0;
      unfilter();
      if (y >= top && y < lastRow) {
        accumulate();
        if ((y - top) % k === k - 1) {
          const oy = (y - top - (k - 1)) / k;
          const d = 1 / (k * k);
          for (let i = 0; i < outW * 3; i++) out[oy * outW * 3 + i] = Math.round((acc[i] as number) * d);
          acc.fill(0);
        }
      }
      const t = prev;
      prev = cur;
      cur = t;
      y++;
      if (y >= lastRow) break outer;
    }
  }
  await reader.cancel().catch(() => {});
  await feed;
  if (y < lastRow) throw new Error(`PNG: truncated (${y}/${lastRow} rows)`);
  return { width: outW, height: outH, data: out };
}

let crcTable: Uint32Array | null = null;
function crc32(parts: Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const p of parts) for (const b of p) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let n = 0;
  const r = stream.getReader();
  for (;;) {
    const { value, done } = await r.read();
    if (done) break;
    chunks.push(value);
    n += value.byteLength;
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** 8-bit RGB PNG (Sub filter on every row: cheap and compresses page screenshots well). */
export async function encodePng(img: RgbImage): Promise<Uint8Array> {
  const { width, height, data } = img;
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 1;
    const s = y * stride;
    for (let i = 0; i < stride; i++)
      raw[o + 1 + i] = ((data[s + i] as number) - (i >= 3 ? (data[s + i - 3] as number) : 0)) & 0xff;
  }
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  const done = collect(cs.readable);
  await w.write(raw);
  await w.close();
  const idat = await done;
  const chunk = (type: string, body: Uint8Array) => {
    const t = new TextEncoder().encode(type);
    const out = new Uint8Array(12 + body.byteLength);
    const v = new DataView(out.buffer);
    v.setUint32(0, body.byteLength);
    out.set(t, 4);
    out.set(body, 8);
    v.setUint32(8 + body.byteLength, crc32([t, body]));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const parts = [
    new Uint8Array(SIG),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array()),
  ];
  const total = parts.reduce((a, p) => a + p.byteLength, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.byteLength;
  }
  return png;
}

/** Base64 of bytes, for a `data:` URI inside the SVG. */
export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
