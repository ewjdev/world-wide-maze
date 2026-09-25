/**
 * Phase 14: a `RunSource` for a capture made in the player's browser. The screenshot (or the sketch-mode
 * texture) is held as an `ImageBitmap`; stages are built in `build.worker.ts`; each slice's texture is cropped
 * from the bitmap. Nothing leaves the browser.
 */
import { type Difficulty, hashString, type StageData, sliceCount } from '@wwm/schema';
import { type LoadedStage, type LoadProgress, type RunSource, StageLoadError } from '../game/stages.ts';
import type { LocalBuildReply, LocalBuildRequest } from './build.worker.ts';
import type { LocalCapture } from './protocol.ts';

/** `provenance.notes` tag for stages built from a local capture (contracts §10.2). */
export const LOCAL_CAPTURE_NOTE = 'local-capture';
/** `provenance.notes` tag for bookmarklet stages textured with the generated sketch. */
export const SKETCH_NOTE = 'sketch-mode';

/** Same default seed as the capture service (`hashString(normalizedUrl)`), so a shared run can match. */
export function localSeed(url: string): number {
  return hashString(url) >>> 0;
}

/** One builder worker per local capture. */
export class LocalBuilder {
  #worker: Worker | null = null;
  #ready: Promise<void> | null = null;
  #next = 1;
  #waiting = new Map<number, (r: LocalBuildReply) => void>();

  constructor(
    private readonly cap: LocalCapture,
    private readonly source: ImageBitmap,
  ) {}

  #init(): Promise<void> {
    this.#ready ??= (async () => {
      const w = new Worker(new URL('./build.worker.ts', import.meta.url), {
        type: 'module',
        name: 'wwm-local-builder',
      });
      this.#worker = w;
      const bitmap = await createImageBitmap(this.source); // the worker takes (and closes) its own copy
      await new Promise<void>((resolve, reject) => {
        w.onmessage = (e: MessageEvent<LocalBuildReply>) => {
          const r = e.data;
          if (r.type === 'ready') resolve();
          else if (r.type === 'failed' && r.id === null) reject(new StageLoadError('BUILD_FAILED', r.error));
          else if (r.id !== null) {
            const cb = this.#waiting.get(r.id);
            this.#waiting.delete(r.id);
            cb?.(r);
          }
        };
        w.onerror = (e) => reject(new StageLoadError('BUILD_FAILED', e.message || 'builder worker failed'));
        const msg: LocalBuildRequest = { type: 'init', capture: this.cap.bundle, bitmap };
        w.postMessage(msg, [bitmap]);
      });
    })();
    return this.#ready;
  }

  async build(sliceIndex: number, seed: number, difficulty: Difficulty): Promise<StageData> {
    await this.#init();
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#waiting.set(id, (r) => {
        if (r.type === 'built') resolve(r.stage);
        else reject(new StageLoadError('BUILD_FAILED', r.type === 'failed' ? r.error : 'unexpected reply'));
      });
      const msg: LocalBuildRequest = { type: 'build', id, sliceIndex, seed, difficulty };
      this.#worker?.postMessage(msg);
    });
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
    this.#waiting.clear();
  }
}

export class LocalRun implements RunSource {
  /** Built client-side like the offline fixtures: scores stay on this device until the player shares. */
  readonly kind = 'fixture' as const;
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly #builder: LocalBuilder;

  constructor(
    readonly capture: LocalCapture,
    /** The full-page screenshot, or the sketch texture, at `bundle.screenshot.scale`. */
    readonly source: ImageBitmap,
  ) {
    this.id = `local-${capture.bundle.captureId.slice(0, 12)}`;
    this.title = capture.bundle.title || new URL(capture.bundle.url).hostname;
    this.url = capture.bundle.url;
    this.#builder = new LocalBuilder(capture, source);
  }

  sliceCount(): number {
    return sliceCount(this.capture.bundle);
  }

  async loadSlice(index: number, onProgress: (p: LoadProgress) => void): Promise<LoadedStage> {
    onProgress({ step: 'extracting', pct: 10 });
    onProgress({ step: 'building', pct: 30 });
    const built = await this.#builder.build(index, localSeed(this.url), 'normal');
    const notes = [...built.provenance.notes, LOCAL_CAPTURE_NOTE];
    if (!this.capture.image) notes.push(SKETCH_NOTE);
    const stage: StageData = { ...built, provenance: { ...built.provenance, notes } };
    onProgress({ step: 'texture', pct: 70 });
    const sc = this.capture.bundle.screenshot.scale;
    const { y, height } = stage.source.slice;
    const image = await createImageBitmap(
      this.source,
      0,
      Math.round(y * sc),
      Math.round(stage.size.width * sc),
      Math.min(this.source.height - Math.round(y * sc), Math.round(height * sc)),
    );
    // `/play/local` is not a shareable reference: the Share button uploads the capture instead.
    return { stage, image, ref: 'local' };
  }

  dispose(): void {
    this.#builder.dispose();
  }
}
