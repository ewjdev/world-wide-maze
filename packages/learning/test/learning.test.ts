import { describe, expect, it } from 'vitest';
import {
  applyDraft,
  baselinePath,
  checkAnswer,
  compatibleActivities,
  createPersonalizationPrompt,
  learningScript,
  parseDraft,
  parseLearningJson,
  parseLearningPath,
} from '../src/index.ts';

function draft() {
  return {
    baselineId: baselinePath.id,
    baselineVersion: baselinePath.version,
    title: 'Space discoveries',
    description: 'Explore shapes together.',
    introductions: baselinePath.activities.map((activity) => ({
      activityId: activity.id,
      text: 'Imagine we are exploring a new planet.',
    })),
  };
}

describe('learning document boundary', () => {
  it('keeps six usable baseline activities with valid answers and prerequisites', () => {
    expect(parseLearningPath(baselinePath).activities).toHaveLength(6);
    for (const activity of baselinePath.activities) {
      expect(checkAnswer(activity, activity.answerId)).toBe('correct');
      const wrong = activity.options.find((option) => option.id !== activity.answerId);
      expect(checkAnswer(activity, wrong?.id ?? '')).toBe('try-again');
      expect(() => checkAnswer(activity, 'unknown')).toThrow();
    }
  });
  it('rejects unknown versions, dangling answers, duplicate IDs, and invalid prerequisites', () => {
    const invalid = structuredClone(baselinePath);
    invalid.activities[0].answerId = 'unknown';
    expect(() => parseLearningPath(invalid)).toThrow();
    expect(() => parseLearningPath({ ...baselinePath, format: 'future/99' })).toThrow();
    const duplicate = structuredClone(baselinePath);
    duplicate.activities[1].id = duplicate.activities[0].id;
    expect(() => parseLearningPath(duplicate)).toThrow();
    const order = structuredClone(baselinePath);
    order.activities[0].prerequisites = ['count-five'];
    expect(() => parseLearningPath(order)).toThrow();
  });
  it('rejects oversized input and malformed JSON', () => {
    expect(() => parseLearningJson('x'.repeat(100001))).toThrow('too large');
    expect(() => parseLearningJson('{oops')).toThrow();
  });
  it('cannot break out of its inert JSON script and round trips the original text', () => {
    const title = '</script><img src=x onerror=alert(1)>&';
    const html = learningScript({ ...baselinePath, title });
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain('<img');
    expect(parseLearningJson(html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))).title).toBe(
      title,
    );
  });
  it('only offers supported interaction types', () => {
    expect(compatibleActivities(baselinePath, ['single-choice'])).toHaveLength(6);
    expect(compatibleActivities(baselinePath, ['trace'])).toHaveLength(0);
  });
});

describe('parent-reviewed personalization', () => {
  it('changes the framing without mutating baseline content or answer criteria', () => {
    const before = JSON.stringify(baselinePath);
    const path = applyDraft(baselinePath, draft());
    expect(path.title).toBe('Space discoveries');
    expect(JSON.stringify(baselinePath)).toBe(before);
    for (const [index, activity] of path.activities.entries()) {
      const original = baselinePath.activities[index];
      expect({ ...activity, introduction: original?.introduction }).toEqual(original);
    }
  });
  it('refuses injected educational fields, missing/duplicate lessons, and stale baselines', () => {
    expect(() => parseDraft({ ...draft(), answerId: 'wrong' }, baselinePath)).toThrow();
    expect(() => parseDraft({ ...draft(), baselineVersion: '0.0.0' }, baselinePath)).toThrow();
    const duplicate = draft();
    duplicate.introductions[0].activityId = duplicate.introductions[1].activityId;
    expect(() => parseDraft(duplicate, baselinePath)).toThrow();
    expect(() => parseDraft({ ...draft(), introductions: [] }, baselinePath)).toThrow();
  });
  it('exports an AI prompt grounded in the actual questions and exact response shape', () => {
    const prompt = createPersonalizationPrompt(baselinePath, 'excavators');
    expect(prompt).toContain('excavators');
    expect(prompt).toContain(baselinePath.activities[0].prompt);
    expect(prompt).toContain('The parent will review');
  });
});
