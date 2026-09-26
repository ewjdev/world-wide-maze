/**
 * Turn ElevenLabs character alignment into the manifest's compact word timings, and compute clip hashes.
 * Pure (plus node:crypto), so it is unit-tested without the network.
 */
import { createHash } from 'node:crypto';
import { clipKey, wordsOf } from '@wwm/learning';

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface VoiceConfig {
  voiceId: string;
  model: string;
  settings: Record<string, number>;
  seed: number;
}

/** Short hash of everything that shapes the sound except the text (settings and seed). */
export function settingsHash(config: VoiceConfig): string {
  return createHash('sha256')
    .update(JSON.stringify([config.settings, config.seed]))
    .digest('hex')
    .slice(0, 12);
}

export function clipHash(text: string, voice: { voiceId: string; model: string; settings: string }): string {
  return createHash('sha256').update(clipKey(text, voice)).digest('hex').slice(0, 32);
}

/**
 * Start time (ms) of each whitespace-separated word. The alignment normally covers the input text character for
 * character; if it doesn't (normalisation), fall back to spreading words over the clip in proportion to length.
 */
export function wordTimings(text: string, alignment: Alignment): { words: number[]; ms: number } {
  const ends = alignment.character_end_times_seconds;
  const ms = Math.max(1, Math.round((ends[ends.length - 1] ?? 0) * 1000));
  const words = wordsOf(text);
  if (alignment.characters.join('') === text)
    return {
      ms,
      words: words.map((word) =>
        Math.round((alignment.character_start_times_seconds[word.start] ?? 0) * 1000),
      ),
    };
  return { ms, words: words.map((word) => Math.round((word.start / Math.max(1, text.length)) * ms)) };
}
