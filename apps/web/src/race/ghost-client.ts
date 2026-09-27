import type { RaceAttempt, RaceCourse, RaceGhostTrack } from '@wwm/race';

/** One active worker. Termination cancels even a synchronous Rapier replay, releasing its world. */
export class GhostClient {
  private worker: Worker | null = null;
  private rejectPending: ((error: Error) => void) | null = null;
  private generation = 0;
  prepare(course: RaceCourse, attempt: RaceAttempt): Promise<RaceGhostTrack> {
    this.cancel();
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      this.rejectPending = reject;
      try {
        const worker = new Worker(new URL('./ghost-worker.ts', import.meta.url), { type: 'module' });
        this.worker = worker;
        const cleanup = () => {
          worker.terminate();
          if (this.worker === worker) {
            this.worker = null;
            this.rejectPending = null;
          }
        };
        worker.onmessage = (event: MessageEvent<{ track?: RaceGhostTrack; error?: string }>) => {
          if (generation !== this.generation) return;
          cleanup();
          if (event.data.track) resolve(event.data.track);
          else reject(new Error(event.data.error ?? 'Ghost preparation failed'));
        };
        worker.onerror = () => {
          cleanup();
          reject(new Error('Ghost worker unavailable'));
        };
        // Clone recording; transferring would detach the durable/session record.
        worker.postMessage({ course, attempt });
      } catch (error) {
        this.cancel();
        reject(error);
      }
    });
  }
  cancel(): void {
    this.generation++;
    this.worker?.terminate();
    this.worker = null;
    this.rejectPending?.(new DOMException('Ghost preparation cancelled', 'AbortError'));
    this.rejectPending = null;
  }
  dispose(): void {
    this.cancel();
  }
}
