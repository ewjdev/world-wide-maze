/**
 * R2 + D1 + KV storage for runs and stages.
 *
 * R2 layout (content-addressed, so objects are immutable):
 *   captures/<captureId>/capture.json     CaptureBundle (screenshot.path = "screenshot.png")
 *   captures/<captureId>/screenshot.png   1× analysis screenshot the builder decoded
 *   textures/<captureId>/<slice>.webp     DPR-2 slice texture (StageData.texture)
 *   stages/<stageId>.json                 StageData
 * D1: `runs`, `stages` (migrations/0001_runs_stages.sql); Phase 10's `curated` is read if present.
 * KV: `run:<…>` → {runId} (TTL CACHE_TTL_DAYS), `job:<cacheKey>` → jobId (in-flight dedupe, 120 s),
 *     `optout:<domain>` → any value (the domain and its subdomains are never captured).
 */
import type { CaptureBundle, CuratedRun, RunResponse, StageData } from '@wwm/schema';
import type { SliceTexture } from './capture/types.ts';
import type { RunRecord, StageStore } from './pipeline.ts';
import { domainChain } from './policy/url-policy.ts';

export interface StoreBindings {
  STAGES: R2Bucket;
  DB: D1Database;
  CACHE: KVNamespace;
}

export const stageKey = (stageId: string) => `stages/${stageId}.json`;
export const textureKey = (captureId: string, slice: number) => `textures/${captureId}/${slice}.webp`;
export const capturePrefix = (captureId: string) => `captures/${captureId}/`;

const IMMUTABLE = 'public, max-age=31536000, immutable';

export class CloudflareStore implements StageStore {
  constructor(
    private readonly env: StoreBindings,
    private readonly opts: { cacheTtlDays: number },
  ) {}

  // ── writes (StageStore) ────────────────────────────────────────────────────────────────────────────

  async putCapture(bundle: CaptureBundle, screenshotPng: Uint8Array): Promise<void> {
    const p = capturePrefix(bundle.captureId);
    await Promise.all([
      this.env.STAGES.put(`${p}capture.json`, JSON.stringify(bundle), {
        httpMetadata: { contentType: 'application/json' },
      }),
      this.env.STAGES.put(`${p}screenshot.png`, screenshotPng, {
        httpMetadata: { contentType: 'image/png' },
      }),
    ]);
  }

  async putTexture(captureId: string, t: SliceTexture): Promise<string> {
    const key = textureKey(captureId, t.sliceIndex);
    await this.env.STAGES.put(key, t.bytes, {
      httpMetadata: { contentType: t.contentType, cacheControl: IMMUTABLE },
    });
    return key;
  }

  async putRun(run: RunRecord): Promise<void> {
    await this.env.DB.prepare(
      `INSERT OR IGNORE INTO runs (run_id, url, title, capture_id, slice_count, difficulty, seed, builder_version, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(
        run.runId,
        run.url,
        run.title,
        run.captureId,
        run.sliceCount,
        run.difficulty,
        run.seed,
        run.builderVersion,
        run.createdAt,
      )
      .run();
  }

  async putStage(stage: StageData, meta: { runId: string; textureKey: string }): Promise<void> {
    await this.env.STAGES.put(stageKey(stage.stageId), JSON.stringify(stage), {
      httpMetadata: { contentType: 'application/json', cacheControl: IMMUTABLE },
    });
    await this.env.DB.prepare(
      `INSERT OR REPLACE INTO stages (stage_id, run_id, slice_index, url, title, capture_id, builder_version, texture_key,
         islands, bridges, elevators, items, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
      .bind(
        stage.stageId,
        meta.runId,
        stage.source.slice.index,
        stage.source.url,
        stage.source.title,
        stage.source.captureId,
        stage.builderVersion,
        meta.textureKey,
        stage.islands.length,
        stage.bridges.length,
        stage.elevators.length,
        stage.items.length,
        new Date().toISOString(),
      )
      .run();
  }

  async finishRun(
    runId: string,
    info: { status: 'complete' | 'partial'; timingsMs: Record<string, number> },
  ) {
    await this.env.DB.prepare('UPDATE runs SET status = ?2, timings_json = ?3 WHERE run_id = ?1')
      .bind(runId, info.status, JSON.stringify(info.timingsMs))
      .run();
  }

  async cacheRun(cacheKey: string, runId: string): Promise<void> {
    await this.env.CACHE.put(cacheKey, JSON.stringify({ runId }), {
      expirationTtl: Math.max(60, Math.round(this.opts.cacheTtlDays * 86400)),
    });
  }

  // ── reads ──────────────────────────────────────────────────────────────────────────────────────────

  async cachedRunId(cacheKey: string): Promise<string | null> {
    const v = await this.env.CACHE.get<{ runId: string }>(cacheKey, 'json');
    return v?.runId ?? null;
  }

  async inflightJob(cacheKey: string): Promise<string | null> {
    return this.env.CACHE.get(`job:${cacheKey}`);
  }

  async setInflightJob(cacheKey: string, jobId: string): Promise<void> {
    await this.env.CACHE.put(`job:${cacheKey}`, jobId, { expirationTtl: 120 });
  }

  async clearInflightJob(cacheKey: string, jobId: string): Promise<void> {
    // Only our own entry: a newer job for the same key keeps its dedupe.
    if ((await this.env.CACHE.get(`job:${cacheKey}`)) === jobId)
      await this.env.CACHE.delete(`job:${cacheKey}`);
  }

  async isOptedOut(host: string): Promise<boolean> {
    const hits = await Promise.all(domainChain(host).map((d) => this.env.CACHE.get(`optout:${d}`)));
    return hits.some((v) => v !== null);
  }

  /** The run with its stored stages in play order, or null. */
  async getRun(runId: string): Promise<(RunResponse & { sliceCount: number; status: string }) | null> {
    const [run, stages] = await this.env.DB.batch<Record<string, unknown>>([
      this.env.DB.prepare('SELECT url, title, slice_count, status FROM runs WHERE run_id = ?1').bind(runId),
      this.env.DB.prepare('SELECT stage_id FROM stages WHERE run_id = ?1 ORDER BY slice_index').bind(runId),
    ]);
    const r = run?.results[0];
    if (!r) return null;
    return {
      runId,
      url: String(r.url),
      title: String(r.title),
      stageIds: (stages?.results ?? []).map((s) => String(s.stage_id)),
      sliceCount: Number(r.slice_count),
      status: String(r.status),
    };
  }

  getStage(stageId: string): Promise<R2ObjectBody | null> {
    return this.env.STAGES.get(stageKey(stageId));
  }

  async getTexture(stageId: string): Promise<R2ObjectBody | null> {
    const row = await this.env.DB.prepare('SELECT texture_key FROM stages WHERE stage_id = ?1')
      .bind(stageId)
      .first<{ texture_key: string }>();
    return row ? this.env.STAGES.get(row.texture_key) : null;
  }

  /** Phase 10 owns the `curated` table; until it exists the list is empty. */
  async curated(): Promise<CuratedRun[]> {
    try {
      const { results } = await this.env.DB.prepare(
        'SELECT run_id, title, url, thumb, stars FROM curated ORDER BY position, run_id',
      ).all<{ run_id: string; title: string; url: string; thumb: string; stars: number }>();
      return results.map((r) => ({
        runId: r.run_id,
        title: r.title,
        url: r.url,
        thumb: r.thumb,
        stars: Math.max(0, Math.min(5, Math.round(Number(r.stars) || 0))),
      }));
    } catch (e) {
      if (/no such table/i.test(String((e as Error).message))) return [];
      throw e;
    }
  }

  // ── retention (task 9) ─────────────────────────────────────────────────────────────────────────────

  /**
   * Delete runs older than `days` that aren't curated: their stage JSON, textures, capture bundle and D1
   * rows. Bounded per invocation (`limit` runs) so one cron tick stays small; the next tick continues.
   */
  async sweep(days: number, now = new Date(), limit = 200): Promise<{ runs: number; objects: number }> {
    const cutoff = new Date(now.getTime() - days * 86400_000).toISOString();
    const hasCurated = await this.env.DB.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'curated'",
    ).first();
    const sql = hasCurated
      ? 'SELECT run_id, capture_id FROM runs WHERE created_at < ?1 AND run_id NOT IN (SELECT run_id FROM curated) LIMIT ?2'
      : 'SELECT run_id, capture_id FROM runs WHERE created_at < ?1 LIMIT ?2';
    const { results } = await this.env.DB.prepare(sql)
      .bind(cutoff, limit)
      .all<{ run_id: string; capture_id: string }>();
    let objects = 0;
    for (const r of results) {
      // A capture may back several runs (not today, but cheap to respect): keep it if another run uses it.
      const others = await this.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM runs WHERE capture_id = ?1 AND run_id != ?2 AND created_at >= ?3',
      )
        .bind(r.capture_id, r.run_id, cutoff)
        .first<{ n: number }>();
      const { results: stages } = await this.env.DB.prepare('SELECT stage_id FROM stages WHERE run_id = ?1')
        .bind(r.run_id)
        .all<{ stage_id: string }>();
      const keys = stages.map((s) => stageKey(s.stage_id));
      if (!others?.n) {
        const listed = await this.env.STAGES.list({ prefix: capturePrefix(r.capture_id) });
        keys.push(...listed.objects.map((o) => o.key));
        const tex = await this.env.STAGES.list({ prefix: `textures/${r.capture_id}/` });
        keys.push(...tex.objects.map((o) => o.key));
      }
      if (keys.length) await this.env.STAGES.delete(keys);
      objects += keys.length;
      await this.env.DB.batch([
        this.env.DB.prepare('DELETE FROM stages WHERE run_id = ?1').bind(r.run_id),
        this.env.DB.prepare('DELETE FROM runs WHERE run_id = ?1').bind(r.run_id),
      ]);
    }
    return { runs: results.length, objects };
  }
}
