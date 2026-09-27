/**
 * Pip's voice in the browser: pre-generated clips (with word timings) from the consumer's audio origin, else
 * browser speech, else silent estimated timing. Cues fire on the spoken word in every mode, so the picture
 * explains even with the sound off.
 *
 * The audio origin is consumer configuration, never read from a document (docs/education/html-contract.md).
 */

import type { VoiceClip } from './schema.ts';
import { type Cue, type ScriptLine, wordsOf } from './script.ts';

/** Where the baseline clips live (R2 bucket `wwm-learning-audio`, public read-only). */
export const DEFAULT_AUDIO_BASE = 'https://learning-audio.ewj.dev/';

export interface VoiceEvents {
  onCue?(cue: Cue, line: ScriptLine): void;
  onWord?(line: ScriptLine, word: number): void;
  onLine?(line: ScriptLine | null): void;
}

export interface VoicePlayerOptions extends VoiceEvents {
  audioBase?: string;
  clips: readonly VoiceClip[];
  muted?: () => boolean;
  /** Speaking rate for the browser-speech fallback. */
  rate?: number;
}

export interface VoicePlayer {
  /** Play lines in order, replacing anything playing. Resolves when done or interrupted. */
  play(lines: readonly ScriptLine[]): Promise<void>;
  stop(): void;
  /** Call from a user gesture (first tap) so later clips may play without one. */
  unlock(): void;
  /** Fetch clips ahead of time (best effort). */
  preload(lines: readonly ScriptLine[]): void;
  /** Which source a line would use (for tests and diagnostics). */
  sourceFor(line: ScriptLine): 'clip' | 'speech' | 'silent';
}

const MS_PER_WORD = 420;

/** The clip for a line is found by its exact text, so a line keeps its clip wherever it's used (Phase 22). */
export function clipFor(clips: readonly VoiceClip[], line: ScriptLine): VoiceClip | undefined {
  return clips.find((clip) => clip.text === line.text);
}

export function createVoicePlayer(options: VoicePlayerOptions): VoicePlayer {
  const base = options.audioBase ?? DEFAULT_AUDIO_BASE;
  const audio = typeof Audio === 'undefined' ? null : new Audio();
  if (audio) audio.preload = 'auto';
  const speech = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  const failed = new Set<string>();
  const warmed = new Map<string, HTMLAudioElement>();
  let generation = 0;
  let cancelCurrent: (() => void) | null = null;

  const url = (clip: VoiceClip) => `${base}${clip.hash}.mp3`;

  function fire(line: ScriptLine, word: number): void {
    options.onWord?.(line, word);
    for (const cue of line.cues) if (cue.word === word) options.onCue?.(cue, line);
  }

  /** Fire words on a schedule (ms from start); returns a cancel function. */
  function schedule(line: ScriptLine, times: readonly number[], done: () => void, total: number): () => void {
    const timers = times.map((t, i) => setTimeout(() => fire(line, i), t));
    const end = setTimeout(done, total);
    return () => {
      for (const timer of timers) clearTimeout(timer);
      clearTimeout(end);
    };
  }

  function playSilent(line: ScriptLine): Promise<void> {
    const words = wordsOf(line.text);
    return new Promise((resolve) => {
      cancelCurrent = schedule(
        line,
        words.map((_, i) => i * MS_PER_WORD),
        resolve,
        words.length * MS_PER_WORD + 250,
      );
    });
  }

  function playSpeech(line: ScriptLine): Promise<void> {
    if (!speech || options.muted?.()) return playSilent(line);
    const words = wordsOf(line.text);
    return new Promise((resolve) => {
      let settled = false;
      let boundaries = false;
      let fallback: (() => void) | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        fallback?.();
        resolve();
      };
      const utterance = new SpeechSynthesisUtterance(line.text);
      utterance.lang = 'en-US';
      utterance.rate = options.rate ?? 0.85;
      utterance.onboundary = (event) => {
        if (event.name !== 'word') return;
        boundaries = true;
        const index = words.findIndex((word) => event.charIndex >= word.start && event.charIndex < word.end);
        if (index >= 0) fire(line, index);
      };
      utterance.onstart = () => {
        // no word boundaries from this voice: estimate so the cues still land
        setTimeout(() => {
          if (!boundaries && !settled)
            fallback = schedule(
              line,
              words.map((_, i) => i * MS_PER_WORD),
              () => {},
              0,
            );
        }, 300);
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      cancelCurrent = () => {
        speech.cancel();
        finish();
      };
      speech.cancel();
      speech.speak(utterance);
    });
  }

  function playClip(line: ScriptLine, clip: VoiceClip): Promise<void> {
    const element = audio;
    if (!element || options.muted?.()) {
      return new Promise((resolve) => {
        cancelCurrent = schedule(line, clip.words, resolve, clip.ms + 150);
      });
    }
    return new Promise((resolve) => {
      let next = 0;
      let frame = 0;
      let settled = false;
      const finish = (flush: boolean) => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(frame);
        element.onended = null;
        element.onerror = null;
        // at the natural end, fire any cues the frame loop didn't reach; an interruption fires nothing more
        while (flush && next < clip.words.length) fire(line, next++);
        resolve();
      };
      const tick = () => {
        const now = element.currentTime * 1000;
        while (next < clip.words.length && (clip.words[next] ?? 0) <= now + 30) fire(line, next++);
        frame = requestAnimationFrame(tick);
      };
      element.onended = () => finish(true);
      element.onerror = () => {
        failed.add(clip.hash);
        // play() may already have rejected and fallen back to speech: never speak a line twice
        if (settled) return;
        settled = true;
        cancelAnimationFrame(frame);
        void playSpeech(line).then(resolve);
      };
      cancelCurrent = () => {
        element.pause();
        finish(false);
      };
      element.src = url(clip);
      element.currentTime = 0;
      element
        .play()
        .then(() => {
          frame = requestAnimationFrame(tick);
        })
        .catch(() => {
          // autoplay refused or the file is unreachable: speak instead
          if (settled) return;
          settled = true;
          void playSpeech(line).then(resolve);
        });
    });
  }

  function sourceFor(line: ScriptLine): 'clip' | 'speech' | 'silent' {
    const clip = clipFor(options.clips, line);
    if (clip && audio && !failed.has(clip.hash)) return 'clip';
    return speech ? 'speech' : 'silent';
  }

  return {
    async play(lines) {
      this.stop();
      const mine = ++generation;
      for (const line of lines) {
        if (mine !== generation) return;
        options.onLine?.(line);
        const clip = clipFor(options.clips, line);
        if (clip && audio && !failed.has(clip.hash)) await playClip(line, clip);
        else if (speech) await playSpeech(line);
        else await playSilent(line);
        cancelCurrent = null;
      }
      if (mine === generation) options.onLine?.(null);
    },
    stop() {
      generation++;
      const cancel = cancelCurrent;
      cancelCurrent = null;
      cancel?.();
      options.onLine?.(null);
    },
    unlock() {
      // never interrupt Pip: unlocking only matters before the first clip plays
      if (!audio?.paused) return;
      // a silent, gesture-initiated play unlocks this element for later programmatic plays (iOS Safari)
      audio.muted = true;
      void audio
        .play()
        .catch(() => {})
        .finally(() => {
          audio.pause();
          audio.muted = false;
        });
    },
    preload(lines) {
      if (typeof Audio === 'undefined') return;
      for (const line of lines) {
        const clip = clipFor(options.clips, line);
        if (!clip || warmed.has(clip.hash) || failed.has(clip.hash)) continue;
        const element = new Audio();
        element.preload = 'auto';
        element.src = url(clip);
        warmed.set(clip.hash, element);
      }
    },
    sourceFor,
  };
}
