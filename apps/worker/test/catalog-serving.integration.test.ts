import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StageData } from '@wwm/schema';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestHarness } from 'wrangler';
import { defaultStageBuilder } from '../src/builder.ts';
import { Catalog } from '../src/catalog.ts';
import { defaultSeed, runCacheKey } from '../src/ids.ts';
import { seedApprovedStage } from './helpers/approved-stage.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(root, 'fixtures/stages/handmade-simple.json'), 'utf8'),
) as StageData;
const url = 'https://catalog.example.org/page';
const stage: StageData = {
  ...fixture,
  stageId: 'e'.repeat(64),
  builderVersion: defaultStageBuilder().version,
  seed: defaultSeed(url),
  source: { ...fixture.source, url, title: 'Catalog sample', captureId: 'catalog-test' },
};

describe('catalog serving boundaries (real workerd + D1/R2/KV)', { timeout: 30_000 }, () => {
  const server = createTestHarness();
  let env: Env;
  let catalog: Catalog;
  let key: string;
  let seq = 1;
  const request = (
    path: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ) =>
    server.fetch(`http://localhost${path}`, {
      ...init,
      headers: {
        'cf-connecting-ip': `198.51.100.${seq++}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  const post = () => request('/api/stages', { method: 'POST', body: JSON.stringify({ url }) });
  beforeAll(async () => {
    await server.update({ workers: [{ configPath: resolve(root, 'apps/worker/wrangler.jsonc') }] });
    await server.listen();
    const worker = server.getWorker<Env>();
    await worker.applyD1Migrations('DB');
    env = await worker.getEnv();
    catalog = new Catalog(env);
    await seedApprovedStage(env, stage);
    key = await runCacheKey(url, 'normal', stage.builderVersion);
    await catalog.publishVariant(key, stage.stageId);
  }, 120_000);
  afterAll(() => server.close());

  test('KV loss falls back to D1 and repopulates the same approved variant without capture', async () => {
    await env.CACHE.delete(key);
    // If the route attempts a browser capture it will be refused, proving cache reuse structurally.
    await env.CACHE.put('kill:capture', 'test');
    const t = performance.now();
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: stage.stageId, stageIds: [stage.stageId] });
    expect(await env.CACHE.get(key, 'json')).toEqual({ runId: stage.stageId });
    console.info(`[catalog] D1 fallback ${Math.round(performance.now() - t)}ms; browser capture disabled`);
    await env.CACHE.delete('kill:capture');
  });
  test('approved artifact responses cannot bypass later review via immutable caching', async () => {
    for (const path of [
      `/api/runs/${stage.stageId}`,
      `/api/stages/${stage.stageId}`,
      `/api/stages/${stage.stageId}/texture`,
      `/api/scores/stage/${stage.stageId}`,
    ]) {
      const res = await request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('cache-control')).toContain('no-store');
    }
  });
  test('normalized internal artifact cache avoids R2 and still requires authorization', async () => {
    const path = `/api/stages/${stage.stageId}`;
    await request(path);
    const hit = await request(`${path}?cache-bust=ignored`);
    expect(hit.headers.get('x-artifact-cache')).toBe('hit');
    expect(hit.headers.get('cache-control')).toContain('no-store');
    await env.STAGES.delete(`stages/${stage.stageId}.json`);
    expect((await request(path)).status).toBe(200);
    await env.STAGES.put(`stages/${stage.stageId}.json`, JSON.stringify(stage));
  });
  test('domain block overrides a warm KV entry and every direct-ID surface', async () => {
    await catalog.setRule('domain', 'example.org', true, 'Fixture block', 'operator@example.org');
    expect((await post()).status).toBe(400);
    for (const path of [
      `/api/runs/${stage.stageId}`,
      `/api/stages/${stage.stageId}`,
      `/api/stages/${stage.stageId}/texture`,
      `/api/scores/stage/${stage.stageId}`,
      `/api/scores/stage/${stage.stageId}/ghost`,
      `/s/${stage.stageId}`,
      `/api/share/${stage.stageId}/card`,
      `/api/cards/stage/${stage.stageId}.png`,
    ]) {
      expect((await request(path)).status, path).toBe(404);
    }
    await catalog.setRule('domain', 'example.org', false, 'Fixture clear', 'operator@example.org');
    expect((await post()).status).toBe(200);
  });
  test('review withdrawal hides existing direct links and approval restores them', async () => {
    await catalog.decide(stage.stageId, 'pending_review', 'Needs review', 'operator@example.org');
    expect((await request(`/api/stages/${stage.stageId}`)).status).toBe(404);
    expect((await post()).status).toBe(422);
    await catalog.decide(stage.stageId, 'approved', 'Reviewed', 'operator@example.org');
    expect((await post()).status).toBe(200);
  });
  test('admin endpoints fail closed when operator identity is not configured', async () => {
    for (const path of [
      '/api/admin/session',
      '/api/admin/catalog',
      `/api/admin/runs/${stage.stageId}/evidence/screenshot`,
    ]) {
      const res = await request(path);
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toContain('no-store');
    }
    const res = await request(`/api/admin/runs/${stage.stageId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ status: 'approved', reason: 'forged' }),
    });
    expect(res.status).toBe(503);
  });
  test('concurrent build claims admit one job and preserve newer claims', async () => {
    const claimKey = 'test:concurrent';
    const ids = await Promise.all(
      Array.from({ length: 12 }, (_, i) => catalog.claimBuild(claimKey, `job-${i}`)),
    );
    expect(new Set(ids).size).toBe(1);
    await catalog.clearBuildClaim(claimKey, 'wrong-owner');
    expect(await catalog.claimBuild(claimKey, 'another')).toBe(ids[0]);
    await catalog.clearBuildClaim(claimKey, ids[0] as string);
    expect(await catalog.claimBuild(claimKey, 'new-owner')).toBe('new-owner');
  });
});
