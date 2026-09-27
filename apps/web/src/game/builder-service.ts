import type { CaptureBundle, Difficulty, RGBAImage, StageData } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { DecodedImageCache } from './decoded-image-cache.ts';

export interface BuildRequest {
  id: number;
  capture: CaptureBundle;
  screenshotUrl: string;
  sliceIndex: number;
  seed: number;
  difficulty: Difficulty;
}
export type BuilderMessage = BuildRequest | { cancel: number };
export type BuildReply =
  | { id: number; ok: true; stage: StageData; ms: number; cache: DecodedImageCache['stats'] }
  | { id: number; ok: false; error: string };

/** Serial decode/build bounds transient work to one image, independent of queued requests. */
export function createBuilderService(
  decode: (url: string, signal: AbortSignal) => Promise<RGBAImage>,
  postMessage: (reply: BuildReply) => void,
  cache = new DecodedImageCache(),
  build = buildStage,
) {
  const queue: { request: BuildRequest; abort: AbortController }[] = [];
  const pending = new Map<number, AbortController>();
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { request: r, abort } = next;
        try {
          abort.signal.throwIfAborted();
          let image = cache.get(r.screenshotUrl);
          if (!image) {
            image = await decode(r.screenshotUrl, abort.signal);
            abort.signal.throwIfAborted();
            cache.set(r.screenshotUrl, image);
          }
          const t0 = performance.now();
          const { stage } = build({
            capture: r.capture,
            image,
            sliceIndex: r.sliceIndex,
            seed: r.seed,
            difficulty: r.difficulty,
          });
          postMessage({ id: r.id, ok: true, stage, ms: performance.now() - t0, cache: cache.stats });
        } catch (err) {
          if (!abort.signal.aborted)
            postMessage({ id: r.id, ok: false, error: err instanceof Error ? err.message : String(err) });
        } finally {
          pending.delete(r.id);
        }
      }
    } finally {
      running = false;
    }
  }

  return (message: BuilderMessage) => {
    if ('cancel' in message) {
      pending.get(message.cancel)?.abort();
      return;
    }
    const abort = new AbortController();
    pending.set(message.id, abort);
    queue.push({ request: message, abort });
    void drain();
  };
}
