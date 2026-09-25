/**
 * Builds the injected services from the Worker environment. The only place that reads `env.*` vars, so
 * routes, the job DO and tests all agree on configuration.
 */
import { DEFAULT_HOOKS, defaultStageBuilder, type StageBuilder } from './builder.ts';
import { BrowserRunCapturer } from './capture/browser-run.ts';
import { HttpCapturer } from './capture/http-capturer.ts';
import type { Capturer } from './capture/types.ts';
import { ServiceError } from './errors.ts';
import { createLogger, type Logger } from './log.ts';
import type { BrowserGate, PipelineDeps } from './pipeline.ts';
import { createDohResolver, type DnsResolver } from './policy/dns.ts';
import { type CheckUrlDeps, parseAllowHosts } from './policy/url-policy.ts';
import { CloudflareStore } from './store.ts';

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

export interface Settings {
  buildLimitPerHour: number;
  /** Phase 12: all new builds across all clients per hour. */
  globalBuildLimitPerHour: number;
  browserMaxConcurrency: number;
  captureBudgetMs: number;
  slice0BudgetMs: number;
  cacheTtlDays: number;
  retentionDays: number;
}

export function settings(env: Env): Settings {
  return {
    buildLimitPerHour: num(env.BUILD_LIMIT_PER_HOUR, 10),
    globalBuildLimitPerHour: num(env.GLOBAL_BUILD_LIMIT_PER_HOUR, 600),
    browserMaxConcurrency: num(env.BROWSER_MAX_CONCURRENCY, 2),
    captureBudgetMs: num(env.CAPTURE_BUDGET_MS, 20_000),
    slice0BudgetMs: num(env.SLICE0_BUDGET_MS, 30_000),
    cacheTtlDays: num(env.CACHE_TTL_DAYS, 7),
    retentionDays: num(env.RETENTION_DAYS, 30),
  };
}

export interface Services {
  settings: Settings;
  store: CloudflareStore;
  resolver: DnsResolver;
  policy: CheckUrlDeps;
  builder: StageBuilder;
  log: Logger;
  pipeline: PipelineDeps;
}

/** Global browser-session cap through the `Limiter` DO; waits up to `waitMs` for a slot. */
export function limiterGate(
  env: Env,
  holder: string,
  max: number,
  leaseMs: number,
  waitMs = 45_000,
): BrowserGate {
  const stub = env.LIMITER.get(env.LIMITER.idFromName('browser'));
  return {
    async acquire() {
      const until = Date.now() + waitMs;
      for (;;) {
        const r = await stub.acquire(holder, max, leaseMs);
        if (r.ok) return async () => void (await stub.release(holder).catch(() => {}));
        if (Date.now() + 1000 > until)
          throw new ServiceError(
            'RATE_LIMITED',
            'all capture browsers are busy; try again shortly',
            r.retryAfterSec,
          );
        await new Promise((res) => setTimeout(res, 1000));
      }
    },
  };
}

function createCapturer(env: Env, policy: CheckUrlDeps, log: Logger): Capturer {
  if (env.CAPTURE_BACKEND === 'sidecar') {
    if (!env.CAPTURE_SIDECAR_URL) throw new Error('CAPTURE_BACKEND=sidecar needs CAPTURE_SIDECAR_URL');
    return new HttpCapturer(env.CAPTURE_SIDECAR_URL);
  }
  return new BrowserRunCapturer(env.BROWSER, { guard: policy, log: (m, f) => log.info(m, f) });
}

export function createServices(env: Env, ctx: { jobId?: string; requestId?: string } = {}): Services {
  const s = settings(env);
  const log = createLogger({ svc: 'wwm-worker', ...ctx });
  const store = new CloudflareStore(env, { cacheTtlDays: s.cacheTtlDays });
  const resolver = createDohResolver({ url: env.DOH_URL });
  const policy: CheckUrlDeps = {
    resolver,
    allowHosts: parseAllowHosts(env.DEV_ALLOWED_HOSTS),
    isOptedOut: (host) => store.isOptedOut(host),
  };
  const builder = defaultStageBuilder();
  const pipeline: PipelineDeps = {
    get capturer() {
      return createCapturer(env, policy, log);
    },
    builder,
    moderate: DEFAULT_HOOKS.moderate,
    ...(DEFAULT_HOOKS.validatePlayable ? { validatePlayable: DEFAULT_HOOKS.validatePlayable } : {}),
    store,
    gate: limiterGate(
      env,
      ctx.jobId ?? crypto.randomUUID(),
      s.browserMaxConcurrency,
      s.captureBudgetMs + 30_000,
    ),
    log,
    captureBudgetMs: s.captureBudgetMs,
    slice0BudgetMs: s.slice0BudgetMs,
  };
  return { settings: s, store, resolver, policy, builder, log, pipeline };
}
