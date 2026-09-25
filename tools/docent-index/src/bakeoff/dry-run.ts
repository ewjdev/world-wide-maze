/**
 * Dry-run provider: the offline mock's answer, delivered with a fake per-model latency profile and synthetic
 * token usage, so the whole bake-off (timing, cost math, judge, report, resume) runs without keys or network.
 * Deterministic for a given config and question. Every number it produces is fake and the report says so.
 */
import { DONT_KNOW } from '../../../../apps/worker/src/docent/prompt.ts';
import { type DocentProvider, mockProvider } from '../../../../apps/worker/src/docent/providers.ts';
import type { MatrixEntry } from './core.ts';

interface Profile {
  /** Time to first token, ms (min, max). */
  ttft: [number, number];
  /** Output tokens per second. */
  tps: number;
  /** Fake thinking tokens per answer. */
  thinking: number;
  /** Chance of appending a synthetic uncited sentence (exercises the judge and the recommendation rule). */
  unsupportedRate: number;
}

const PROFILES: Record<string, Profile> = {
  'haiku-4-5': { ttft: [350, 750], tps: 160, thinking: 0, unsupportedRate: 0.12 },
  'sonnet-5': { ttft: [700, 1500], tps: 90, thinking: 150, unsupportedRate: 0.04 },
  'opus-5-5@low': { ttft: [800, 1500], tps: 70, thinking: 120, unsupportedRate: 0 },
  'opus-5-5@medium': { ttft: [1300, 2600], tps: 70, thinking: 350, unsupportedRate: 0 },
  'opus-5@low': { ttft: [900, 1700], tps: 60, thinking: 120, unsupportedRate: 0 },
};
const FALLBACK: Profile = { ttft: [600, 1400], tps: 80, thinking: 100, unsupportedRate: 0.05 };

export const SYNTHETIC_SENTENCE = 'This sentence is a synthetic unsupported claim added by the dry run.';

/** FNV-1a → mulberry32: a small seeded PRNG. */
export function seeded(key: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** `latencyScale` 0 = no sleeping (tests); 1 = the profile's fake latencies in real time. */
export function dryRunProvider(entry: MatrixEntry, latencyScale = 1): DocentProvider {
  const inner = mockProvider();
  const prof = PROFILES[entry.id] ?? FALLBACK;
  return {
    name: 'mock',
    model: entry.model,
    async stream(input, onText) {
      const rnd = seeded(`${entry.id}\n${input.question}`);
      let text = '';
      await inner.stream(input, (t) => {
        text += t;
      });
      if (text !== DONT_KNOW && rnd() < prof.unsupportedRate) text += ` ${SYNTHETIC_SENTENCE}`;
      const [lo, hi] = prof.ttft;
      await sleep((lo + rnd() * (hi - lo)) * latencyScale);
      const parts = text.match(/\S+\s*/g) ?? [text];
      const outTokens = Math.ceil(text.length / 4);
      const perPart = ((outTokens / prof.tps) * 1000) / Math.max(1, Math.ceil(parts.length / 4));
      for (let i = 0; i < parts.length; i += 4) {
        if (input.signal?.aborted) break;
        onText(parts.slice(i, i + 4).join(''));
        await sleep(perPart * latencyScale);
      }
      const promptChars = input.system.length + input.messages.reduce((a, m) => a + m.content.length, 0);
      return {
        model: entry.model,
        stopReason: 'end_turn',
        usage: {
          inputTokens: Math.ceil(promptChars / 4),
          outputTokens: outTokens + prof.thinking,
          ...(prof.thinking ? { thinkingTokens: prof.thinking } : {}),
        },
      };
    },
  };
}
