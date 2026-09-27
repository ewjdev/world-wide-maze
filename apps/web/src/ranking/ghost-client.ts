import { PHYSICS_VERSION } from '@wwm/physics';
import type { InputSample, StageData } from '@wwm/schema';
import type { GhostTrack } from './ghost-track.ts';

/** One active worker, following Race PR #17's termination-based cancellation.
 * Termination interrupts even synchronous Rapier work; there is no blocking fallback.
 */
export class GhostClient {
  #cancel: (() => void) | null = null;
  #disposed = false;

  prepare(stage: StageData, inputs: readonly InputSample[], signal?: AbortSignal): Promise<GhostTrack> {
    this.cancel();
    if (this.#disposed || signal?.aborted)
      return Promise.reject(new DOMException('Ghost preparation cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      let worker: Worker | null = null;
      let settled = false;
      const finish = (error?: unknown, track?: GhostTrack) => {
        if (settled) return;
        settled = true;
        worker?.terminate();
        signal?.removeEventListener('abort', cancel);
        if (this.#cancel === cancel) this.#cancel = null;
        if (error) reject(error);
        else if (track) resolve(track);
      };
      const cancel = () => finish(new DOMException('Ghost preparation cancelled', 'AbortError'));
      this.#cancel = cancel;
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        worker = new Worker(new URL('./ghost-worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ track?: GhostTrack; error?: string }>) => {
          const track = event.data.track;
          if (track?.physicsVersion === PHYSICS_VERSION) finish(undefined, track);
          else finish(new Error(event.data.error ?? 'Ghost physics version mismatch'));
        };
        worker.onerror = () => finish(new Error('Ghost worker unavailable'));
        worker.onmessageerror = () => finish(new Error('Ghost worker response could not be read'));
        // Clone inputs. The caller can retain a replay without detached buffers.
        worker.postMessage({ stage, inputs });
      } catch (error) {
        finish(error);
      }
    });
  }

  cancel(): void {
    this.#cancel?.();
  }

  dispose(): void {
    this.#disposed = true;
    this.cancel();
  }
}
