/** Runs `buildStage` off the main thread. Protocol: see `WorkerRequest` / `WorkerResponse`. */
import type { CaptureBundle, Difficulty, RGBAImage } from '@wwm/schema';
import { type BuildParams, buildStageUnchecked } from '@wwm/stage-builder';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

let capture: CaptureBundle | null = null;
let image: RGBAImage | null = null;

const post = (msg: WorkerResponse) => (self as unknown as { postMessage(m: unknown): void }).postMessage(msg);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'load') {
    capture = msg.capture;
    image = { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.data) };
    post({ type: 'loaded' });
    return;
  }
  if (!capture || !image) {
    post({ type: 'error', message: 'no capture loaded' });
    return;
  }
  try {
    const t0 = performance.now();
    const r = buildStageUnchecked(
      {
        capture,
        image,
        sliceIndex: msg.sliceIndex,
        seed: msg.seed,
        difficulty: msg.difficulty as Difficulty,
      },
      { params: msg.params as Partial<BuildParams> },
    );
    post({ type: 'result', stage: r.stage, debug: r.debug, ms: performance.now() - t0 });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
  }
};
