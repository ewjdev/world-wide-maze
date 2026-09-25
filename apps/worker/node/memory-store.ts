/** In-memory `StageStore` for unit tests and the benchmark (no Cloudflare bindings). */
import type { CaptureBundle, StageData } from '@wwm/schema';
import type { SliceTexture } from '../src/capture/types.ts';
import type { RunRecord, StageStore } from '../src/pipeline.ts';

export class MemoryStore implements StageStore {
  readonly captures = new Map<string, { bundle: CaptureBundle; png: Uint8Array }>();
  readonly textures = new Map<string, SliceTexture>();
  readonly runs = new Map<string, RunRecord & { status?: string; timingsMs?: Record<string, number> }>();
  readonly stages = new Map<string, { stage: StageData; runId: string; textureKey: string }>();
  readonly cache = new Map<string, string>();
  /** `job:<cacheKey>` → jobId (in-flight dedupe). */
  readonly inflight = new Map<string, string>();

  async putCapture(bundle: CaptureBundle, png: Uint8Array) {
    this.captures.set(bundle.captureId, { bundle, png });
  }
  async putTexture(captureId: string, t: SliceTexture) {
    const key = `textures/${captureId}/${t.sliceIndex}.webp`;
    this.textures.set(key, t);
    return key;
  }
  async putRun(run: RunRecord) {
    this.runs.set(run.runId, { ...run });
  }
  async putStage(stage: StageData, meta: { runId: string; textureKey: string }) {
    this.stages.set(stage.stageId, { stage, ...meta });
  }
  async finishRun(
    runId: string,
    info: { status: 'complete' | 'partial'; timingsMs: Record<string, number> },
  ) {
    const r = this.runs.get(runId);
    if (r) Object.assign(r, info);
  }
  async cacheRun(cacheKey: string, runId: string) {
    this.cache.set(cacheKey, runId);
  }
  async clearInflightJob(cacheKey: string, jobId: string) {
    if (this.inflight.get(cacheKey) === jobId) this.inflight.delete(cacheKey);
  }
  stagesOf(runId: string): StageData[] {
    return [...this.stages.values()]
      .filter((s) => s.runId === runId)
      .map((s) => s.stage)
      .sort((a, b) => a.source.slice.index - b.source.slice.index);
  }
}
