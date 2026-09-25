/**
 * Answer providers.
 *
 * - `gatewayProvider`: Claude through **Cloudflare AI Gateway**'s Anthropic endpoint
 *   (`https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic`), called with the official
 *   Anthropic SDK pointed at that base URL. With `ANTHROPIC_API_KEY` the key travels in `x-api-key`; without it
 *   (keys stored in the gateway, "BYOK", or Unified Billing) `x-api-key` is omitted and the gateway token in
 *   `cf-aig-authorization` authenticates. An authenticated gateway always gets `cf-aig-authorization`.
 * - `mockProvider`: no network, no keys. A deterministic answer quoting the best-matching sentences of the
 *   retrieved excerpts with their citations, or the "don't know" sentence when they don't cover the question.
 *   Used in dev and tests, and it says that it is the offline mode.
 */
import Anthropic from '@anthropic-ai/sdk';
import { tokenize } from '@wwm/docent-index';
import type { ChatMessage } from './prompt.ts';
import { DONT_KNOW } from './prompt.ts';
import type { Excerpt } from './retrieve.ts';

export interface ProviderInput {
  system: string;
  messages: ChatMessage[];
  /** For the mock (the real model reads them from `messages`). */
  excerpts: Excerpt[];
  /** For the mock: question words found nowhere in the corpus. */
  unknownTerms?: string[];
  question: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ProviderResult {
  model: string;
  stopReason: string | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    /** Present when the API reports them (prompt caching, thinking). */
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    thinkingTokens?: number;
  };
}

export interface DocentProvider {
  readonly name: 'gateway' | 'mock';
  readonly model: string;
  stream(input: ProviderInput, onText: (text: string) => void): Promise<ProviderResult>;
}

// ── AI Gateway ───────────────────────────────────────────────────────────────────────────────────────────────

export interface GatewayConfig {
  accountId: string;
  gatewayId: string;
  /** Anthropic API key (Worker secret). Omit when the gateway holds the provider key (BYOK / Unified Billing). */
  apiKey?: string;
  /** AI Gateway token for an authenticated gateway (Worker secret `AI_GATEWAY_TOKEN`). */
  gatewayToken?: string;
  model: string;
  /**
   * `output_config.effort` for models that take it (see `modelParams`). Unset: the model's default
   * (`high` on Claude Sonnet 5 / Opus 5, `medium` on Claude Opus 5.5). Ignored on Claude Haiku 4.5.
   */
  effort?: Effort;
  /** Send `cf-aig-skip-cache: true` so a gateway cache can't replay answers (the bake-off sets it). */
  skipCache?: boolean;
  /** Test hook. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

/** Models that reject `output_config.effort` (it 400s on Haiku 4.5 and Sonnet 4.5). */
const NO_EFFORT = /^claude-(haiku-4-5|sonnet-4-5|haiku-3|3-)/;

/**
 * Per-model request parameters. The docent never sends `temperature`/`top_p`/`top_k` (a 400 on Claude Sonnet 5 and
 * the Opus 4.7+ line) and never sends `thinking`:
 * - Claude Haiku 4.5: omitting `thinking` means no thinking (it only takes `budget_tokens`); no `effort`.
 * - Claude Sonnet 5 / Opus 5: omitting `thinking` runs adaptive thinking; depth is set with `effort`.
 * - Claude Opus 5.5: thinking can't be disabled (`{type: "disabled"}` is a 400), so `effort` is the only
 *   control; its default is `medium`.
 * Thinking tokens count towards `max_tokens`, so thinking models need the higher `DOCENT_MAX_TOKENS` (≤ 1024).
 */
export function modelParams(model: string, effort?: Effort): { output_config?: { effort: Effort } } {
  if (!effort || NO_EFFORT.test(model)) return {};
  return { output_config: { effort } };
}

export function gatewayBaseUrl(accountId: string, gatewayId: string): string {
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/anthropic`;
}

export function gatewayProvider(cfg: GatewayConfig): DocentProvider {
  const headers: Record<string, string | null> = {};
  if (cfg.gatewayToken) headers['cf-aig-authorization'] = `Bearer ${cfg.gatewayToken}`;
  if (!cfg.apiKey) headers['x-api-key'] = null; // the gateway supplies the provider key
  if (cfg.skipCache) headers['cf-aig-skip-cache'] = 'true';
  const client = new Anthropic({
    apiKey: cfg.apiKey ?? null,
    authToken: null,
    baseURL: gatewayBaseUrl(cfg.accountId, cfg.gatewayId),
    defaultHeaders: headers,
    maxRetries: 1,
    timeout: cfg.timeoutMs ?? 30_000,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });
  return {
    name: 'gateway',
    model: cfg.model,
    async stream(input, onText) {
      const stream = client.messages.stream(
        {
          model: cfg.model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages: input.messages,
          ...modelParams(cfg.model, cfg.effort),
        },
        input.signal ? { signal: input.signal } : undefined,
      );
      stream.on('text', (t) => onText(t));
      const msg = await stream.finalMessage();
      const u = msg.usage;
      return {
        model: msg.model,
        stopReason: msg.stop_reason,
        usage: {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          ...(u.cache_read_input_tokens ? { cacheReadTokens: u.cache_read_input_tokens } : {}),
          ...(u.cache_creation_input_tokens ? { cacheWriteTokens: u.cache_creation_input_tokens } : {}),
          ...(u.output_tokens_details?.thinking_tokens
            ? { thinkingTokens: u.output_tokens_details.thinking_tokens }
            : {}),
        },
      };
    },
  };
}

// ── Mock ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const MOCK_PREFIX =
  'Offline mode (no AI model is connected), so here are the closest passages in the sources.';

/** Question words that say nothing about what is being asked for. */
const GENERIC = new Set(
  tokenize(
    'world wide maze wwm original 2013 game project rebuild tribute site thing things work worked happen happened ' +
      'know say said mean did does use used get make made',
  ),
);

/** Plain sentences from a markdown chunk (headings, table rules, link targets and emphasis removed). */
export function sentences(md: string): string[] {
  const text = md
    .replace(/^#{1,6}\s+.*$/gm, '\n')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '\n')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|[*`]/g, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/^\s*[-•]\s+/gm, '');
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
    .map((s) => s.replace(/^[\s·]+|[\s·]+$/g, '').trim())
    .map((s) => s.replace(/\s*\(sources?: [^)]*\)\.?$/i, '').trim())
    .filter((s) => s.length >= 25 && s.length <= 360 && /[a-z]/i.test(s) && !/^\(?sources?:/i.test(s));
}

/** Share of the question's content words found in `text`. */
/** The question's content words; all of its words when every one is generic ("Who made the original?"). */
export function contentTerms(question: string): string[] {
  const tokens = [...new Set(tokenize(question))];
  // the corpus is English: with Latin words present, CJK tokens (e.g. "日本語で答えてください") don't count
  const latin = tokens.filter((t) => /^[a-z0-9]+$/.test(t));
  const all = latin.length ? latin : tokens;
  const specific = all.filter((t) => !GENERIC.has(t));
  return specific.length ? specific : all;
}

export function coverage(question: string, text: string): number {
  const q = contentTerms(question);
  if (!q.length) return 0;
  const have = new Set(tokenize(text));
  return q.filter((t) => have.has(t)).length / q.length;
}

export function mockAnswer(question: string, excerpts: Excerpt[], unknownTerms: string[] = []): string {
  // a content word the corpus never uses ("Metacritic", "ramen"): the sources can't be about it
  if (unknownTerms.some((t) => !GENERIC.has(t))) return DONT_KNOW;
  const best = excerpts[0];
  // at least half of the question's content words must appear together in one of the top two excerpts
  // (two unrelated passages that each match one word don't cover a question)
  const covered = excerpts
    .slice(0, 2)
    .some((e) => coverage(question, `${e.chunk.title}\n${e.chunk.text}`) >= 0.5);
  if (!best || !covered) return DONT_KNOW;
  const qTerms = new Set(contentTerms(question));
  const picked: string[] = [];
  const cite = (s: string, ref: string) => `${s.replace(/[.:;,]?$/, '.')} [${ref}]`;
  excerpts.slice(0, 2).forEach((e, rank) => {
    const all = sentences(e.chunk.text);
    const best = all
      .map((s, i) => ({ s, i, n: new Set(tokenize(s).filter((t) => qTerms.has(t))).size }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || a.i - b.i)[0];
    if (!best) return;
    // the best-matching sentence, plus what follows it in the best excerpt (a passage, not a fragment)
    let passage = [best.s];
    if (rank === 0)
      for (const next of all.slice(best.i + 1)) {
        if (passage.join(' ').length >= 280 || passage.length >= 3) break;
        passage = [...passage, next];
      }
    for (const s of passage) picked.push(cite(s, e.ref));
  });
  if (!picked.length) return DONT_KNOW;
  return `${MOCK_PREFIX}\n\n${picked.join(' ')}`;
}

export interface MockOptions {
  /** Delay between streamed words (dev: makes streaming visible; tests: 0). */
  delayMs?: number;
}

export function mockProvider(opts: MockOptions = {}): DocentProvider {
  const delay = opts.delayMs ?? 0;
  return {
    name: 'mock',
    model: 'mock',
    async stream(input, onText) {
      const answer = mockAnswer(input.question, input.excerpts, input.unknownTerms);
      // stream a few words at a time, like a model would
      const parts = answer.match(/\S+\s*/g) ?? [answer];
      for (let i = 0; i < parts.length; i += 3) {
        if (input.signal?.aborted) break;
        onText(parts.slice(i, i + 3).join(''));
        if (delay) await new Promise((r) => setTimeout(r, delay));
      }
      return { model: 'mock', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}
