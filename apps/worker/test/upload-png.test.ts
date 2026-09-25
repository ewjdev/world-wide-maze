import { describe, expect, test } from 'vitest';
import { decodePng } from '../src/image/png.ts';
import { encodePngRows } from '../src/routes/upload-png.ts';

describe('encodePngRows (Phase 14 fallback slice textures)', () => {
  test('round-trips a row range through the PNG decoder exactly', async () => {
    const width = 37;
    const height = 50;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (i >> 7)) & 0xff;
    const image = { width, height, data };
    const png = await encodePngRows(image, 12, 20);
    const back = await decodePng(png);
    expect([back.width, back.height]).toEqual([width, 20]);
    expect(Array.from(back.data)).toEqual(Array.from(data.subarray(12 * width * 4, 32 * width * 4)));
  });

  test('rejects rows outside the image', async () => {
    const image = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
    await expect(encodePngRows(image, 1, 2)).rejects.toThrow(RangeError);
  });
});
