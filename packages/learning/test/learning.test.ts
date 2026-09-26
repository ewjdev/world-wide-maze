import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type Activity,
  applyDraft,
  baselinePath,
  checkpointSpec,
  checkRound,
  choiceIds,
  choicesInOrder,
  clipKey,
  compatibleActivities,
  createPersonalizationPrompt,
  initialState,
  type LearningPath,
  layoutGroup,
  learningScript,
  pairUp,
  parseDraft,
  parseLearningJson,
  parseLearningPath,
  pathScript,
  readLearningHtml,
  requiredRounds,
  roundScript,
  sceneLayout,
  sceneSvg,
  skyIslands,
  step,
  themeSchema,
} from '../src/index.ts';

const compare = baselinePath.activities.find((activity) => activity.id === 'compare-groups') as Activity;

function draft(version: string = baselinePath.version) {
  return {
    baselineId: baselinePath.id,
    baselineVersion: version,
    title: 'Space discoveries',
    description: 'Explore shapes together.',
    introductions: baselinePath.activities.map((activity) => ({
      activityId: activity.id,
      text: 'Imagine we are exploring a new planet with Pip.',
    })),
  };
}

describe('learning document boundary', () => {
  it('keeps six activities whose every round has a valid, self-consistent answer', () => {
    expect(parseLearningPath(baselinePath).activities).toHaveLength(6);
    for (const activity of baselinePath.activities)
      for (const round of activity.rounds) {
        expect(checkRound(round, String(round.answer))).toBe('correct');
        const wrong = choiceIds(round).find((choice) => choice !== String(round.answer));
        expect(checkRound(round, wrong ?? '')).toBe('try-again');
        expect(() => checkRound(round, 'unknown')).toThrow();
      }
  });
  it('rejects answers that contradict the gem counts, and equal islands without a "same" choice', () => {
    const lying = structuredClone(baselinePath);
    const round = lying.activities[2]?.rounds[0];
    if (round?.kind !== 'compare') throw new Error('fixture');
    round.answer = 'a';
    expect(() => parseLearningPath(lying)).toThrow('answer must be');
    const noSame = structuredClone(baselinePath);
    const equal = noSame.activities[2]?.rounds.find((r) => r.id === 'r4');
    if (equal?.kind !== 'compare') throw new Error('fixture');
    equal.allowSame = false;
    expect(() => parseLearningPath(noSame)).toThrow('same');
  });
  it('rejects unknown versions, duplicate IDs, bad prerequisites, and misplaced bonus rounds', () => {
    expect(() => parseLearningPath({ ...baselinePath, format: 'future/99' })).toThrow();
    const duplicate = structuredClone(baselinePath);
    (duplicate.activities[1] as Activity).id = (duplicate.activities[0] as Activity).id;
    expect(() => parseLearningPath(duplicate)).toThrow();
    const order = structuredClone(baselinePath);
    (order.activities[0] as Activity).prerequisites = ['count-five'];
    expect(() => parseLearningPath(order)).toThrow();
    const bonusFirst = structuredClone(baselinePath);
    const rounds = (bonusFirst.activities[2] as Activity).rounds;
    rounds.push(rounds.splice(4, 1)[0] as (typeof rounds)[number]);
    expect(() => parseLearningPath(bonusFirst)).toThrow('Optional');
  });
  it('rejects oversized input and malformed JSON', () => {
    expect(() => parseLearningJson('x'.repeat(200_001))).toThrow('too large');
    expect(() => parseLearningJson('{oops')).toThrow();
  });
  it('stays well inside the size budget with the theme and voice timings embedded', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(baselinePath)).length;
    expect(bytes).toBeLessThan(200_000);
  });
  it('cannot break out of its inert JSON script and round trips through HTML text', () => {
    const title = '</script><img src=x onerror=alert(1)>&';
    const html = learningScript({ ...baselinePath, title });
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain('<img');
    expect(readLearningHtml(`<html><body><p>hi</p>${html}</body></html>`).title).toBe(title);
    expect(() => readLearningHtml(`${html}${html}`)).toThrow('exactly one');
    expect(() => readLearningHtml('<p>no data</p>')).toThrow('exactly one');
  });
  it('only offers activities whose every round kind the consumer supports', () => {
    expect(compatibleActivities(baselinePath, ['choose', 'compare', 'difference'])).toHaveLength(6);
    expect(compatibleActivities(baselinePath, ['choose'])).toHaveLength(5);
    expect(compatibleActivities(baselinePath, ['compare'])).toHaveLength(0);
  });
  it('upgrades a Phase 19 (0.1) document into one-round activities', () => {
    const legacy = {
      format: 'wwm-learning/0.1',
      id: 'little-discoveries',
      version: '1.0.0',
      title: 'Old path',
      description: 'From before.',
      language: 'en',
      suggestedAges: [4, 6],
      reviewStatus: 'pilot-needs-educator-review',
      provenance: 'original-baseline',
      activities: [
        {
          id: 'count-three',
          title: 'One, two, three',
          domain: 'counting',
          objective: 'Count three.',
          introduction: 'Hello.',
          prompt: 'Which group has three circles?',
          stimulus: [],
          interaction: 'single-choice',
          options: [
            { id: 'two', label: 'Two circles', tokens: [{ shape: 'circle', color: 'blue' }] },
            { id: 'three', label: 'Three circles', tokens: [{ shape: 'circle', color: 'blue' }] },
          ],
          answerId: 'three',
          hint: 'Count slowly.',
          explanation: 'Three!',
          parentNote: 'Notice.',
          offlineActivity: 'Blocks.',
          prerequisites: [],
        },
      ],
    };
    const upgraded = parseLearningJson(JSON.stringify(legacy));
    expect(upgraded.format).toBe('wwm-learning/0.2');
    expect(upgraded.activities[0]?.rounds).toHaveLength(1);
    expect(upgraded.activities[0]?.rounds[0]?.answer).toBe('three');
    expect(upgraded.theme.id).toBe('sky-islands');
  });
});

describe('theme data is declarative and safe', () => {
  it('accepts the default theme', () => {
    expect(() => themeSchema.parse(skyIslands)).not.toThrow();
  });
  it('rejects URLs, markup, unknown palette keys, arcs, and oversized themes', () => {
    const withUrl = structuredClone(skyIslands) as unknown as { sprites: { pip: { parts: unknown[] } } };
    withUrl.sprites.pip.parts.push({ type: 'image', href: 'https://example.com/x.png' });
    expect(() => themeSchema.parse(withUrl)).toThrow();
    const script = structuredClone(skyIslands);
    script.sprites.gem.parts.push({ type: 'path', d: 'M0 0 L10 10" onload="alert(1)' });
    expect(() => themeSchema.parse(script)).toThrow();
    const arc = structuredClone(skyIslands);
    arc.sprites.gem.parts.push({ type: 'path', d: 'M0 0 A 5 5 0 0 1 10 10' });
    expect(() => themeSchema.parse(arc)).toThrow();
    const palette = structuredClone(skyIslands) as unknown as {
      sprites: { gem: { parts: { fill: string }[] } };
    };
    (palette.sprites.gem.parts[0] as { fill: string }).fill = 'url(#x)';
    expect(() => themeSchema.parse(palette)).toThrow();
    const color = structuredClone(skyIslands);
    color.palette.gem = 'red; background:url(x)';
    expect(() => themeSchema.parse(color)).toThrow();
    const big = structuredClone(skyIslands);
    for (let i = 0; i < 23; i++) big.sprites.cloud.parts.push({ type: 'path', d: 'M0 0 '.repeat(90).trim() });
    expect(() => themeSchema.parse(big)).toThrow();
  });
  it('renders scenes containing no document text other than escaped labels', () => {
    const svg = sceneSvg(skyIslands, compare.rounds[0] as Activity['rounds'][number], {
      orientation: 'wide',
      planks: 5,
      built: 2,
    });
    expect(svg).not.toMatch(/<script|href=|url\(|on[a-z]+=/i);
    expect(svg.match(/data-gem="a-/g)).toHaveLength(2);
    expect(svg.match(/data-gem="b-/g)).toHaveLength(4);
    expect(svg.match(/data-pair=/g)).toHaveLength(2);
    expect(svg.match(/data-plank=/g)).toHaveLength(2);
  });
});

describe('layout and matching', () => {
  it('is deterministic, keeps gems apart, and keeps them on the island', () => {
    for (const round of compare.rounds) {
      if (round.kind === 'choose') continue;
      for (const group of round.islands) {
        const one = layoutGroup(group, 1.7);
        expect(layoutGroup(group, 1.7)).toEqual(one);
        expect(one.points).toHaveLength(group.count);
        for (const [x, y] of one.points) {
          expect(x - one.r).toBeGreaterThanOrEqual(-1e-9);
          expect(x + one.r).toBeLessThanOrEqual(1.7 + 1e-9);
          expect(y - one.r).toBeGreaterThanOrEqual(-1e-9);
          expect(y + one.r).toBeLessThanOrEqual(1 + 1e-9);
        }
        for (const [i, p] of one.points.entries())
          for (const q of one.points.slice(i + 1))
            expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeGreaterThan(one.r * 2);
      }
    }
  });
  it('makes the trick round look the wrong way round: the smaller group spans wider', () => {
    const trick = compare.rounds.find((round) => round.id === 'r3');
    if (trick?.kind !== 'compare') throw new Error('fixture');
    const span = (points: [number, number][]) =>
      Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]));
    const a = layoutGroup(trick.islands[0]);
    const b = layoutGroup(trick.islands[1]);
    expect(a.points.length).toBeLessThan(b.points.length);
    expect(span(a.points)).toBeGreaterThan(span(b.points) * 1.8);
  });
  it('pairs one to one and reports the leftovers', () => {
    const three = layoutGroup({ count: 3, arrangement: 'dice', size: 'medium' });
    const six = layoutGroup({ count: 6, arrangement: 'dice', size: 'medium' });
    expect(pairUp(three, six)).toEqual({
      pairs: [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      extra: 'b',
      leftovers: [3, 4, 5],
    });
    expect(pairUp(three, three).extra).toBeNull();
    expect(pairUp(six, three).extra).toBe('a');
  });
});

describe('Pip’s script', () => {
  it('generates counting and matching lines from the gem counts, with cues on the right words', () => {
    const trick = compare.rounds.find((round) => round.id === 'r3');
    if (!trick) throw new Error('fixture');
    const lines = new Map(roundScript(compare, trick).map((line) => [line.id, line]));
    const countB = lines.get('compare-groups.r3.count-b');
    expect(countB?.text).toBe('One, two, three, four, five. Five gems.');
    expect(countB?.cues.map((cue) => cue.word)).toEqual([0, 1, 2, 3, 4]);
    const match = lines.get('compare-groups.r3.match');
    expect(match?.text).toBe('Match, match, match. Two left over!');
    expect(match?.cues.at(-1)).toEqual({ word: 3, type: 'leftovers' });
    const same = roundScript(
      compare,
      compare.rounds.find((round) => round.id === 'r4') as Activity['rounds'][number],
    );
    expect(same.find((line) => line.id.endsWith('.match'))?.text).toBe(
      'Match, match, match, match. No leftovers. They’re the same!',
    );
  });
  it('keeps every line short enough to voice and every id unique', () => {
    const lines = pathScript(baselinePath);
    expect(new Set(lines.map((line) => line.id)).size).toBe(lines.length);
    for (const line of lines) expect(line.text.length).toBeLessThanOrEqual(300);
  });
  it('has a clip with matching text and hash for every baseline line (else run `pnpm learning:voice --write`)', () => {
    const voice = baselinePath.voice;
    expect(voice, 'baseline voice manifest is empty').toBeDefined();
    if (!voice) return;
    const clips = new Map(voice.clips.map((clip) => [clip.line, clip]));
    const stale: string[] = [];
    for (const line of pathScript(baselinePath)) {
      const clip = clips.get(line.id);
      const hash = createHash('sha256').update(clipKey(line.text, voice)).digest('hex').slice(0, 32);
      if (!clip || clip.text !== line.text || clip.hash !== hash) stale.push(line.id);
      else expect(clip.words).toHaveLength(line.text.trim().split(/\s+/).length);
    }
    expect(stale, 'stale or missing clips: run `pnpm learning:voice --write`').toEqual([]);
  });
});

describe('a play-through', () => {
  const play = (activity: Activity, events: Parameters<typeof step>[2][]) => {
    let state = initialState(activity);
    const steps = [];
    for (const event of events) {
      const next = step(activity, state, event);
      steps.push(next);
      state = next.state;
    }
    return { state, steps };
  };

  it('climbs the hint ladder: nudge, then the match tool, then a counted worked example', () => {
    const { steps } = play(compare, [
      { type: 'start' },
      { type: 'answer', choice: 'a' },
      { type: 'answer', choice: 'a' },
      { type: 'answer', choice: 'a' },
    ]);
    expect(steps[0]?.say).toEqual(['compare-groups.intro', 'compare-groups.r1.prompt']);
    expect(steps[1]).toMatchObject({ say: ['compare-groups.r1.hint1'], show: 'retry' });
    expect(steps[2]).toMatchObject({
      say: ['compare-groups.r1.hint2', 'compare-groups.r1.match'],
      show: 'match',
    });
    expect(steps[3]).toMatchObject({
      say: ['compare-groups.r1.count-a', 'compare-groups.r1.count-b', 'compare-groups.r1.hint3'],
      show: 'worked',
    });
  });
  it('locks a solved round: later taps and hints change nothing', () => {
    const { state, steps } = play(compare, [
      { type: 'start' },
      { type: 'answer', choice: 'b' },
      { type: 'answer', choice: 'a' },
      { type: 'hint' },
    ]);
    expect(steps[1]).toMatchObject({ say: ['compare-groups.r1.success'], show: 'celebrate' });
    expect(steps[2]?.say).toEqual([]);
    expect(steps[3]?.say).toEqual([]);
    expect(state).toMatchObject({ solved: true, result: 'correct', choice: 'b', built: 1 });
  });
  it('plays the big-and-small follow-up only when the trick round needed the strategy', () => {
    const smooth = play(compare, [
      { type: 'start' },
      ...['b', 'a', 'b'].flatMap((choice) => [
        { type: 'answer' as const, choice },
        { type: 'next' as const },
      ]),
    ]);
    expect(compare.rounds[smooth.state.index]?.id).toBe('r4');
    const helped = play(compare, [
      { type: 'start' },
      { type: 'answer', choice: 'b' },
      { type: 'next' },
      { type: 'answer', choice: 'a' },
      { type: 'next' },
      { type: 'match' },
      { type: 'answer', choice: 'b' },
      { type: 'next' },
    ]);
    expect(compare.rounds[helped.state.index]?.id).toBe('r3b');
    expect(helped.state.built).toBe(3);
    const afterFollowUp = step(compare, helped.state, { type: 'answer', choice: 'a' }).state;
    expect(afterFollowUp.built).toBe(3);
  });
  it('offers the bonus, which can be skipped straight to the finale', () => {
    const toBonus: Parameters<typeof step>[2][] = [
      { type: 'start' },
      ...['b', 'a', 'b', 'same'].flatMap((choice) => [
        { type: 'answer' as const, choice },
        { type: 'next' as const },
      ]),
    ];
    const offered = play(compare, toBonus);
    expect(offered.state.phase).toBe('bonus-offer');
    expect(offered.steps.at(-1)?.say).toEqual(['pip.bonus']);
    expect(offered.state.built).toBe(requiredRounds(compare));
    const skipped = play(compare, [...toBonus, { type: 'bonus', accept: false }]);
    expect(skipped.state.phase).toBe('done');
    expect(skipped.steps.at(-1)?.say).toEqual(['compare-groups.finale']);
    const played = play(compare, [
      ...toBonus,
      { type: 'bonus', accept: true },
      { type: 'answer', choice: 'b' },
      { type: 'next' },
      { type: 'answer', choice: '3' },
      { type: 'next' },
    ]);
    expect(played.state.phase).toBe('done');
  });
});

describe('consumers', () => {
  it('places answer targets inside the scene in both orientations', () => {
    for (const round of compare.rounds)
      for (const orientation of ['wide', 'tall'] as const) {
        const layout = sceneLayout(round, orientation, requiredRounds(compare));
        expect(layout.choices.map((choice) => choice.id).sort()).toEqual(choiceIds(round).sort());
        for (const { box } of layout.choices) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w).toBeLessThanOrEqual(layout.width);
          expect(box.y + box.h).toBeLessThanOrEqual(layout.planks[0]?.y ?? layout.height);
        }
      }
  });
  it('orders choices left to right for tilt selection, with "same" in the middle', () => {
    const equal = compare.rounds.find((round) => round.id === 'r4');
    if (!equal) throw new Error('fixture');
    expect(choicesInOrder(equal)).toEqual(['a', 'same', 'b']);
  });
  it('describes a round for a game without any rendering', () => {
    const spec = checkpointSpec(baselinePath.theme, compare, 'r3');
    expect(spec).toMatchObject({ kind: 'compare', answer: 'b', promptLine: 'compare-groups.r3.prompt' });
    expect(spec.choices.map((choice) => choice.id)).toEqual(['a', 'b']);
    expect(spec.islands.map((island) => island.gems.length)).toEqual([3, 5]);
    expect(checkpointSpec(baselinePath.theme, compare, 'r3')).toEqual(spec);
  });
});

describe('parent-reviewed personalization', () => {
  it('changes the framing without mutating rounds or answer criteria', () => {
    const before = JSON.stringify(baselinePath);
    const path: LearningPath = applyDraft(baselinePath, draft());
    expect(path.title).toBe('Space discoveries');
    expect(JSON.stringify(baselinePath)).toBe(before);
    for (const [index, activity] of path.activities.entries()) {
      const original = baselinePath.activities[index];
      expect({ ...activity, introduction: original?.introduction }).toEqual(original);
    }
  });
  it('still accepts a family draft saved against the Phase 19 baseline', () => {
    expect(applyDraft(baselinePath, draft('1.0.0')).provenance).toBe('parent-personalized-introductions');
  });
  it('refuses injected educational fields, missing/duplicate lessons, and stale baselines', () => {
    expect(() => parseDraft({ ...draft(), answer: 'wrong' }, baselinePath)).toThrow();
    expect(() => parseDraft({ ...draft(), baselineVersion: '0.0.0' }, baselinePath)).toThrow();
    const duplicate = draft();
    (duplicate.introductions[0] as { activityId: string }).activityId =
      duplicate.introductions[1]?.activityId ?? '';
    expect(() => parseDraft(duplicate, baselinePath)).toThrow();
    expect(() => parseDraft({ ...draft(), introductions: [] }, baselinePath)).toThrow();
  });
  it('exports an AI prompt grounded in the actual questions, Pip, and the exact response shape', () => {
    const prompt = createPersonalizationPrompt(baselinePath, 'excavators');
    expect(prompt).toContain('excavators');
    expect(prompt).toContain(baselinePath.activities[0]?.rounds[0]?.prompt);
    expect(prompt).toContain('Pip');
    expect(prompt).toContain('The parent will review');
  });
});
