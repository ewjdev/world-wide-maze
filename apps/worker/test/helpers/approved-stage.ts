import type { StageData } from '@wwm/schema';
import { Catalog } from '../../src/catalog.ts';

/** Seed an explicitly reviewed server stage. Tests never bypass the production serve gate. */
export async function seedApprovedStage(env: Pick<Env, 'DB' | 'STAGES' | 'CACHE'>, stage: StageData) {
  const runId = stage.stageId;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR REPLACE INTO runs
    (run_id,url,title,capture_id,slice_count,difficulty,seed,builder_version,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      runId,
      stage.source.url,
      stage.source.title,
      stage.source.captureId,
      1,
      stage.difficulty,
      stage.seed,
      stage.builderVersion,
      'complete',
      now,
    )
    .run();
  await env.DB.prepare(`INSERT OR REPLACE INTO stages
    (stage_id,run_id,slice_index,url,title,capture_id,builder_version,texture_key,islands,bridges,elevators,items,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      stage.stageId,
      runId,
      0,
      stage.source.url,
      stage.source.title,
      stage.source.captureId,
      stage.builderVersion,
      `textures/${stage.source.captureId}/0.webp`,
      stage.islands.length,
      stage.bridges.length,
      stage.elevators.length,
      stage.items.length,
      now,
    )
    .run();
  await env.STAGES.put(`stages/${stage.stageId}.json`, JSON.stringify(stage));
  await env.STAGES.put(`textures/${stage.source.captureId}/0.webp`, new Uint8Array([1, 2, 3]));
  await new Catalog(env).recordRun({
    runId,
    url: stage.source.url,
    cacheKey: null,
    status: 'approved',
    reason: 'Reviewed test fixture',
    provider: 'human',
    policyVersion: 'test',
    captureId: stage.source.captureId,
  });
  return runId;
}
