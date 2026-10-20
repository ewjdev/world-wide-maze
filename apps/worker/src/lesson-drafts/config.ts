/**
 * Lesson-draft configuration (Phase 31 M4, contracts §10.5 CCR-31-4).
 *
 * Vars: `LESSON_DRAFTS` (`off` | `on`; anything else is off), `LESSON_DRAFT_PROVIDER` (`auto` | `gateway` | `mock` |
 * `off`), `LESSON_DRAFT_MODEL`, `LESSON_DRAFT_MAX_TOKENS`, `LESSON_DRAFT_DAILY_LIMIT`, plus the docent's
 * `AI_GATEWAY_ACCOUNT_ID` and `AI_GATEWAY_ID`. Secrets: `ANTHROPIC_API_KEY` and/or `AI_GATEWAY_TOKEN`, shared with
 * the docent (contracts §10.3).
 *
 * Provider choice follows the docent: the gateway when it is configured, the offline mock in development, and
 * nothing (fail closed) in a deployed environment without gateway config.
 */
import { type DocentVars, docentSettings } from '../docent/config.ts';
import { type DraftModel, gatewayDraftModel, mockDraftModel } from './providers.ts';

export interface LessonDraftVars extends DocentVars {
  LESSON_DRAFTS?: string;
  LESSON_DRAFT_PROVIDER?: string;
  LESSON_DRAFT_MODEL?: string;
  LESSON_DRAFT_MAX_TOKENS?: string;
  LESSON_DRAFT_DAILY_LIMIT?: string;
}

/** The M0 spike's model: 53/54 rounds valid on first pass. */
export const DEFAULT_DRAFT_MODEL = 'claude-sonnet-5-5';

export interface LessonDraftSettings {
  /** The operator switch. Off: every `/api/admin/lessons/*` endpoint is 404. */
  enabled: boolean;
  mode: 'gateway' | 'mock' | 'off';
  model: string;
  maxTokens: number;
  /** Generation turns per 24 hours across all operators (each turn makes at most three model calls). */
  dailyLimit: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
}

export function lessonDraftSettings(env: LessonDraftVars): LessonDraftSettings {
  const provider = docentSettings({
    ...env,
    DOCENT_PROVIDER: env.LESSON_DRAFT_PROVIDER || 'auto',
    DOCENT_DAILY_LIMIT: '1',
  });
  return {
    enabled: (env.LESSON_DRAFTS ?? 'off').trim().toLowerCase() === 'on',
    mode: provider.mode,
    model: provider.mode === 'mock' ? 'mock' : env.LESSON_DRAFT_MODEL || DEFAULT_DRAFT_MODEL,
    maxTokens: Math.min(16_000, Math.max(1000, num(env.LESSON_DRAFT_MAX_TOKENS, 8000))),
    dailyLimit: Math.max(0, num(env.LESSON_DRAFT_DAILY_LIMIT, 20)),
  };
}

export function createDraftModel(env: LessonDraftVars, settings: LessonDraftSettings): DraftModel | null {
  if (settings.mode === 'mock') return mockDraftModel();
  if (settings.mode !== 'gateway') return null;
  return gatewayDraftModel({
    accountId: env.AI_GATEWAY_ACCOUNT_ID as string,
    gatewayId: env.AI_GATEWAY_ID as string,
    ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
    ...(env.AI_GATEWAY_TOKEN ? { gatewayToken: env.AI_GATEWAY_TOKEN } : {}),
    model: settings.model,
    timeoutMs: 180_000,
  });
}
