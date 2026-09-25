/**
 * Runs the real stage builder off the main thread for /making (same pattern as tools/stage-debugger's worker):
 * `buildStageUnchecked` returns the stage plus every intermediate layer.
 */
import type { CaptureBundle, Difficulty, StageData } from '@wwm/schema';
import { buildStageUnchecked, type DebugLayersEx } from '@wwm/stage-builder';

export type BuildRequest = {
  capture: CaptureBundle;
  width: number;
  height: number;
  data: ArrayBuffer;
  sliceIndex: number;
  seed: number;
  difficulty: Difficulty;
};
export type BuildResponse =
  | { type: 'result'; stage: StageData; debug: DebugLayersEx; ms: number }
  | { type: 'error'; message: string };

self.onmessage = (ev: MessageEvent<BuildRequest>) => {
  const m = ev.data;
  try {
    const t0 = performance.now();
    const r = buildStageUnchecked({
      capture: m.capture,
      image: { width: m.width, height: m.height, data: new Uint8ClampedArray(m.data) },
      sliceIndex: m.sliceIndex,
      seed: m.seed,
      difficulty: m.difficulty,
    });
    (self as unknown as Worker).postMessage({
      type: 'result',
      stage: r.stage,
      debug: r.debug,
      ms: performance.now() - t0,
    } satisfies BuildResponse);
  } catch (e) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    } satisfies BuildResponse);
  }
};
