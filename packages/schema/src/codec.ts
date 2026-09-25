/**
 * Binary INPUT frame codec (contracts §6). 12 bytes, little-endian:
 *
 * | offset | type | field |
 * |---|---|---|
 * | 0 | u8  | msgType = 1 (INPUT) |
 * | 1 | u8  | buttons: bit0 POWER, bit1 JUMP, bit2 MENU |
 * | 2 | u16 | seq (wraps) |
 * | 4 | f32 | tiltX (rad) |
 * | 8 | f32 | tiltZ (rad) |
 */
import type { ControllerInputFrame } from './types.ts';

export const MSG_INPUT = 1;
export const INPUT_FRAME_BYTES = 12;
export const BUTTON_POWER = 1 << 0;
export const BUTTON_JUMP = 1 << 1;
export const BUTTON_MENU = 1 << 2;
export const SEQ_MODULO = 0x10000;

/** Encode a controller input frame. `seq` is taken modulo 2^16; tilts are stored as float32. */
export function encodeInput(frame: ControllerInputFrame, out?: ArrayBuffer): ArrayBuffer {
  const buf = out ?? new ArrayBuffer(INPUT_FRAME_BYTES);
  if (buf.byteLength < INPUT_FRAME_BYTES) throw new RangeError('encodeInput: buffer too small');
  const v = new DataView(buf);
  v.setUint8(0, MSG_INPUT);
  v.setUint8(
    1,
    (frame.power ? BUTTON_POWER : 0) | (frame.jump ? BUTTON_JUMP : 0) | (frame.menu ? BUTTON_MENU : 0),
  );
  v.setUint16(2, ((frame.seq % SEQ_MODULO) + SEQ_MODULO) % SEQ_MODULO, true);
  v.setFloat32(4, frame.tiltX, true);
  v.setFloat32(8, frame.tiltZ, true);
  return buf;
}

/**
 * Decode a binary frame. Returns null if it isn't a 12-byte INPUT frame (wrong length or msgType)
 * or if a tilt is not finite. Unknown button bits are ignored.
 */
export function decodeInput(data: ArrayBuffer | ArrayBufferView): ControllerInputFrame | null {
  const v =
    data instanceof ArrayBuffer
      ? new DataView(data)
      : new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.byteLength !== INPUT_FRAME_BYTES || v.getUint8(0) !== MSG_INPUT) return null;
  const buttons = v.getUint8(1);
  const tiltX = v.getFloat32(4, true);
  const tiltZ = v.getFloat32(8, true);
  if (!Number.isFinite(tiltX) || !Number.isFinite(tiltZ)) return null;
  return {
    seq: v.getUint16(2, true),
    power: (buttons & BUTTON_POWER) !== 0,
    jump: (buttons & BUTTON_JUMP) !== 0,
    menu: (buttons & BUTTON_MENU) !== 0,
    tiltX,
    tiltZ,
  };
}

/**
 * Serial-number comparison for the wrapping u16 `seq` (RFC 1982 style): true if `a` is newer than `b`.
 * The host drops samples for which `isSeqNewer(seq, lastSeq)` is false.
 */
export function isSeqNewer(a: number, b: number): boolean {
  const d = (a - b + SEQ_MODULO) % SEQ_MODULO;
  return d !== 0 && d < SEQ_MODULO / 2;
}
