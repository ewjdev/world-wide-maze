import { describe, expect, it } from 'vitest';
import { clipHash, settingsHash, wordTimings } from '../src/timing.ts';

const text = 'One, two. Match!';
const alignment = {
  characters: [...text],
  character_start_times_seconds: [...text].map((_, i) => i * 0.1),
  character_end_times_seconds: [...text].map((_, i) => i * 0.1 + 0.1),
};

describe('voice timings', () => {
  it('takes each word’s start from its first character', () => {
    expect(wordTimings(text, alignment)).toEqual({ ms: 1600, words: [0, 500, 1000] });
  });
  it('falls back to proportional timing when the alignment was normalised', () => {
    const other = { ...alignment, characters: [...'one two match'] };
    const timing = wordTimings(text, other);
    expect(timing.words).toHaveLength(3);
    expect(timing.words[0]).toBe(0);
    expect(timing.words[2]).toBeGreaterThan(timing.words[1] ?? 0);
  });
  it('hashes text, voice, model and settings together', () => {
    const voice = { voiceId: 'abcdefgh12', model: 'eleven_v3', settings: 'abc123abc123' };
    const hash = clipHash('Hi!', voice);
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
    expect(clipHash('Hi!', { ...voice, model: 'eleven_flash_v2_5' })).not.toBe(hash);
    expect(clipHash('Hi.', voice)).not.toBe(hash);
    const config = { voiceId: 'x', model: 'm', settings: { stability: 0.5 }, seed: 1 };
    expect(settingsHash(config)).not.toBe(settingsHash({ ...config, seed: 2 }));
  });
});
