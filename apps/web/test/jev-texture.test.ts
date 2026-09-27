import { expect, it, vi } from 'vitest';
import { textureBlob } from '../src/jev/texture.ts';

it('decodes saved PNG, JPEG and WebP bytes without network access under production CSP', async () => {
  const fetch = vi.fn(() => {
    throw new Error('Blocked by connect-src');
  });
  vi.stubGlobal('fetch', fetch);
  try {
    for (const type of ['png', 'jpeg', 'webp']) {
      const blob = textureBlob(`data:image/${type};base64,AP9/`);
      expect(blob.type).toBe(`image/${type}`);
      expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 255, 127]);
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('rejects URLs and unsupported or malformed image encodings', () => {
  for (const value of [
    'https://example.com/a.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png,hello',
    'data:image/png;base64,!!',
  ]) {
    expect(() => textureBlob(value)).toThrow('Unsupported saved maze texture');
  }
});
