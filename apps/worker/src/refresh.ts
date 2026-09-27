import type { Difficulty } from '@wwm/schema';
import type { Services } from './config.ts';
import { checkUrl } from './policy/url-policy.ts';

const FRESH_FOR_MS = 7 * 86400_000;
const RETRY_AFTER_MS = 86400_000;

/** Run through waitUntil after returning the approved maze. Failures never affect that response. */
export async function scheduleRefresh(
  env: Env,
  services: Pick<Services, 'store' | 'policy' | 'settings' | 'log'>,
  input: { cacheKey: string; runId: string; url: string; difficulty: Difficulty; seed: number; ip: string },
): Promise<void> {
  if (env.MODERATION_MODE !== 'auto' || env.CAPTURE_ENABLED === '0') return;
  const { store, policy, settings, log } = services;
  const { catalog } = store;
  let ownedJob: string | undefined;
  let started = false;
  try {
    if ((await env.CACHE.get('kill:capture')) !== null) return;
    const run = await env.DB.prepare('SELECT created_at FROM runs WHERE run_id=?')
      .bind(input.runId)
      .first<{ created_at: string }>();
    const capturedAt = Date.parse(run?.created_at ?? '');
    if (!Number.isFinite(capturedAt) || Date.now() - capturedAt < FRESH_FOR_MS) return;
    if (!(await catalog.canServeRun(input.runId)) || (await catalog.isUrlBlocked(input.url))) return;
    if (await catalog.pendingVariant(input.cacheKey)) return;
    const cutoff = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
    const recentAttempt = () =>
      env.DB.prepare('SELECT 1 FROM capture_attempts WHERE url=? AND updated_at>=? LIMIT 1')
        .bind(input.url, cutoff)
        .first();
    if (await recentAttempt()) return;
    if (!(await checkUrl(input.url, policy)).ok) return;
    const candidate = crypto.randomUUID();
    const owner = await catalog.claimBuild(input.cacheKey, candidate);
    if (owner !== candidate) return;
    ownedJob = candidate;
    // An earlier job could have completed between the first check and our claim.
    if (await recentAttempt()) return;
    const perIp = await env.LIMITER.get(env.LIMITER.idFromName(`build:${input.ip}`)).hit(
      settings.buildLimitPerHour,
      3600_000,
    );
    if (!perIp.ok) return;
    const global = await env.LIMITER.get(env.LIMITER.idFromName('build:global')).hit(
      settings.globalBuildLimitPerHour,
      3600_000,
    );
    if (!global.ok) return;
    // Recheck authoritative rules and the kill switch after capacity waits.
    if (
      (await catalog.isUrlBlocked(input.url)) ||
      !(await catalog.canServeRun(input.runId)) ||
      (await env.CACHE.get('kill:capture')) !== null
    )
      return;
    await catalog.requestRefresh(
      input.runId,
      'Approved capture is older than seven days',
      'background-refresh',
    );
    await catalog.recordAttempt({
      jobId: candidate,
      url: input.url,
      status: 'queued',
      reason: 'Scheduled freshness refresh',
    });
    await store.setInflightJob(input.cacheKey, candidate);
    await env.BUILD_JOB.get(env.BUILD_JOB.idFromName(candidate)).start({
      jobId: candidate,
      url: input.url,
      difficulty: input.difficulty,
      seed: input.seed,
      cacheKey: input.cacheKey,
    });
    started = true;
  } catch {
    if (ownedJob && !started) {
      await catalog
        .recordAttempt({
          jobId: ownedJob,
          url: input.url,
          status: 'failed',
          reason: 'Background refresh could not be queued',
        })
        .catch(() => {});
    }
    log.warn('background refresh unavailable', { runId: input.runId });
  } finally {
    if (ownedJob && !started) {
      await Promise.allSettled([
        catalog.clearBuildClaim(input.cacheKey, ownedJob),
        store.clearInflightJob(input.cacheKey, ownedJob),
      ]);
    }
  }
}
