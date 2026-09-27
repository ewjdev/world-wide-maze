import type { StageData } from '@wwm/schema';
import type { BuilderMessage, BuildReply, BuildRequest } from './builder-service.ts';
import { StageLoadError } from './stage-errors.ts';

interface PendingBuild {
  resolve(stage: StageData): void;
  reject(reason: unknown): void;
  cleanup(): void;
}

/** Owned by one Game. Cancellation settles locally even if worker JS is busy in a synchronous build. */
export class StageBuilderPool {
  #worker: Worker | null = null;
  #next = 1;
  #disposed = false;
  readonly #waiting = new Map<number, PendingBuild>();

  constructor(
    readonly spawn = () =>
      new Worker(new URL('./builder.worker.ts', import.meta.url), {
        type: 'module',
        name: 'wwm-builder',
      }),
  ) {}

  #stop(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }

  #fail(reason: unknown): void {
    this.#stop();
    for (const waiting of this.#waiting.values()) {
      waiting.cleanup();
      waiting.reject(reason);
    }
    this.#waiting.clear();
  }

  build(req: Omit<BuildRequest, 'id'>, signal?: AbortSignal): Promise<StageData> {
    if (this.#disposed) return Promise.reject(new StageLoadError('BUILD_FAILED', 'builder disposed'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      try {
        if (!this.#worker) {
          const worker = this.spawn();
          this.#worker = worker;
          worker.onmessage = (event: MessageEvent<BuildReply>) => {
            // Events queued by a replaced worker never own current requests.
            if (this.#worker !== worker) return;
            const reply = event.data;
            const waiting = this.#waiting.get(reply.id);
            if (!waiting) return;
            this.#waiting.delete(reply.id);
            waiting.cleanup();
            if (reply.ok) waiting.resolve(reply.stage);
            else waiting.reject(new StageLoadError('BUILD_FAILED', reply.error));
          };
          worker.onerror = (event) => {
            event.preventDefault();
            if (this.#worker === worker)
              this.#fail(new StageLoadError('BUILD_FAILED', event.message || 'builder worker failed'));
          };
          worker.onmessageerror = () => {
            if (this.#worker === worker)
              this.#fail(new StageLoadError('BUILD_FAILED', 'builder reply could not be decoded'));
          };
        }
        const id = this.#next++;
        const abort = () => {
          const waiting = this.#waiting.get(id);
          if (!waiting) return;
          this.#waiting.delete(id);
          waiting.cleanup();
          waiting.reject(signal?.reason ?? new DOMException('Build aborted', 'AbortError'));
          // A sole obsolete build can be interrupted immediately, including synchronous builder CPU work.
          if (this.#waiting.size === 0) this.#stop();
          else this.#worker?.postMessage({ cancel: id } satisfies BuilderMessage);
        };
        this.#waiting.set(id, {
          resolve,
          reject,
          cleanup: () => signal?.removeEventListener('abort', abort),
        });
        signal?.addEventListener('abort', abort, { once: true });
        this.#worker.postMessage({ ...req, id } satisfies BuildRequest);
      } catch (err) {
        this.#fail(new StageLoadError('BUILD_FAILED', String(err)));
        reject(err);
      }
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#fail(new StageLoadError('BUILD_FAILED', 'builder disposed'));
  }
}
