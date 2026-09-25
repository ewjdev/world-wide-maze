/**
 * Docent configuration from the Worker environment (contracts §10.3, infra/README.md "AI docent").
 *
 * Vars: `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`, `DOCENT_PROVIDER`, `DOCENT_MODEL`, `DOCENT_MAX_TOKENS`,
 * `DOCENT_DAILY_LIMIT`, `DOCENT_LIMIT_PER_HOUR`, `DOCENT_CACHE_TTL_DAYS`, `DOCENT_MOCK_DELAY_MS`.
 * Secrets: `ANTHROPIC_API_KEY` and/or `AI_GATEWAY_TOKEN`.
 *
 * Provider choice (`DOCENT_PROVIDER`, default `auto`):
 * - `gateway` / `auto` with the gateway configured → Claude through Cloudflare AI Gateway;
 * - `mock`, or `auto` in development without gateway config → the offline mock (no network, no keys);
 * - `off`, or `auto` in a deployed environment without gateway config → `DOCENT_UNAVAILABLE` (fails closed).
 */
import { type DocentProvider, gatewayProvider, mockProvider } from './providers.ts';

/** The docent's vars and secrets. Declared here so the generated `Env` needn't be regenerated for them. */
export interface DocentVars {
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  ANTHROPIC_API_KEY?: string;
  AI_GATEWAY_TOKEN?: string;
  DOCENT_PROVIDER?: string;
  DOCENT_MODEL?: string;
  DOCENT_MAX_TOKENS?: string;
  DOCENT_DAILY_LIMIT?: string;
  DOCENT_LIMIT_PER_HOUR?: string;
  DOCENT_CACHE_TTL_DAYS?: string;
  DOCENT_MOCK_DELAY_MS?: string;
  WWM_ENV?: string;
}

/**
 * Default answer model: fast and inexpensive, as the Phase 15 brief asks. Override with `DOCENT_MODEL`
 * (e.g. `claude-sonnet-5` or `claude-opus-5`); the request uses no model-specific parameters.
 */
export const DEFAULT_MODEL = 'claude-haiku-4-5';

export interface DocentSettings {
  mode: 'gateway' | 'mock' | 'off';
  model: string;
  maxTokens: number;
  dailyLimit: number;
  perIpPerHour: number;
  cacheTtlSec: number;
  mockDelayMs: number;
  /** Why the docent is off (logged, never shown). */
  offReason?: string;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

export function docentSettings(env: DocentVars): DocentSettings {
  const gatewayReady = !!(
    env.AI_GATEWAY_ACCOUNT_ID &&
    env.AI_GATEWAY_ID &&
    (env.ANTHROPIC_API_KEY || env.AI_GATEWAY_TOKEN)
  );
  const dev = (env.WWM_ENV ?? 'development') === 'development';
  const want = (env.DOCENT_PROVIDER || 'auto').toLowerCase();
  let mode: DocentSettings['mode'];
  let offReason: string | undefined;
  if (want === 'off') {
    mode = 'off';
    offReason = 'DOCENT_PROVIDER=off';
  } else if (want === 'mock') mode = 'mock';
  else if (gatewayReady) mode = 'gateway';
  else if (want === 'auto' && dev) mode = 'mock';
  else {
    mode = 'off';
    offReason =
      'AI Gateway not configured (AI_GATEWAY_ACCOUNT_ID, AI_GATEWAY_ID and ANTHROPIC_API_KEY or AI_GATEWAY_TOKEN)';
  }
  const dailyLimit = num(env.DOCENT_DAILY_LIMIT, 500);
  if (dailyLimit <= 0 && mode !== 'off') {
    mode = 'off';
    offReason = 'DOCENT_DAILY_LIMIT=0';
  }
  return {
    mode,
    model: env.DOCENT_MODEL || DEFAULT_MODEL,
    maxTokens: Math.min(1024, Math.max(64, num(env.DOCENT_MAX_TOKENS, 600))),
    dailyLimit,
    perIpPerHour: num(env.DOCENT_LIMIT_PER_HOUR, 20),
    cacheTtlSec: Math.max(60, num(env.DOCENT_CACHE_TTL_DAYS, 7) * 86_400),
    mockDelayMs: num(env.DOCENT_MOCK_DELAY_MS, 0),
    ...(offReason ? { offReason } : {}),
  };
}

export function createProvider(env: DocentVars, s: DocentSettings): DocentProvider | null {
  if (s.mode === 'mock') return mockProvider({ delayMs: s.mockDelayMs });
  if (s.mode !== 'gateway') return null;
  return gatewayProvider({
    accountId: env.AI_GATEWAY_ACCOUNT_ID as string,
    gatewayId: env.AI_GATEWAY_ID as string,
    ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
    ...(env.AI_GATEWAY_TOKEN ? { gatewayToken: env.AI_GATEWAY_TOKEN } : {}),
    model: s.model,
  });
}
