import { readFileSync } from 'node:fs';
import { type CaptureBundle, computeCaptureId, parseCapture } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import type { SliceTexture } from '../src/capture/types.ts';
import { uploadCaptureId } from '../src/routes/upload.ts';

const dir = new URL('../../../fixtures/captures/wikipedia-article/', import.meta.url);
const fixture = parseCapture(JSON.parse(readFileSync(new URL('capture.json', dir), 'utf8')));
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const textures: SliceTexture[] = [0, 1].map((i) => ({
  sliceIndex: i,
  y: i * 800,
  height: 800,
  width: 2560,
  heightPx: 1600,
  scale: 2,
  contentType: 'image/webp',
  bytes: new Uint8Array([i, 4, 5]),
}));

function copyBundle(): CaptureBundle {
  return structuredClone(fixture);
}
function copyTextures(): SliceTexture[] {
  return textures.map((t) => ({ ...t, bytes: t.bytes.slice() }));
}

describe('server-owned upload content identity', () => {
  test('identical capture and byte copies have a stable SHA-256 identity', async () => {
    const id = await uploadCaptureId(fixture, png, textures);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await uploadCaptureId(copyBundle(), png.slice(), copyTextures())).toBe(id);
  });
  test('changing analysis screenshot changes identity', async () => {
    expect(await uploadCaptureId(fixture, new Uint8Array([...png, 9]), textures)).not.toBe(
      await uploadCaptureId(fixture, png, textures),
    );
  });
  test.each(['geometry', 'text', 'title'] as const)('changing bundle %s changes identity', async (field) => {
    const modified = copyBundle();
    if (field === 'geometry') modified.page.width += 1;
    if (field === 'text') {
      const element = modified.elements[0];
      if (!element) throw new Error('fixture must contain an element');
      element.text = 'Different untrusted text';
    }
    if (field === 'title') modified.title = 'Different untrusted title';
    expect(await uploadCaptureId(modified, png, textures)).not.toBe(
      await uploadCaptureId(fixture, png, textures),
    );
  });
  test.each([0, 1])('changing independent texture %i bytes changes identity', async (index) => {
    const modified = copyTextures();
    const texture = modified[index];
    if (!texture) throw new Error('texture fixture missing');
    texture.bytes = new Uint8Array([99, 98, 97]);
    expect(await uploadCaptureId(fixture, png, modified)).not.toBe(
      await uploadCaptureId(fixture, png, textures),
    );
  });
  test('changing texture content type, placement or dimensions changes identity', async () => {
    const id = await uploadCaptureId(fixture, png, textures);
    for (const patch of [{ contentType: 'image/png' as const }, { y: 1 }, { width: 1280 }, { scale: 1 }]) {
      const modified = copyTextures();
      const first = modified[0];
      if (!first) throw new Error('texture fixture missing');
      Object.assign(first, patch);
      expect(await uploadCaptureId(fixture, png, modified)).not.toBe(id);
    }
  });
  test('claimed captureId is ignored and cannot select hosted object keys', async () => {
    const hosted = await computeCaptureId(fixture.url, fixture.capturedAt);
    const forged = { ...copyBundle(), captureId: hosted };
    const actual = await uploadCaptureId(forged, png, textures);
    expect(actual).not.toBe(hosted);
    expect(actual).not.toBe(fixture.captureId);
    const attemptedReuse = { ...forged, captureId: actual };
    expect(await uploadCaptureId(attemptedReuse, png, textures)).toBe(actual);
    expect(await uploadCaptureId({ ...forged, captureId: 'f'.repeat(64) }, png, textures)).toBe(actual);
    const changed = copyTextures();
    if (!changed[0]) throw new Error('texture fixture missing');
    changed[0].bytes = new Uint8Array([99]);
    expect(await uploadCaptureId(attemptedReuse, png, changed)).not.toBe(actual);
  });
});
