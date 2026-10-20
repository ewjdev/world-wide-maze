/**
 * Model providers for lesson drafts, following the docent's pattern (docent/providers.ts):
 *
 * - `gatewayDraftModel`: Claude through Cloudflare AI Gateway's Anthropic endpoint, with the official SDK pointed at
 *   the gateway. With `ANTHROPIC_API_KEY` the key travels in `x-api-key`; without it the gateway holds the provider
 *   key (BYOK) and `cf-aig-authorization` authenticates. One call per invocation, never retried here: a model call is
 *   billed, so retries are the Workflow's decision (it doesn't make them; see pipeline.ts).
 * - `mockDraftModel`: no network and no keys. Deterministic, valid items built from the reviewed vocabulary, for
 *   development, previews and tests. Its reply says it is the offline mock.
 */
import Anthropic from '@anthropic-ai/sdk';
import { commonThreeLetterWords, spellingBankRound, spellingVocabulary } from '@wwm/learning';
import { type GatewayConfig, gatewayBaseUrl, modelParams } from '../docent/providers.ts';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface DraftRequest {
  system: string;
  messages: ChatTurn[];
  maxTokens: number;
  /** What is being asked, for the mock (a real model reads it from `messages`). */
  task: {
    objective: string;
    /** Ids for the items to write (a first turn) or to replace (a repair). */
    ids: string[];
    /** Labels (words) already used, by the lesson, the bank so far or this turn. */
    exclude: string[];
  };
}

export interface DraftUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface DraftReply {
  text: string;
  model: string;
  usage: DraftUsage;
}

export interface DraftModel {
  readonly name: 'gateway' | 'mock';
  readonly model: string;
  complete(request: DraftRequest): Promise<DraftReply>;
}

export function gatewayDraftModel(cfg: GatewayConfig): DraftModel {
  const headers: Record<string, string | null> = {};
  if (cfg.gatewayToken) headers['cf-aig-authorization'] = `Bearer ${cfg.gatewayToken}`;
  if (!cfg.apiKey) headers['x-api-key'] = null; // the gateway supplies the provider key
  const client = new Anthropic({
    apiKey: cfg.apiKey ?? null,
    authToken: null,
    baseURL: gatewayBaseUrl(cfg.accountId, cfg.gatewayId),
    defaultHeaders: headers,
    maxRetries: 0,
    timeout: cfg.timeoutMs ?? 180_000,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });
  return {
    name: 'gateway',
    model: cfg.model,
    async complete(request) {
      const message = await client.messages.create({
        model: cfg.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
        ...modelParams(cfg.model, cfg.effort),
      });
      return {
        text: message.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
        model: message.model,
        usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      };
    },
  };
}

// ── Mock ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const MOCK_NOTE = 'Offline mock (no AI model is connected): items built from the reviewed word list.';

const VOWELS = ['A', 'E', 'I', 'O', 'U'];
const CONSONANTS = ['B', 'D', 'G', 'K', 'M', 'N', 'P', 'R', 'S', 'T', 'Z'];

/** Two distractor letters for a blank: vowels for a vowel, consonants otherwise; never the answer, and preferably
 * not a letter that spells another real word. */
function distractors(word: string, blank: number, seed: number): string[] {
  const answer = word[blank] ?? '';
  const pool = (VOWELS.includes(answer) ? VOWELS : CONSONANTS).filter((letter) => letter !== answer);
  const ordered = pool.map((_, i) => pool[(seed + i) % pool.length] as string);
  const spells = (letter: string) =>
    commonThreeLetterWords.has(`${word.slice(0, blank)}${letter}${word.slice(blank + 1)}`.toLowerCase());
  return [...ordered.filter((letter) => !spells(letter)), ...ordered.filter(spells)].slice(0, 2);
}

export function mockDraftModel(): DraftModel {
  return {
    name: 'mock',
    model: 'mock',
    async complete({ task }) {
      if (task.objective !== 'little-word-builders')
        return { text: `${MOCK_NOTE}\n[]`, model: 'mock', usage: { inputTokens: 0, outputTokens: 0 } };
      const used = new Set(task.exclude.map((label) => label.toLowerCase()));
      const words = spellingVocabulary.words.filter((entry) => !used.has(entry.word));
      const items = task.ids.flatMap((id, index) => {
        const entry = words[index];
        if (!entry) return [];
        const blank = (used.size + index) % 3;
        const word = entry.word.toUpperCase();
        const letters = [word[blank] ?? '', ...distractors(word, blank, used.size + index)];
        // Keep the answer's position varied too.
        const order = letters.map((_, i) => letters[(i + index) % letters.length] as string);
        return [spellingBankRound(id, entry, blank, order)];
      });
      return {
        text: `${MOCK_NOTE}\n${JSON.stringify(items, null, 1)}`,
        model: 'mock',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
