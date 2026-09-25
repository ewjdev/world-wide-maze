/**
 * Phase 14: a tiny PNG encoder for `POST /api/stages/upload`. It's used only when the client sends no slice
 * textures. The Worker then crops each slice out of the decoded analysis image and stores it as PNG.
 *
 * It streams through the native zlib deflater (`CompressionStream('deflate')`, the zlib format PNG's IDAT
 * expects). Each row gets filter 0 ("None"), so the output is large but exact, and encoding is cheap.
 */
import type { RGBAImage } from '@wwm/schema';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts)
    for (let i = 0; i < p.length; i++) c = (CRC_TABLE[(c ^ (p[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  const tag = new TextEncoder().encode(type);
  out.set(tag, 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32([tag, data]));
  return out;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

/**
 * Encode rows `[y0, y0 + height)` of `image` as an 8-bit RGBA PNG. The crop is full width, which is how every
 * stage slice is shaped (contracts §3).
 */
export async function encodePngRows(image: RGBAImage, y0: number, height: number): Promise<Uint8Array> {
  const { width } = image;
  if (!(height > 0) || y0 < 0 || y0 + height > image.height)
    throw new RangeError(`encodePngRows: rows ${y0}+${height} outside 0..${image.height}`);
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const compressed = collect(cs.readable as ReadableStream<Uint8Array>);
  const stride = width * 4;
  // Write in batches of rows, so the input side never holds a second copy of the whole image.
  const batchRows = Math.max(1, Math.floor((1 << 20) / (stride + 1)));
  for (let y = 0; y < height; y += batchRows) {
    const rows = Math.min(batchRows, height - y);
    const buf = new Uint8Array(rows * (stride + 1));
    for (let r = 0; r < rows; r++) {
      const src = (y0 + y + r) * stride;
      buf[r * (stride + 1)] = 0; // filter: None
      buf.set(image.data.subarray(src, src + stride), r * (stride + 1) + 1);
    }
    await writer.write(buf);
  }
  await writer.close();
  const idat = await compressed;

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
