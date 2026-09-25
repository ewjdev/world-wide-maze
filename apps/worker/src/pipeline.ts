/**
 * The build job (task 4 + G0 updates): capture → moderate → decode → build slice 0 → validate → store →
 * `done` → build the remaining slices in the background. With a playability hook (Phase 09's solver), a slice
 * the bot can't finish is rebuilt with the next seeds (03b) before the job gives up with UNPLAYABLE. Runtime-agnostic: every dependency is injected,
 * so the Durable Object runner and the unit tests drive the same code.
 */
import {
  type CaptureBundle,
  computeStageId,
  type Difficulty,
  type JobEvent,
  type StageData,
  sliceCount,
  validateStage,
} from '@wwm/schema';
import type { ModerateFn, StageBuilder, ValidatePlayableFn } from './builder.ts';
import type { CaptureOutput, Capturer, SliceTexture } from './capture/types.ts';
import { ServiceError, toServiceError } from './errors.ts';
import { computeRunId } from './ids.ts';
import { decodePng } from './image/png.ts';
import type { Logger } from './log.ts';

export interface JobParams {
  jobId: string;
  /** Normalized and policy-checked. */
  url: string;
  difficulty: Difficulty;
  seed: number;
  cacheKey: string;
}

export interface RunRecord {
  runId: string;
  url: string;
  title: string;
  captureId: string;
  sliceCount: number;
  difficulty: Difficulty;
  seed: number;
  builderVersion: string;
  createdAt: string;
}

/** Storage used by the job (R2 + D1 + KV in production, memory in unit tests). */
export interface StageStore {
  putCapture(bundle: CaptureBundle, screenshotPng: Uint8Array): Promise<void>;
  /** Returns the storage key of the texture. */
  putTexture(captureId: string, texture: SliceTexture): Promise<string>;
  putRun(run: RunRecord): Promise<void>;
  putStage(stage: StageData, meta: { runId: string; textureKey: string }): Promise<void>;
  finishRun(
    runId: string,
    info: { status: 'complete' | 'partial'; timingsMs: Record<string, number> },
  ): Promise<void>;
  cacheRun(cacheKey: string, runId: string): Promise<void>;
}

/** Global cap on concurrent browser sessions. `acquire` throws RATE_LIMITED when it can't get a slot. */
export interface BrowserGate {
  acquire(): Promise<() => Promise<void>>;
}

export interface PipelineDeps {
  capturer: Capturer;
  builder: StageBuilder;
  moderate: ModerateFn;
  validatePlayable?: ValidatePlayableFn;
  /** Seeds tried per slice when `validatePlayable` rejects: seed, seed+1, … (default 4, Phase 09's proposal). */
  playableSeeds?: number;
  store: StageStore;
  gate?: BrowserGate;
  log: Logger;
  /** Capture budget from capture start (task 3: 20 s). */
  captureBudgetMs?: number;
  /** Slice-0 budget from capture start (E: 2013 used 30 s). */
  slice0BudgetMs?: number;
  now?: () => Date;
}

export type Emit = (e: JobEvent) => void | Promise<void>;

export const PROGRESS = {
  queued: 0,
  capturing: 5,
  extracting: 30,
  building: 50,
  validating: 70,
  storing: 85,
} as const;

export interface JobResult {
  runId: string;
  stageIds: string[];
  timingsMs: Record<string, number>;
}

function firstErrors(errors: { code: string; message: string }[]): string {
  return errors
    .slice(0, 3)
    .map((e) => `${e.code}: ${e.message}`)
    .join('; ');
}

/**
 * Run a job to completion. Emits `progress` events, then exactly one `done` (after slice 0 is stored) or
 * one `error`. Slices 1…n−1 are built after `done`; a failure there truncates the run (status 'partial')
 * and never emits a second terminal event. Resolves after the last slice; never rejects.
 */
export async function runBuildJob(
  params: JobParams,
  deps: PipelineDeps,
  emit: Emit,
): Promise<JobResult | null> {
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const since = (t: number) => Date.now() - t;
  const captureDeadline = t0 + (deps.captureBudgetMs ?? 20_000);
  const slice0Deadline = t0 + (deps.slice0BudgetMs ?? 30_000);
  const progress = (step: keyof typeof PROGRESS) => emit({ type: 'progress', step, pct: PROGRESS[step] });
  const log = deps.log.child({ jobId: params.jobId, url: params.url });

  let out: CaptureOutput;
  let runId: string;
  const stageIds: string[] = [];
  try {
    await progress('capturing');
    const release = deps.gate ? await deps.gate.acquire() : async () => {};
    const tCap = Date.now();
    try {
      out = await deps.capturer.capture({
        url: params.url,
        deadline: captureDeadline,
        onStep: () => void progress('extracting'),
        ...(deps.now ? { now: deps.now } : {}),
      });
    } finally {
      await release();
    }
    timings.capture = since(tCap);
    for (const [k, v] of Object.entries(out.timingsMs)) timings[`capture.${k}`] = v;
    log.info('captured', {
      capturer: deps.capturer.name,
      ms: timings.capture,
      page: out.bundle.page,
      elements: out.bundle.elements.length,
      requests: out.requests.allowed,
      blocked: out.requests.blocked,
    });

    const shot = out.bundle.screenshot;
    if (
      (await deps.moderate({
        png: out.screenshotPng,
        width: shot.width,
        height: shot.height,
        url: out.bundle.url,
      })) === 'block'
    )
      throw new ServiceError('CAPTURE_BLOCKED', 'this page was blocked by the content filter');

    await progress('building');
    const bundle = out.bundle;
    const count = sliceCount(bundle);
    const builderVersion = deps.builder.version;
    runId = await computeRunId(bundle.captureId, params.seed, builderVersion, params.difficulty);

    // Uploads run while the (synchronous) builder works.
    const uploads = Promise.all([
      deps.store.putCapture(bundle, out.screenshotPng),
      ...out.textures.map((t) => deps.store.putTexture(bundle.captureId, t)),
    ]);
    uploads.catch(() => {}); // awaited below; avoid an unhandled rejection while building
    const tDec = Date.now();
    const image = await decodePng(out.screenshotPng);
    timings.decode = since(tDec);

    /** Build + validate one slice with one seed. Builder errors and invalid stages are fatal (BUILD_FAILED). */
    const buildWithSeed = async (i: number, seed: number): Promise<StageData> => {
      const tB = Date.now();
      let stage: StageData;
      try {
        stage = deps.builder.buildStage({
          capture: bundle,
          image,
          sliceIndex: i,
          seed,
          difficulty: params.difficulty,
        }).stage;
      } catch (e) {
        throw new ServiceError('BUILD_FAILED', `builder failed on slice ${i}: ${(e as Error).message}`);
      }
      timings[`build.${i}`] = (timings[`build.${i}`] ?? 0) + since(tB);
      const tex = out.textures[i];
      if (!tex) throw new ServiceError('BUILD_FAILED', `missing texture for slice ${i}`);
      // the stage ID follows the seed actually used, so a rerolled slice is its own stage
      const stageId = await computeStageId(bundle.captureId, i, seed, builderVersion, params.difficulty);
      if (stage.stageId && stage.stageId !== stageId)
        log.warn('builder stageId differs; using computeStageId', { slice: i });
      stage = {
        ...stage,
        stageId,
        builderVersion,
        texture: { path: `${stageId}/texture`, width: tex.width, height: tex.heightPx, scale: tex.scale },
      };
      const v = validateStage(stage);
      if (!v.ok)
        throw new ServiceError('BUILD_FAILED', `slice ${i} failed validation: ${firstErrors(v.errors)}`);
      return stage;
    };

    const buildSlice = async (i: number): Promise<StageData> => {
      const seeds = deps.validatePlayable ? Math.max(1, deps.playableSeeds ?? 4) : 1;
      const tried: string[] = [];
      const tV = Date.now();
      for (let k = 0; k < seeds; k++) {
        const seed = (params.seed + k) >>> 0;
        const stage = await buildWithSeed(i, seed);
        if (i === 0 && k === 0) await progress('validating');
        if (!deps.validatePlayable) {
          timings[`validate.${i}`] = since(tV);
          return stage;
        }
        const tP = Date.now();
        const p = await deps.validatePlayable(stage);
        timings[`solve.${i}`] = (timings[`solve.${i}`] ?? 0) + since(tP);
        if (p.ok) {
          timings[`validate.${i}`] = since(tV);
          timings[`seeds.${i}`] = k + 1;
          if (p.parTimeSec !== undefined) timings[`par.${i}`] = p.parTimeSec;
          if (p.solveMs !== undefined) timings[`solveMs.${i}`] = p.solveMs; // the accepted seed's solve (solver clock)
          if (k > 0) log.info('slice rerolled to a playable seed', { slice: i, seed, tried });
          return stage;
        }
        tried.push(`seed ${seed}: ${p.reason}`);
      }
      throw new ServiceError('UNPLAYABLE', `slice ${i}: ${tried.join('; ')}`);
    };

    if (Date.now() > slice0Deadline) throw new ServiceError('CAPTURE_TIMEOUT', 'no time left to build');
    const stage0 = await buildSlice(0);
    if (Date.now() > slice0Deadline)
      throw new ServiceError(
        'CAPTURE_TIMEOUT',
        `first stage took longer than ${(deps.slice0BudgetMs ?? 30_000) / 1000} s`,
      );

    await progress('storing');
    const tS = Date.now();
    const textureKeys = await uploads;
    await deps.store.putRun({
      runId,
      url: bundle.url,
      title: bundle.title,
      captureId: bundle.captureId,
      sliceCount: count,
      difficulty: params.difficulty,
      seed: params.seed,
      builderVersion,
      createdAt: (deps.now?.() ?? new Date()).toISOString(),
    });
    await deps.store.putStage(stage0, { runId, textureKey: textureKeys[1] as string });
    await deps.store.cacheRun(params.cacheKey, runId);
    timings.store = since(tS);
    timings.slice0 = since(t0);
    stageIds.push(stage0.stageId);
    log.info('slice 0 ready', { runId, stageId: stage0.stageId, slices: count, timings });
    await emit({ type: 'done', runId, stageIds: [...stageIds] });

    // Background slices (G0): the run grows as they become ready.
    let status: 'complete' | 'partial' = 'complete';
    for (let i = 1; i < count; i++) {
      try {
        const st = await buildSlice(i);
        await deps.store.putStage(st, { runId, textureKey: textureKeys[i + 1] as string });
        stageIds.push(st.stageId);
      } catch (e) {
        status = 'partial';
        log.error('background slice failed; run truncated', {
          runId,
          slice: i,
          error: toServiceError(e).message,
        });
        break;
      }
    }
    timings.total = since(t0);
    await deps.store.finishRun(runId, { status, timingsMs: timings });
    log.info('run finished', { runId, status, stages: stageIds.length, timings });
    return { runId, stageIds, timingsMs: timings };
  } catch (e) {
    const err = toServiceError(e);
    if (stageIds.length > 0) {
      log.error('job failed after done', { error: err.message });
      return null;
    }
    log.warn('job failed', { code: err.code, error: err.message, ms: since(t0) });
    await emit({ type: 'error', code: err.code, message: err.message });
    return null;
  }
}
