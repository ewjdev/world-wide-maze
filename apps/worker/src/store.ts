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
import { type BudgetEnv, reserveWrite } from './budget-client.ts';
import type { SliceTexture } from './capture/types.ts';
import { Catalog } from './catalog.ts';
import type { RunRecord, StageStore } from './pipeline.ts';

export interface StoreBindings extends Partial<BudgetEnv> {
  STAGES: R2Bucket;
  DB: D1Database;
  CACHE: KVNamespace;
}

export const stageKey = (stageId: string) => `stages/${stageId}.json`;
export const textureKey = (captureId: string, slice: number) => `textures/${captureId}/${slice}.webp`;
export const capturePrefix = (captureId: string) => `captures/${captureId}/`;

const IMMUTABLE = 'public, max-age=31536000, immutable';

export class CloudflareStore implements StageStore {
  readonly catalog: Catalog;
  constructor(
    private readonly env: StoreBindings,
    private readonly opts: { cacheTtlDays: number },
  ) {
    this.catalog = new Catalog(env);
  }

  private async reserveBytes(bytes: number) {
    // Plain storage adapters in unit tests have no environment; deployed services always do.
    if (this.env.WWM_ENV !== undefined) await reserveWrite(this.env as StoreBindings & BudgetEnv, bytes);
  }

  // ── writes (StageStore) ────────────────────────────────────────────────────────────────────────────

  async putCapture(bundle: CaptureBundle, screenshotPng: Uint8Array): Promise<void> {
    const p = capturePrefix(bundle.captureId);
    await this.reserveBytes(
      new TextEncoder().encode(JSON.stringify(bundle)).byteLength + screenshotPng.byteLength,
    );
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
    await this.reserveBytes(t.bytes.byteLength);
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
    await this.reserveBytes(new TextEncoder().encode(JSON.stringify(stage)).byteLength);
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

  async recordAttempt(input: Parameters<NonNullable<StageStore['recordAttempt']>>[0]): Promise<void> {
    await this.catalog.recordAttempt(input);
  }

  async recordModeration(input: Parameters<NonNullable<StageStore['recordModeration']>>[0]): Promise<void> {
    await this.catalog.recordRun(input);
  }

  canPublishRun(runId: string): Promise<boolean> {
    return this.catalog.canServeRun(runId);
  }

  async cacheRun(cacheKey: string, runId: string): Promise<void> {
    if (!(await this.catalog.canServeRun(runId))) return;
    if (!(await this.catalog.publishVariant(cacheKey, runId))) return;
    await this.env.CACHE.put(cacheKey, JSON.stringify({ runId }), {
      expirationTtl: Math.max(60, Math.round(this.opts.cacheTtlDays * 86400)),
    });
  }

  // ── reads ──────────────────────────────────────────────────────────────────────────────────────────

  async cachedRunId(
    cacheKey: string,
    legacy?: { url: string; difficulty: string; seed: number; builderVersion: string },
  ): Promise<string | null> {
    const v = await this.env.CACHE.get<{ runId: string }>(cacheKey, 'json');
    if (v?.runId && (await this.catalog.canServeRun(v.runId))) {
      const { results } = await this.env.DB.prepare('SELECT stage_id,texture_key FROM stages WHERE run_id=?')
        .bind(v.runId)
        .all<{ stage_id: string; texture_key: string }>();
      const objects = await Promise.all(
        results.flatMap((s) => [
          this.env.STAGES.head(stageKey(s.stage_id)),
          this.env.STAGES.head(s.texture_key),
        ]),
      );
      if (results.length && objects.every(Boolean)) return v.runId;
      await this.env.CACHE.delete(cacheKey);
    }
    const runId = await this.catalog.resolveVariant(cacheKey, legacy);
    if (runId) await this.cacheRun(cacheKey, runId);
    return runId;
  }

  async inflightJob(cacheKey: string): Promise<string | null> {
    return this.env.CACHE.get(`job:${cacheKey}`);
  }

  async setInflightJob(cacheKey: string, jobId: string): Promise<void> {
    await this.env.CACHE.put(`job:${cacheKey}`, jobId, { expirationTtl: 120 });
  }

  async clearInflightJob(cacheKey: string, jobId: string): Promise<void> {
    await this.catalog.clearBuildClaim(cacheKey, jobId);
    // Only our own entry: a newer job for the same key keeps its dedupe.
    if ((await this.env.CACHE.get(`job:${cacheKey}`)) === jobId)
      await this.env.CACHE.delete(`job:${cacheKey}`);
  }

  async isOptedOut(host: string): Promise<boolean> {
    return this.catalog.isHostBlocked(host);
  }

  /** The run with its stored stages in play order, or null. */
  async getRun(runId: string): Promise<(RunResponse & { sliceCount: number; status: string }) | null> {
    if (!(await this.catalog.canServeRun(runId))) return null;
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

  async getStage(stageId: string): Promise<R2ObjectBody | null> {
    if (!(await this.catalog.canServeStage(stageId))) return null;
    return this.env.STAGES.get(stageKey(stageId));
  }

  async getTexture(stageId: string): Promise<R2ObjectBody | null> {
    if (!(await this.catalog.canServeStage(stageId))) return null;
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
      const permitted = await Promise.all(
        results.map(async (r) => ((await this.catalog.canServeRun(r.run_id)) ? r : null)),
      );
      return permitted
        .filter((r) => r !== null)
        .map((r) => ({
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
   * Expire artifacts for runs older than `days` that aren't curated: their stage JSON, textures, capture bundle. Preserve D1 catalog and review history. Pending evidence expires after seven days. Bounded per invocation (`limit` runs) so one cron tick stays small; the next tick continues.
   */
  async sweep(days: number, now = new Date(), limit = 200): Promise<{ runs: number }> {
    const cutoff = new Date(now.getTime() - days * 86400_000).toISOString();
    const reviewCutoff = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const { results } = await this.env.DB.prepare(`SELECT r.run_id FROM runs r
      JOIN moderation_cases m ON m.run_id=r.run_id
      WHERE m.deletion_pending=1 OR (m.artifacts_available=1 AND r.run_id NOT IN (SELECT run_id FROM curated)
      AND ((m.status='approved' AND r.created_at<?1) OR (m.status!='approved' AND r.created_at<?2)))
      ORDER BY r.created_at LIMIT ?3`)
      .bind(cutoff, reviewCutoff, limit)
      .all<{ run_id: string }>();
    for (const r of results) await this.catalog.expireArtifacts(r.run_id);
    return { runs: results.length };
  }
}
