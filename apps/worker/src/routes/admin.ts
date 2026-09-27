import type { Difficulty, ModerationStatus } from '@wwm/schema';
import { Hono } from 'hono';
import { type AdminAuthConfig, authenticateAdmin } from '../admin-auth.ts';
import type { AppEnv } from '../app-env.ts';
import { Catalog, CatalogInputError } from '../catalog.ts';
import { runCacheKey } from '../ids.ts';
import { checkUrl } from '../policy/url-policy.ts';
import { BodyTooLargeError, readJsonCapped } from '../security.ts';
import { jevAdminRoutes } from './admin-jev.ts';

export type AdminEnv = {
  Bindings: AppEnv['Bindings'] & AdminAuthConfig;
  Variables: AppEnv['Variables'] & { adminEmail: string };
};
export const adminRoutes = new Hono<AdminEnv>();
adminRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!c.env.ADMIN_ACCESS_TEAM_DOMAIN || !c.env.ADMIN_ACCESS_AUD || !c.env.ADMIN_EMAILS)
    return c.json({ error: 'Admin access is not configured' }, 503);
  const identity = await authenticateAdmin(c.req.raw, c.env);
  if (!identity) return c.json({ error: 'Operator authentication required' }, 401);
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('sec-fetch-site') === 'cross-site')
      return c.json({ error: 'Same-origin request required' }, 403);
  }
  c.set('adminEmail', identity.email);
  await next();
});
adminRoutes.onError((err, c) => {
  if (err instanceof BodyTooLargeError) return c.json({ error: 'Request body too large' }, 413);
  if (err instanceof SyntaxError) return c.json({ error: 'Invalid request' }, 400);
  if (err instanceof CatalogInputError) return c.json({ error: err.message }, 400);
  return c.json({ error: 'Admin operation failed' }, 500);
});
const catalog = (env: AppEnv['Bindings']) => new Catalog(env);
async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await readJsonCapped(request, 4096);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CatalogInputError('Object required');
  return value as Record<string, unknown>;
}
function reason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000)
    throw new CatalogInputError('A reason of 1–1000 characters is required');
  return value.trim();
}
adminRoutes.get('/session', (c) => c.json({ email: c.get('adminEmail') }));
adminRoutes.get('/catalog', async (c) =>
  c.json(
    await catalog(c.env).list({
      q: c.req.query('q'),
      status: c.req.query('status'),
      cursor: c.req.query('cursor'),
      limit: Number(c.req.query('limit')) || 30,
    }),
  ),
);
adminRoutes.get('/attempts', async (c) =>
  c.json(
    await catalog(c.env).attempts({
      q: c.req.query('q'),
      cursor: c.req.query('cursor'),
      limit: Number(c.req.query('limit')) || 30,
    }),
  ),
);
adminRoutes.get('/rules', async (c) => c.json({ items: await catalog(c.env).rules() }));
adminRoutes.get('/runs/:runId', async (c) => {
  const detail = await catalog(c.env).detail(c.req.param('runId'));
  return detail ? c.json(detail) : c.json({ error: 'Run not found' }, 404);
});
adminRoutes.get('/runs/:runId/evidence/:evidence', async (c) => {
  const runId = c.req.param('runId'),
    evidence = c.req.param('evidence');
  const run = await c.env.DB.prepare(
    'SELECT capture_id,artifacts_available FROM moderation_cases WHERE run_id=?',
  )
    .bind(runId)
    .first<{ capture_id: string; artifacts_available: number }>();
  if (!run?.artifacts_available) return c.json({ error: 'Evidence unavailable' }, 404);
  let key = `captures/${run.capture_id}/screenshot.png`;
  if (/^texture-\d+$/.test(evidence)) {
    key = `textures/${run.capture_id}/${Number(evidence.slice(8))}.webp`;
  } else if (evidence !== 'screenshot') {
    const stage = await c.env.DB.prepare('SELECT texture_key FROM stages WHERE run_id=? AND stage_id=?')
      .bind(runId, evidence)
      .first<{ texture_key: string }>();
    if (!stage) return c.json({ error: 'Evidence unavailable' }, 404);
    key = stage.texture_key;
  }
  const object = await c.env.STAGES.get(key);
  if (!object) return c.json({ error: 'Evidence unavailable' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type':
        object.httpMetadata?.contentType ?? (evidence === 'screenshot' ? 'image/png' : 'image/webp'),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
});
adminRoutes.post('/runs/:runId/decision', async (c) => {
  const input = await body(c.req.raw);
  if (!['approved', 'blocked', 'pending_review'].includes(String(input.status)))
    return c.json({ error: 'Invalid review decision' }, 400);
  await catalog(c.env).decide(
    c.req.param('runId'),
    input.status as ModerationStatus,
    reason(input.reason),
    c.get('adminEmail'),
  );
  return c.json({ ok: true });
});
adminRoutes.post('/rules', async (c) => {
  const input = await body(c.req.raw);
  if (
    (input.scope !== 'url' && input.scope !== 'domain') ||
    typeof input.target !== 'string' ||
    input.target.length > 2048 ||
    typeof input.blocked !== 'boolean'
  )
    return c.json({ error: 'Invalid rule' }, 400);
  if (input.scope === 'domain' && !/^[a-z0-9.-]+$/i.test(input.target))
    return c.json({ error: 'Use a domain name without a path' }, 400);
  await catalog(c.env).setRule(
    input.scope,
    input.target,
    input.blocked,
    reason(input.reason),
    c.get('adminEmail'),
  );
  return c.json({ ok: true });
});
adminRoutes.post('/runs/:runId/remove', async (c) => {
  const input = await body(c.req.raw);
  await catalog(c.env).removeArtifacts(c.req.param('runId'), reason(input.reason), c.get('adminEmail'));
  return c.json({ ok: true });
});
adminRoutes.post('/runs/:runId/refresh', async (c) => {
  const input = await body(c.req.raw),
    why = reason(input.reason),
    runId = c.req.param('runId');
  const cat = catalog(c.env);
  const run = await c.env.DB.prepare(`SELECT r.url,r.difficulty,r.seed,m.cache_key,m.submitted_url FROM runs r
    JOIN moderation_cases m ON m.run_id=r.run_id WHERE r.run_id=?`)
    .bind(runId)
    .first<{
      url: string;
      difficulty: Difficulty;
      seed: number;
      cache_key: string | null;
      submitted_url: string | null;
    }>();
  if (!run) return c.json({ error: 'Run not found' }, 404);
  const url = run.submitted_url ?? run.url;
  if ((await cat.isUrlBlocked(url)) || (await cat.isUrlBlocked(run.url)))
    return c.json({ error: 'Clear URL/domain block before refreshing' }, 409);
  if (c.env.CAPTURE_ENABLED === '0' || (await c.env.CACHE.get('kill:capture')) !== null)
    return c.json({ error: 'Captures are paused' }, 503);
  const { policy, settings, builder } = c.get('services');
  const checked = await checkUrl(url, policy);
  if (!checked.ok) return c.json({ error: 'URL is not eligible for capture' }, 400);
  const cacheKey = await runCacheKey(url, run.difficulty, builder.version, run.seed);
  const jobId = crypto.randomUUID(),
    owner = await cat.claimBuild(cacheKey, jobId);
  if (owner !== jobId) return c.json({ jobId: owner }, 202);
  try {
    const perAdmin = await c.env.LIMITER.get(
      c.env.LIMITER.idFromName(`build:admin:${c.get('adminEmail')}`),
    ).hit(settings.buildLimitPerHour, 3600_000);
    const global = await c.env.LIMITER.get(c.env.LIMITER.idFromName('build:global')).hit(
      settings.globalBuildLimitPerHour,
      3600_000,
    );
    if (!perAdmin.ok || !global.ok) {
      await cat.clearBuildClaim(cacheKey, jobId);
      return c.json({ error: 'Build limit reached' }, 429);
    }
    await cat.requestRefresh(runId, why, c.get('adminEmail'));
    await cat.recordAttempt({ jobId, url, status: 'queued', reason: 'Operator requested refresh' });
    await c.env.BUILD_JOB.get(c.env.BUILD_JOB.idFromName(jobId)).start({
      jobId,
      url,
      difficulty: run.difficulty,
      seed: run.seed,
      cacheKey,
    });
    return c.json({ jobId }, 202);
  } catch (err) {
    await cat
      .recordAttempt({ jobId, url, status: 'failed', reason: 'Operator refresh could not be queued' })
      .catch(() => {});
    await cat.clearBuildClaim(cacheKey, jobId);
    throw err;
  }
});

adminRoutes.route('/jev', jevAdminRoutes);
