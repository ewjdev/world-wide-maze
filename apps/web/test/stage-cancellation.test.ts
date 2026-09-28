import { afterEach, expect, test, vi } from 'vitest';
import { PracticeRun } from '../src/game/stages.ts';

afterEach(() => vi.unstubAllGlobals());

test('cancellation after non-abortable bitmap decode closes the obsolete bitmap', async () => {
  const abort = new AbortController();
  const close = vi.fn();
  let finish: ((image: ImageBitmap) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Blob())));
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const loading = new PracticeRun().loadSlice(0, () => {}, abort.signal);
  const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  abort.abort();
  finish?.({ close } as unknown as ImageBitmap);
  await rejected;
  expect(close).toHaveBeenCalledOnce();
});

test('pre-aborted load never fetches a texture', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(new PracticeRun().loadSlice(0, () => {}, AbortSignal.abort())).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(fetch).not.toHaveBeenCalled();
});
