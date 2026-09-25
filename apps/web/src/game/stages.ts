/**
 * Where stages come from. A "run" is one page: its slices are played in order (E: "Next stage").
 *
 * - `PracticeRun`: fixtures/stages/handmade-simple (the E "Practice site", a tiny built-in stage).
 * - `FixtureRun`: a fixtures/captures page, built client-side by @wwm/stage-builder in a Web Worker. This is
 *   the offline / preservation path: it needs no server.
 * - `ApiRun`: the capture service (contracts §7): `POST /api/stages` → SSE → `done {runId, stageIds}` after
 *   slice 0; later slices appear on `GET /api/runs/:id`. Textures resolve relative to the stage URL.
 */
import {
  type ApiErrorCode,
  type CaptureBundle,
  type CreateStageResponse,
  computeRunId,
  isApiErrorCode,
  type RunResponse,
  type StageData,
  sliceCount,
} from '@wwm/schema';
import handmadeJson from '../../../../fixtures/stages/handmade-simple.json';
import handmadePng from '../../../../fixtures/stages/handmade-simple.png?url';
import type { BuildReply, BuildRequest } from './builder.worker.ts';
import { type CatalogEntry, catalogEntry, PRACTICE } from './catalog.ts';

export type LoadErrorCode = ApiErrorCode | 'NETWORK' | 'NOT_FOUND';

export class StageLoadError extends Error {
  constructor(
    readonly code: LoadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StageLoadError';
  }
}

/** A progress step; `step` is a key of `building.step` in the i18n tables. */
export interface LoadProgress {
  step: string;
  pct: number;
}

export interface LoadedStage {
  stage: StageData;
  image: ImageBitmap;
  /** Share / deep-link reference for this slice (`/play/<ref>`). */
  ref: string;
}

export interface RunSource {
  readonly kind: 'practice' | 'fixture' | 'api';
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** Best-known number of slices (API runs learn it from slice 0). */
  sliceCount(): number;
  loadSlice(index: number, onProgress: (p: LoadProgress) => void, signal?: AbortSignal): Promise<LoadedStage>;
}

async function bitmapFrom(
  url: string,
  crop?: { x: number; y: number; w: number; h: number },
): Promise<ImageBitmap> {
  const r = await fetch(url);
  if (!r.ok) throw new StageLoadError(r.status === 404 ? 'NOT_FOUND' : 'NETWORK', `texture ${r.status}`);
  const blob = await r.blob();
  return crop ? createImageBitmap(blob, crop.x, crop.y, crop.w, crop.h) : createImageBitmap(blob);
}

// ── practice ────────────────────────────────────────────────────────────────────────────────────────────

export class PracticeRun implements RunSource {
  readonly kind = 'practice' as const;
  readonly id = PRACTICE.id;
  readonly title = PRACTICE.title;
  readonly url = PRACTICE.url;
  sliceCount() {
    return 1;
  }
  async loadSlice(_i: number, onProgress: (p: LoadProgress) => void): Promise<LoadedStage> {
    onProgress({ step: 'texture', pct: 60 });
    const stage = handmadeJson as unknown as StageData;
    return { stage, image: await bitmapFrom(handmadePng), ref: this.id };
  }
}

// ── fixtures (offline) ──────────────────────────────────────────────────────────────────────────────────

// Internal-only fixtures (bbc-news-grid: © BBC photos) are excluded from the bundle.
const captureJson = import.meta.glob<{ default: CaptureBundle }>([
  '../../../../fixtures/captures/*/capture.json',
  '!../../../../fixtures/captures/bbc-news-grid/**',
]);
const screenshotUrl = import.meta.glob<string>(
  ['../../../../fixtures/captures/*/screenshot.png', '!../../../../fixtures/captures/bbc-news-grid/**'],
  {
    query: '?url',
    import: 'default',
  },
);

/** One lazily created builder worker per `StageBuilderPool` (owned by the Game). */
export class StageBuilderPool {
  #worker: Worker | null = null;
  #next = 1;
  #waiting = new Map<number, (r: BuildReply) => void>();

  build(req: Omit<BuildRequest, 'id'>): Promise<StageData> {
    if (!this.#worker) {
      this.#worker = new Worker(new URL('./builder.worker.ts', import.meta.url), {
        type: 'module',
        name: 'wwm-builder',
      });
      this.#worker.onmessage = (e: MessageEvent<BuildReply>) => {
        const w = this.#waiting.get(e.data.id);
        this.#waiting.delete(e.data.id);
        w?.(e.data);
      };
    }
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#waiting.set(id, (r) =>
        r.ok ? resolve(r.stage) : reject(new StageLoadError('BUILD_FAILED', r.error)),
      );
      this.#worker?.postMessage({ ...req, id } satisfies BuildRequest);
    });
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
    this.#waiting.clear();
  }
}

export class FixtureRun implements RunSource {
  readonly kind = 'fixture' as const;
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly #entry: CatalogEntry;
  readonly #pool: StageBuilderPool;
  #capture: Promise<{ capture: CaptureBundle; shot: string }> | null = null;

  constructor(entry: CatalogEntry, pool: StageBuilderPool) {
    this.#entry = entry;
    this.#pool = pool;
    this.id = entry.id;
    this.title = entry.title;
    this.url = entry.url;
  }

  sliceCount() {
    return sliceCount({ page: { width: 1280, height: this.#entry.pageHeight } });
  }

  #load() {
    this.#capture ??= (async () => {
      const base = `../../../../fixtures/captures/${this.#entry.slug}/`;
      const j = captureJson[`${base}capture.json`];
      const s = screenshotUrl[`${base}screenshot.png`];
      if (!j || !s) throw new StageLoadError('NOT_FOUND', `fixture ${this.#entry.slug} missing`);
      return { capture: (await j()).default, shot: await s() };
    })();
    return this.#capture;
  }

  async loadSlice(index: number, onProgress: (p: LoadProgress) => void): Promise<LoadedStage> {
    onProgress({ step: 'extracting', pct: 10 });
    const { capture, shot } = await this.#load();
    onProgress({ step: 'building', pct: 30 });
    const stage = await this.#pool.build({
      capture,
      screenshotUrl: shot,
      sliceIndex: index,
      seed: 1,
      difficulty: 'normal',
    });
    onProgress({ step: 'texture', pct: 70 });
    const sc = capture.screenshot.scale;
    const { y, height } = stage.source.slice;
    const image = await bitmapFrom(shot, {
      x: 0,
      y: Math.round(y * sc),
      w: Math.round(stage.size.width * sc),
      h: Math.round(height * sc),
    });
    const ref = index === 0 ? this.id : `${this.id}~${index}`;
    return { stage, image, ref };
  }
}

// ── capture service ─────────────────────────────────────────────────────────────────────────────────────

async function apiError(r: Response): Promise<StageLoadError> {
  try {
    const j = (await r.json()) as { code?: string; message?: string };
    if (j.code && isApiErrorCode(j.code)) return new StageLoadError(j.code, j.message ?? j.code);
  } catch {
    // not JSON
  }
  if (r.status === 404) return new StageLoadError('NOT_FOUND', `HTTP 404`);
  if (r.status === 429) return new StageLoadError('RATE_LIMITED', 'HTTP 429');
  return new StageLoadError('NETWORK', `HTTP ${r.status}`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (e) {
    throw new StageLoadError('NETWORK', String(e));
  }
  if (!r.ok) throw await apiError(r);
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('json')) throw new StageLoadError('NETWORK', `unexpected ${ct || 'response'}`);
  return (await r.json()) as T;
}

/** Normalize what a player types into an http(s) URL, or null if it can't be one. */
export function normalizeInputUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export class ApiRun implements RunSource {
  readonly kind = 'api' as const;
  readonly id: string;
  title: string;
  url: string;
  #stageIds: string[];
  #count: number;
  readonly #origin: string;

  constructor(origin: string, run: { runId: string; stageIds: string[]; title?: string; url?: string }) {
    this.#origin = origin;
    this.id = run.runId;
    this.#stageIds = [...run.stageIds];
    this.#count = Math.max(1, run.stageIds.length);
    this.title = run.title ?? '';
    this.url = run.url ?? '';
  }

  sliceCount() {
    return this.#count;
  }

  async #stageId(i: number, signal?: AbortSignal): Promise<string> {
    const deadline = Date.now() + 60_000;
    while (!this.#stageIds[i]) {
      if (signal?.aborted) throw new StageLoadError('NETWORK', 'aborted');
      if (Date.now() > deadline) throw new StageLoadError('BUILD_FAILED', `slice ${i} never arrived`);
      const run = await fetchJson<RunResponse>(`${this.#origin}/api/runs/${this.id}`);
      this.#stageIds = run.stageIds;
      if (!this.#stageIds[i]) await new Promise((r) => setTimeout(r, 1000));
    }
    return this.#stageIds[i] as string;
  }

  async loadSlice(
    i: number,
    onProgress: (p: LoadProgress) => void,
    signal?: AbortSignal,
  ): Promise<LoadedStage> {
    onProgress({ step: i === 0 ? 'storing' : 'building', pct: 80 });
    const id = await this.#stageId(i, signal);
    const stageUrl = `${this.#origin}/api/stages/${id}`;
    const stage = await fetchJson<StageData>(stageUrl);
    this.#count = stage.source.slice.count;
    if (!this.title) this.title = stage.source.title;
    if (!this.url) this.url = stage.source.url;
    onProgress({ step: 'texture', pct: 90 });
    const tex = new URL(stage.texture.path, new URL(stageUrl, location.href)).toString();
    return { stage, image: await bitmapFrom(tex), ref: id };
  }
}

/**
 * `POST /api/stages` and follow the job's SSE stream until slice 0 is ready. Resolves with the run.
 */
export async function createApiRun(
  origin: string,
  url: string,
  onProgress: (p: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<ApiRun> {
  onProgress({ step: 'queued', pct: 2 });
  const res = await fetchJson<CreateStageResponse>(`${origin}/api/stages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
  const done =
    'runId' in res
      ? res
      : await new Promise<{ runId: string; stageIds: string[] }>((resolve, reject) => {
          const es = new EventSource(`${origin}/api/jobs/${res.jobId}`);
          const close = () => es.close();
          signal?.addEventListener('abort', () => {
            close();
            reject(new StageLoadError('NETWORK', 'aborted'));
          });
          es.addEventListener('progress', (e) => {
            const d = JSON.parse((e as MessageEvent<string>).data) as { step: string; pct: number };
            onProgress({ step: d.step, pct: Math.min(78, d.pct) });
          });
          es.addEventListener('done', (e) => {
            close();
            resolve(JSON.parse((e as MessageEvent<string>).data) as { runId: string; stageIds: string[] });
          });
          es.addEventListener('error', (e) => {
            const data = (e as MessageEvent<string>).data;
            close();
            if (data) {
              const d = JSON.parse(data) as { code: string; message: string };
              reject(
                new StageLoadError(isApiErrorCode(d.code) ? d.code : 'BUILD_FAILED', d.message ?? d.code),
              );
            } else reject(new StageLoadError('NETWORK', 'build stream lost'));
          });
        });
  let meta: Partial<RunResponse> = {};
  try {
    meta = await fetchJson<RunResponse>(`${origin}/api/runs/${done.runId}`);
  } catch {
    // the run record is optional here; slice 0 carries the title too
  }
  return new ApiRun(origin, { ...done, title: meta.title, url: meta.url ?? url });
}

/**
 * Resolve a `/play/:stageId` deep link: a catalog id (`practice`, `fixture-<slug>[~<slice>]`) or a service
 * stage id. For a service stage, the run is found through `computeRunId` so later slices still follow.
 */
export async function runFromRef(
  ref: string,
  origin: string,
  pool: StageBuilderPool,
): Promise<{ run: RunSource; slice: number }> {
  const [base, sliceStr] = ref.split('~') as [string, string | undefined];
  const slice = sliceStr ? Math.max(0, Number.parseInt(sliceStr, 10) || 0) : 0;
  const entry = catalogEntry(base);
  if (entry) return { run: entry === PRACTICE ? new PracticeRun() : new FixtureRun(entry, pool), slice };
  if (!/^[0-9a-f]{16,64}$/i.test(base)) throw new StageLoadError('NOT_FOUND', ref);
  const stage = await fetchJson<StageData>(`${origin}/api/stages/${base}`);
  const runId = await computeRunId(
    stage.source.captureId,
    stage.seed,
    stage.builderVersion,
    stage.difficulty,
  );
  try {
    const r = await fetchJson<RunResponse>(`${origin}/api/runs/${runId}`);
    return { run: new ApiRun(origin, r), slice: Math.max(0, r.stageIds.indexOf(base)) };
  } catch {
    return {
      run: new ApiRun(origin, { runId, stageIds: [base], title: stage.source.title, url: stage.source.url }),
      slice: 0,
    };
  }
}
