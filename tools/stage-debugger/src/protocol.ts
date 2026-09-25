/** Messages between the debugger page and its build worker. */
import type { CaptureBundle, StageData } from '@wwm/schema';
import type { DebugLayersEx } from '@wwm/stage-builder';

export type WorkerRequest =
  | { type: 'load'; capture: CaptureBundle; width: number; height: number; data: ArrayBuffer }
  | {
      type: 'build';
      sliceIndex: number;
      seed: number;
      difficulty: string;
      params: Record<string, unknown>;
    };

export type WorkerResponse =
  | { type: 'loaded' }
  | { type: 'result'; stage: StageData; debug: DebugLayersEx; ms: number }
  | { type: 'error'; message: string };

/** One entry of `GET /api/fixtures`. */
export interface FixtureInfo {
  slug: string;
  title: string;
  pageHeight: number;
  slices: number;
}
