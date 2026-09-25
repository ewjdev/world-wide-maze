/**
 * Off-main-thread stage building for the offline / curated path: decode a capture screenshot once, then run
 * the pure @wwm/stage-builder on any slice. Same code the capture worker runs (Phase 03/07).
 */

import type { CaptureBundle, Difficulty, RGBAImage, StageData } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';

export interface BuildRequest {
  id: number;
  capture: CaptureBundle;
  screenshotUrl: string;
  sliceIndex: number;
  seed: number;
  difficulty: Difficulty;
}
export type BuildReply =
  | { id: number; ok: true; stage: StageData; ms: number }
  | { id: number; ok: false; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<BuildRequest>) => void) | null;
  postMessage(m: BuildReply): void;
}
const scope = self as unknown as WorkerScope;

const images = new Map<string, Promise<RGBAImage>>();

async function decode(url: string): Promise<RGBAImage> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2d context unavailable');
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const d = g.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

scope.onmessage = async (e: MessageEvent<BuildRequest>) => {
  const r = e.data;
  try {
    let img = images.get(r.screenshotUrl);
    if (!img) {
      img = decode(r.screenshotUrl);
      images.set(r.screenshotUrl, img);
    }
    const image = await img;
    const t0 = performance.now();
    const { stage } = buildStage({
      capture: r.capture,
      image,
      sliceIndex: r.sliceIndex,
      seed: r.seed,
      difficulty: r.difficulty,
    });
    const reply: BuildReply = { id: r.id, ok: true, stage, ms: performance.now() - t0 };
    scope.postMessage(reply);
  } catch (err) {
    images.delete(r.screenshotUrl);
    const reply: BuildReply = {
      id: r.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    scope.postMessage(reply);
  }
};
