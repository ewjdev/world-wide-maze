import {
  applyDraft,
  baselinePath,
  type LearningPath,
  learningScript,
  readLearningHtml,
  requiredRounds,
} from '@wwm/learning';
import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  homePage,
  lessonPage,
  planksBuilt,
  portablePage,
  roundCheck,
  spokenHtml,
} from '../src/render.ts';

const compare = baselinePath.activities.find((activity) => activity.id === 'compare-groups');
if (!compare) throw new Error('compare-groups missing');

describe('readable HTML and machine intent', () => {
  it('publishes each lesson’s intro, first round, scene and grown-up notes before any JavaScript', () => {
    const home = homePage(baselinePath);
    for (const activity of baselinePath.activities) {
      expect(home).toContain(`/lessons/${activity.id}/`);
      const html = lessonPage(baselinePath, activity);
      const first = activity.rounds[0];
      expect(html).toContain(`data-learning-activity="${activity.id}"`);
      expect(html).toContain(escapeHtml(activity.introduction));
      expect(html).toContain(`id="pip-start"`);
      // the first round is on the page, with its scene and (disabled) answer buttons
      expect(html).toContain(`data-learning-round="${first?.id}"`);
      expect(html).toContain(spokenHtml(first?.prompt ?? ''));
      expect(html).toContain('class="wwm-scene"');
      expect(html.match(/class="choice-hit"[^>]*disabled/g)?.length).toBeGreaterThanOrEqual(2);
      // every round is readable for grown-ups
      for (const round of activity.rounds) {
        expect(html).toContain(escapeHtml(round.prompt));
        for (const hint of round.hints) expect(html).toContain(escapeHtml(hint));
        expect(html).toContain(escapeHtml(round.success));
      }
      expect(html).toContain(escapeHtml(activity.objective));
      expect(html).toContain(escapeHtml(activity.offlineActivity));
      expect(html).toContain('One play-through is practice, not an assessment of mastery.');
      expect(html).toContain(learningScript(baselinePath));
      // without JavaScript the stage is revealed by a <noscript> style
      expect(html).toContain('<noscript><style>#stage[hidden]{display:block!important}');
    }
  });

  it('describes compare-groups as a 5-round challenge and names what each round checks', () => {
    expect(homePage(baselinePath)).toContain('5-round challenge with the match tool');
    const checks = compare.rounds.map((round, index) => roundCheck(compare, round, index));
    expect(checks).toEqual([
      'Warm-up: 2 in a dice pattern vs 4 in a dice pattern',
      'Close call: 5 scattered vs 4 scattered',
      'Trick: 3 spread out vs 5 bunched up',
      'Trick again: 6 small bunched up vs 4 big spread out (played only if round 3 needed the match tool)',
      'Same: 4 spread out vs 4 bunched up, or “Same”',
      'Bonus: 3 in a dice pattern vs 6 in a dice pattern (optional)',
      'Bonus, how many more: 3 vs 6; choose 2, 3, 4 (optional)',
    ]);
  });

  it('builds one plank per required round', () => {
    expect(requiredRounds(compare)).toBe(4);
    expect(compare.rounds.map((_, index) => planksBuilt(compare, index))).toEqual([0, 1, 2, 3, 3, 4, 4]);
    expect(planksBuilt(compare, 2, true)).toBe(3);
    // the conditional follow-up and bonus rounds add no plank
    expect(planksBuilt(compare, 3, true)).toBe(3);
    expect(planksBuilt(compare, 6, true)).toBe(4);
  });

  it('keeps word spans text-identical to the spoken line', () => {
    const text = 'Tricky one!  Some <gems> are "spread" out.';
    const html = spokenHtml(text);
    expect(html.replace(/<[^>]+>/g, '')).toBe(escapeHtml(text));
    expect(html.match(/data-w=/g)).toHaveLength(7);
  });

  it('escapes authored strings in visible HTML as well as in JSON', () => {
    const title = '<img src=x onerror=alert(1)>';
    const html = homePage({ ...baselinePath, title });
    expect(html).not.toContain(title);
    expect(html).toContain('&lt;img');
    const lesson = lessonPage(baselinePath, { ...compare, introduction: title });
    expect(lesson).not.toContain(title);
    expect(portablePage({ ...baselinePath, title })).not.toContain(title);
  });
});

describe('portable download', () => {
  const invariants = (html: string) => {
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script id="wwm-learning" type="application/json">');
    expect(html).not.toContain('src=');
    expect(html).not.toMatch(/href=|url\(|@import|<link|<img|<iframe/i);
    expect(html.match(/<article data-learning-activity=/g)).toHaveLength(6);
  };

  it('has one inert JSON script, no external resources, and the themed pictures inline', () => {
    const html = portablePage(baselinePath);
    invariants(html);
    const rounds = baselinePath.activities.reduce((sum, activity) => sum + activity.rounds.length, 0);
    expect(html.match(/class="wwm-scene"/g)).toHaveLength(rounds);
    for (const activity of baselinePath.activities) {
      expect(html).toContain(escapeHtml(activity.objective));
      expect(html).toContain(escapeHtml(activity.parentNote));
      for (const round of activity.rounds) {
        expect(html).toContain(escapeHtml(round.prompt));
        for (const hint of round.hints) expect(html).toContain(escapeHtml(hint));
        expect(html).toContain(escapeHtml(round.success));
      }
    }
  });

  it('round-trips through readLearningHtml, for the baseline and a family fork', () => {
    expect(readLearningHtml(portablePage(baselinePath))).toEqual(baselinePath);
    const fork: LearningPath = applyDraft(baselinePath, {
      baselineId: baselinePath.id,
      baselineVersion: '1.0.0',
      title: 'Space </script><script>alert(1)</script> discoveries',
      description: 'Explore together.',
      introductions: baselinePath.activities.map((activity) => ({
        activityId: activity.id,
        text: 'Pip blasts off to a new planet.',
      })),
    });
    const html = portablePage(fork, '2026-09-26T12:00:00.000Z');
    invariants(html);
    expect(html).toContain('Family introductions accepted 2026-09-26T12:00:00.000Z.');
    expect(readLearningHtml(html)).toEqual(fork);
  });
});
