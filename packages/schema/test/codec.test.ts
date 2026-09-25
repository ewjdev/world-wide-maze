import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  BUTTON_JUMP,
  BUTTON_MENU,
  BUTTON_POWER,
  type ControllerInputFrame,
  decodeInput,
  encodeInput,
  INPUT_FRAME_BYTES,
  isSeqNewer,
  MSG_INPUT,
} from '../src/index.ts';

const frameArb = fc.record({
  seq: fc.integer({ min: 0, max: 0xffff }),
  power: fc.boolean(),
  jump: fc.boolean(),
  menu: fc.boolean(),
  tiltX: fc.float({ noNaN: true, noDefaultInfinity: true }),
  tiltZ: fc.float({ noNaN: true, noDefaultInfinity: true }),
});

describe('INPUT frame codec (contracts §6)', () => {
  test('layout: 12 bytes, little-endian, exact offsets', () => {
    const buf = encodeInput({ seq: 0x1234, power: true, jump: false, menu: true, tiltX: 0.25, tiltZ: -0.5 });
    expect(buf.byteLength).toBe(INPUT_FRAME_BYTES);
    const v = new DataView(buf);
    expect(v.getUint8(0)).toBe(MSG_INPUT);
    expect(v.getUint8(1)).toBe(BUTTON_POWER | BUTTON_MENU);
    expect([v.getUint8(2), v.getUint8(3)]).toEqual([0x34, 0x12]); // u16 LE
    expect(v.getFloat32(4, true)).toBe(0.25);
    expect(v.getFloat32(8, true)).toBe(-0.5);
    expect(BUTTON_POWER).toBe(1);
    expect(BUTTON_JUMP).toBe(2);
    expect(BUTTON_MENU).toBe(4);
  });

  test('property: decode(encode(f)) === f for float32-representable frames', () => {
    fc.assert(
      fc.property(frameArb, (f: ControllerInputFrame) => {
        expect(decodeInput(encodeInput(f))).toEqual(f);
      }),
      { numRuns: 2000 },
    );
  });

  test('property: arbitrary doubles round-trip to their float32 value; seq wraps mod 2^16', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (seq, x, z) => {
          const d = decodeInput(
            encodeInput({ seq, power: false, jump: true, menu: false, tiltX: x, tiltZ: z }),
          );
          expect(d).not.toBeNull();
          expect(d?.seq).toBe(((seq % 65536) + 65536) % 65536);
          expect(d?.tiltX).toBe(Math.fround(x));
          expect(d?.tiltZ).toBe(Math.fround(z));
          expect(d?.jump).toBe(true);
        },
      ),
    );
  });

  test('decodes from a Uint8Array view at an offset', () => {
    const big = new Uint8Array(32);
    big.set(
      new Uint8Array(encodeInput({ seq: 7, power: true, jump: true, menu: false, tiltX: 0.1, tiltZ: 0.2 })),
      10,
    );
    expect(decodeInput(big.subarray(10, 22))?.seq).toBe(7);
  });

  test('rejects wrong length, wrong msgType and non-finite tilts', () => {
    expect(decodeInput(new ArrayBuffer(11))).toBeNull();
    expect(decodeInput(new ArrayBuffer(13))).toBeNull();
    const bad = encodeInput({ seq: 1, power: false, jump: false, menu: false, tiltX: 0, tiltZ: 0 });
    new DataView(bad).setUint8(0, 2);
    expect(decodeInput(bad)).toBeNull();
    const nan = encodeInput({ seq: 1, power: false, jump: false, menu: false, tiltX: Number.NaN, tiltZ: 0 });
    expect(decodeInput(nan)).toBeNull();
  });

  test('ignores unknown button bits', () => {
    const buf = encodeInput({ seq: 1, power: false, jump: false, menu: false, tiltX: 0, tiltZ: 0 });
    new DataView(buf).setUint8(1, 0xf8);
    expect(decodeInput(buf)).toMatchObject({ power: false, jump: false, menu: false });
  });

  test('isSeqNewer handles wrap-around', () => {
    expect(isSeqNewer(1, 0)).toBe(true);
    expect(isSeqNewer(0, 1)).toBe(false);
    expect(isSeqNewer(5, 5)).toBe(false);
    expect(isSeqNewer(0, 0xffff)).toBe(true);
    expect(isSeqNewer(0xffff, 0)).toBe(false);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffff }), fc.integer({ min: 1, max: 0x7fff }), (b, d) => {
        expect(isSeqNewer((b + d) % 65536, b)).toBe(true);
        expect(isSeqNewer(b, (b + d) % 65536)).toBe(false);
      }),
    );
  });
});
