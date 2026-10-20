import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyDraft,
  baselinePath,
  checkRound,
  clipFor,
  createVoicePlayer,
  currentRound,
  initialState,
  lineId,
  parseLearningPath,
  preschoolActivities,
  roundScript,
  sceneLayout,
  sceneSvg,
  skyIslands,
  step,
  withPractice,
} from '../src/index.ts';

describe('five preschool lessons', () => {
  it('plays all core rounds and offers a skippable fifth round in each lesson', () => {
    expect(preschoolActivities).toHaveLength(5);
    for (const activity of preschoolActivities) {
      expect(activity.rounds).toHaveLength(5);
      let state = step(activity, initialState(activity), { type: 'start' }).state;
      for (let i = 0; i < 4; i++) {
        const round = currentRound(activity, state);
        expect(round.practice).toBeDefined();
        expect(round.hints).toHaveLength(3);
        state = step(activity, state, { type: 'answer', choice: String(round.answer) }).state;
        expect(state.solved).toBe(true);
        state = step(activity, state, { type: 'next' }).state;
      }
      expect(state.phase).toBe('bonus-offer');
      expect(step(activity, state, { type: 'bonus', accept: false }).state.phase).toBe('done');
      state = step(activity, state, { type: 'bonus', accept: true }).state;
      const bonus = currentRound(activity, state);
      expect(bonus.optional).toBe(true);
      expect(checkRound(bonus, String(bonus.answer))).toBe('correct');
    }
  });

  it('keeps localized models between instructions and callouts in both lesson consumers', () => {
    for (const activity of preschoolActivities)
      for (const round of activity.rounds) {
        const ids = [lineId.prompt(activity.id, round.id), lineId.callout(activity.id, round.id)];
        expect(withPractice(ids, activity, round)).toEqual([
          ids[0],
          lineId.practice(activity.id, round.id),
          ids[1],
        ]);
        const model = roundScript(activity, round).find((line) => line.id.endsWith('.practice'));
        expect(model).toMatchObject(round.practice ?? {});
        if (model?.language === 'es-ES')
          expect(clipFor(baselinePath.voice?.clips ?? [], model)).toBeUndefined();
      }
  });

  it('renders spelling letters without unrelated pictures and escapes word stimuli', () => {
    const activity = preschoolActivities.find((item) => item.id === 'little-word-builders');
    const round = activity?.rounds[0];
    if (round?.kind !== 'choose') throw new Error('spelling fixture');
    for (const orientation of ['wide', 'tall'] as const) {
      const svg = sceneSvg(
        skyIslands,
        { ...round, stimulusText: '<X & _' },
        { orientation, built: 0, planks: 4, neutral: false },
      );
      expect(svg).toContain('&lt;X &amp; _');
      expect(svg).not.toContain('<X');
      expect(sceneLayout(round, orientation, 4, false).choices.map((choice) => choice.ariaLabel)).toEqual([
        'T',
        'P',
      ]);
    }
    const bad = structuredClone(baselinePath);
    const textRound = bad.activities.find((item) => item.id === activity?.id)?.rounds[0];
    if (textRound?.kind !== 'choose') throw new Error('fixture');
    textRound.stimulus.push({ color: 'blue', shape: 'circle' });
    expect(() => parseLearningPath(bad)).toThrow('either text or picture');
  });

  it('restores older six-lesson family backups without losing the five new lessons', () => {
    const old = {
      baselineId: baselinePath.id,
      baselineVersion: '3.0.0',
      title: 'Family path',
      description: 'Together.',
      introductions: baselinePath.activities
        .slice(0, 6)
        .map((activity) => ({ activityId: activity.id, text: 'Our adventure.' })),
    };
    const restored = applyDraft(baselinePath, old);
    expect(restored.activities).toHaveLength(11);
    expect(restored.activities[0]?.introduction).toBe('Our adventure.');
    expect(restored.activities.slice(6)).toEqual(baselinePath.activities.slice(6));
    expect(() => applyDraft(baselinePath, { ...old, baselineVersion: '3.1.0' })).toThrow();
  });
});

describe('Spanish browser voice', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([true, false])(
    'uses a Spanish voice when available=%s and never substitutes an English voice',
    async (available) => {
      const spoken: { text: string; lang: string; voice?: { lang: string } | null }[] = [];
      const missing = vi.fn();
      const speech = {
        getVoices: () => [{ lang: 'en-US' }, ...(available ? [{ lang: 'es-MX' }] : [])],
        addEventListener() {},
        removeEventListener() {},
        cancel() {},
        speak(utterance: SpeechSynthesisUtterance) {
          spoken.push(utterance);
          queueMicrotask(() => utterance.onend?.({} as SpeechSynthesisEvent));
        },
      };
      vi.stubGlobal('window', { speechSynthesis: speech });
      vi.stubGlobal(
        'SpeechSynthesisUtterance',
        class {
          text: string;
          constructor(text: string) {
            this.text = text;
          }
        },
      );
      vi.useFakeTimers();
      try {
        const voice = createVoicePlayer({ clips: [], onUnavailable: missing });
        const playing = voice.play([{ id: 'test.practice', text: 'Adiós', language: 'es-ES', cues: [] }]);
        await vi.runAllTimersAsync();
        await playing;
        if (available)
          expect(spoken).toMatchObject([{ text: 'Adiós', lang: 'es-ES', voice: { lang: 'es-MX' } }]);
        else {
          expect(spoken).toEqual([]);
          expect(missing).toHaveBeenCalledOnce();
        }
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
