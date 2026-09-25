/**
 * Capture/stage API (contracts §7): POST /stages, GET /jobs/:id (SSE), GET /stages/:id, GET
 * /stages/:id/texture, GET /runs/:id, GET /curated. Mounted at `/api` by the router.
 */
import {
  CreateStageRequestSchema,
  type CreateStageResponse,
  type CuratedResponse,
  type RunResponse,
} from '@wwm/schema';
import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app-env.ts';
import { errorResponse, ServiceError } from '../errors.ts';
import { defaultSeed, runCacheKey } from '../ids.ts';
import type { JobParams } from '../pipeline.ts';
import { checkUrl, checkUrlStatic } from '../policy/url-policy.ts';

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** 100 reads / minute / IP via the Rate Limiting binding (task 7). */
export const readLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { success } = await c.env.READ_LIMITER.limit({ key: `read:${c.get('ip')}` });
  if (!success) return errorResponse(new ServiceError('RATE_LIMITED', 'too many requests', 60));
  await next();
};

const notFound = (what: string) => Response.json({ error: `${what} not found` }, { status: 404 });

export const stagesRoutes = new Hono<AppEnv>();
stagesRoutes.use('*', readLimit);

stagesRoutes.post('/stages', async (c) => {
  const t0 = Date.now();
  const { store, policy, builder, settings, log } = c.get('services');
  const body = CreateStageRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success)
    return Response.json(
      { error: 'bad request', message: body.error.issues[0]?.message ?? 'invalid body' },
      { status: 400 },
    );

  const stat = checkUrlStatic(body.data.url, policy);
  if (!stat.ok) return errorResponse(new ServiceError('URL_FORBIDDEN', stat.reason));
  const url = stat.url;
  const difficulty = body.data.difficulty ?? 'normal';
  const seed = body.data.seed ?? defaultSeed(url);
  const cacheKey = runCacheKey(url, difficulty, builder.version, body.data.seed);

  const cachedRunId = await store.cachedRunId(cacheKey);
  if (cachedRunId) {
    const run = await store.getRun(cachedRunId);
    if (run && run.stageIds.length > 0) {
      log.info('cache hit', { url, runId: run.runId, ms: Date.now() - t0 });
      return c.json<CreateStageResponse>({ runId: run.runId, stageIds: run.stageIds }, 200);
    }
  }
  const inflight = await store.inflightJob(cacheKey);
  if (inflight) return c.json<CreateStageResponse>({ jobId: inflight }, 202);

  const full = await checkUrl(url, policy);
  if (!full.ok) return errorResponse(new ServiceError('URL_FORBIDDEN', full.reason));

  const limiter = c.env.LIMITER.get(c.env.LIMITER.idFromName(`build:${c.get('ip')}`));
  const rl = await limiter.hit(settings.buildLimitPerHour, 3600_000);
  if (!rl.ok)
    return errorResponse(
      new ServiceError(
        'RATE_LIMITED',
        `at most ${settings.buildLimitPerHour} new builds per hour`,
        rl.retryAfterSec,
      ),
    );

  const jobId = crypto.randomUUID();
  const params: JobParams = { jobId, url, difficulty, seed, cacheKey };
  await c.env.BUILD_JOB.get(c.env.BUILD_JOB.idFromName(jobId)).start(params);
  await store.setInflightJob(cacheKey, jobId);
  log.info('job queued', { jobId, url, difficulty, seed, ms: Date.now() - t0 });
  return c.json<CreateStageResponse>({ jobId }, 202);
});

stagesRoutes.get('/jobs/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  if (!UUID.test(jobId)) return notFound('job');
  return c.env.BUILD_JOB.get(c.env.BUILD_JOB.idFromName(jobId)).fetch(c.req.raw);
});

stagesRoutes.get('/stages/:stageId', async (c) => {
  const id = c.req.param('stageId');
  if (!HEX64.test(id)) return notFound('stage');
  const obj = await c.get('services').store.getStage(id);
  if (!obj) return notFound('stage');
  return new Response(obj.body, {
    headers: { 'content-type': 'application/json', 'cache-control': IMMUTABLE, etag: obj.httpEtag },
  });
});

stagesRoutes.get('/stages/:stageId/texture', async (c) => {
  const id = c.req.param('stageId');
  if (!HEX64.test(id)) return notFound('texture');
  const obj = await c.get('services').store.getTexture(id);
  if (!obj) return notFound('texture');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/webp',
      'cache-control': IMMUTABLE,
      etag: obj.httpEtag,
    },
  });
});

stagesRoutes.get('/runs/:runId', async (c) => {
  const id = c.req.param('runId');
  if (!HEX64.test(id)) return notFound('run');
  const run = await c.get('services').store.getRun(id);
  if (!run || run.stageIds.length === 0) return notFound('run');
  const body: RunResponse = { runId: run.runId, url: run.url, title: run.title, stageIds: run.stageIds };
  const done = run.status !== 'building';
  return c.json(body, 200, { 'cache-control': done ? 'public, max-age=300' : 'no-store' });
});

stagesRoutes.get('/curated', async (c) => {
  const runs = await c.get('services').store.curated();
  return c.json<CuratedResponse>({ runs }, 200, { 'cache-control': 'public, max-age=300' });
});
