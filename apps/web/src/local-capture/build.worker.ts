/**
 * Phase 14: builds the stages of a local capture off the main thread. It's the offline builder worker's
 * recipe (`src/game/builder.worker.ts`: decode once, then run the pure `@wwm/stage-builder` per slice), but it
 * takes the screenshot as a transferred `ImageBitmap` instead of a URL. The page's CSP (`connect-src 'self'`)
 * would refuse a worker `fetch` of a `blob:` URL, and the capture never touches the network.
 */
import type { CaptureBundle, Difficulty, RGBAImage, StageData } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';

export type LocalBuildRequest =
  | { type: 'init'; capture: CaptureBundle; bitmap: ImageBitmap }
  | { type: 'build'; id: number; sliceIndex: number; seed: number; difficulty: Difficulty };

export type LocalBuildReply =
  | { type: 'ready'; ms: number }
  | { type: 'built'; id: number; stage: StageData; ms: number }
  | { type: 'failed'; id: number | null; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<LocalBuildRequest>) => void) | null;
  postMessage(m: LocalBuildReply): void;
}
const scope = self as unknown as WorkerScope;

let capture: CaptureBundle | null = null;
let image: RGBAImage | null = null;

function decode(bmp: ImageBitmap): RGBAImage {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2d context unavailable');
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const d = g.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

scope.onmessage = (e: MessageEvent<LocalBuildRequest>) => {
  const r = e.data;
  const t0 = performance.now();
  if (r.type === 'init') {
    try {
      capture = r.capture;
      image = decode(r.bitmap);
      scope.postMessage({ type: 'ready', ms: performance.now() - t0 });
    } catch (err) {
      scope.postMessage({
        type: 'failed',
        id: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  try {
    if (!capture || !image) throw new Error('builder not initialised');
    const { stage } = buildStage({
      capture,
      image,
      sliceIndex: r.sliceIndex,
      seed: r.seed,
      difficulty: r.difficulty,
    });
    scope.postMessage({ type: 'built', id: r.id, stage, ms: performance.now() - t0 });
  } catch (err) {
    scope.postMessage({ type: 'failed', id: r.id, error: err instanceof Error ? err.message : String(err) });
  }
};
