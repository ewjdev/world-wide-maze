import { Sprite, Vector3 } from 'three/webgpu';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { planTiles } from '../src/geom/tiling.ts';
import { buildBackground } from '../src/world/background.ts';
import { Bin } from '../src/world/bin.ts';
import { createSharedUniforms } from '../src/world/shared.ts';
import { makeStageImages } from '../src/world/stage-images.ts';
import { makeStageTextures } from '../src/world/stage-world.ts';

afterEach(() => vi.unstubAllGlobals());

describe('stage-owned resources', () => {
  test('mote geometry belongs to its stage and never disposes the global Sprite geometry', () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return { createRadialGradient: () => ({ addColorStop() {} }), beginPath() {}, arc() {}, fill() {} };
        }
      },
    );
    const shared = new Sprite().geometry;
    const sharedDispose = vi.fn();
    shared.addEventListener('dispose', sharedDispose);
    const a = new Bin(),
      b = new Bin();
    const first = buildBackground(new Vector3(), -100, 0, createSharedUniforms(), a);
    const second = buildBackground(new Vector3(), -100, 0, createSharedUniforms(), b);
    expect(first.motes.geometry).not.toBe(shared);
    expect(first.motes.geometry).not.toBe(second.motes.geometry);
    const firstDispose = vi.fn(),
      secondDispose = vi.fn();
    first.motes.geometry.addEventListener('dispose', firstDispose);
    second.motes.geometry.addEventListener('dispose', secondDispose);
    a.disposeAll();
    a.disposeAll();
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).not.toHaveBeenCalled();
    expect(sharedDispose).not.toHaveBeenCalled();
    b.disposeAll();
    shared.removeEventListener('dispose', sharedDispose);
  });

  test('borrows a single source image without creating or closing a bitmap', async () => {
    const create = vi.fn();
    vi.stubGlobal('createImageBitmap', create);
    const source = { width: 128, height: 128, close: vi.fn() } as unknown as ImageBitmap;
    const result = await makeStageImages(source, planTiles(128, 128, 1, 4096));
    expect(result.images).toEqual([source]);
    result.dispose();
    expect(source.close).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test('owns all tiled bitmaps through repeated disposal but never closes the source', async () => {
    const source = { width: 128, height: 10000, close: vi.fn() } as unknown as ImageBitmap;
    const bitmaps = Array.from({ length: 3 }, () => ({ close: vi.fn() }));
    const create = vi
      .fn()
      .mockResolvedValueOnce(bitmaps[0])
      .mockResolvedValueOnce(bitmaps[1])
      .mockResolvedValueOnce(bitmaps[2]);
    vi.stubGlobal('createImageBitmap', create);
    const result = await makeStageImages(source, planTiles(128, 10000, 1, 4096));
    expect(result.images).toEqual(bitmaps);
    for (const bitmap of bitmaps) expect(bitmap.close).not.toHaveBeenCalled();
    result.dispose();
    result.dispose();
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(source.close).not.toHaveBeenCalled();
  });

  test('downscaled bitmap closes after its GPU texture, and source remains caller-owned', async () => {
    const events: string[] = [];
    const scaled = { width: 4096, height: 1024, close: vi.fn(() => events.push('bitmap')) };
    const source = { width: 8192, height: 2048, close: vi.fn() } as unknown as ImageBitmap;
    const create = vi.fn().mockResolvedValue(scaled);
    vi.stubGlobal('createImageBitmap', create);
    const owner = await makeStageImages(source, planTiles(8192, 2048, 1, 4096));
    expect(create).toHaveBeenCalledWith(source, 0, 0, 8192, 2048, { resizeWidth: 4096, resizeHeight: 1024 });
    const bin = new Bin();
    bin.add(owner);
    const textures = makeStageTextures(owner.images, 1, bin);
    textures.tiles[0]?.addEventListener('dispose', () => events.push('texture'));
    bin.disposeAll();
    expect(events).toEqual(['texture', 'bitmap']);
    expect(source.close).not.toHaveBeenCalled();
  });

  test('closes previously created tiles when later cropping fails', async () => {
    const first = { close: vi.fn() },
      failure = new Error('bitmap decode failed');
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(failure));
    const source = { width: 128, height: 10000, close: vi.fn() } as unknown as ImageBitmap;
    await expect(makeStageImages(source, planTiles(128, 10000, 1, 4096))).rejects.toBe(failure);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(source.close).not.toHaveBeenCalled();
  });
});
