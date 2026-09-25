/**
 * Binary framing for a `CaptureOutput` between the capture sidecar (Node) and the Worker, so multi-MB
 * images don't pay base64 inflation:
 *   "WWMC" | u32 version (1) | u32 jsonLength | JSON (UTF-8) | blob bytes…
 * The JSON is the output with every `Uint8Array` replaced by `{ blob: index }`; blob i is at the offset/length
 * listed in `blobs`.
 */
import { isApiErrorCode } from '@wwm/schema';
import { ServiceError } from '../errors.ts';
import type { CaptureOutput, SliceTexture } from './types.ts';

const MAGIC = 0x57574d43; // "WWMC"
const VERSION = 1;

interface WireJson {
  bundle: CaptureOutput['bundle'];
  status: number;
  timingsMs: Record<string, number>;
  requests: CaptureOutput['requests'];
  screenshot: number;
  textures: (Omit<SliceTexture, 'bytes'> & { blob: number })[];
  blobs: { offset: number; length: number }[];
}

export function encodeCaptureOutput(out: CaptureOutput): Uint8Array {
  const blobs: Uint8Array[] = [out.screenshotPng, ...out.textures.map((t) => t.bytes)];
  let offset = 0;
  const table = blobs.map((b) => {
    const e = { offset, length: b.byteLength };
    offset += b.byteLength;
    return e;
  });
  const json: WireJson = {
    bundle: out.bundle,
    status: out.status,
    timingsMs: out.timingsMs,
    requests: out.requests,
    screenshot: 0,
    textures: out.textures.map(({ bytes: _bytes, ...t }, i) => ({ ...t, blob: i + 1 })),
    blobs: table,
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const buf = new Uint8Array(12 + jsonBytes.byteLength + offset);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, MAGIC);
  dv.setUint32(4, VERSION);
  dv.setUint32(8, jsonBytes.byteLength);
  buf.set(jsonBytes, 12);
  let o = 12 + jsonBytes.byteLength;
  for (const b of blobs) {
    buf.set(b, o);
    o += b.byteLength;
  }
  return buf;
}

export function decodeCaptureOutput(buf: Uint8Array): CaptureOutput {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 12 || dv.getUint32(0) !== MAGIC || dv.getUint32(4) !== VERSION)
    throw new Error('capture wire: bad header');
  const jsonLen = dv.getUint32(8);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(12, 12 + jsonLen))) as WireJson;
  const base = 12 + jsonLen;
  const blob = (i: number): Uint8Array => {
    const e = json.blobs[i];
    if (!e || base + e.offset + e.length > buf.byteLength) throw new Error('capture wire: bad blob');
    return buf.slice(base + e.offset, base + e.offset + e.length);
  };
  return {
    bundle: json.bundle,
    status: json.status,
    timingsMs: json.timingsMs,
    requests: json.requests,
    screenshotPng: blob(json.screenshot),
    textures: json.textures.map(({ blob: b, ...t }) => ({ ...t, bytes: blob(b) })),
  };
}

/** Error body the sidecar returns; turned back into a `ServiceError` by the Worker. */
export function errorFromWire(status: number, body: unknown): ServiceError {
  const b = body as { code?: unknown; message?: unknown } | null;
  if (b && isApiErrorCode(b.code)) return new ServiceError(b.code, String(b.message ?? ''));
  return new ServiceError('BUILD_FAILED', `capture sidecar HTTP ${status}`);
}
