import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Activity,
  applyDraft,
  applyFamilySettings,
  baselinePath,
  calloutLine,
  checkpointSpec,
  checkRound,
  choiceIds,
  choicesInOrder,
  clipKey,
  compatibleActivities,
  createPersonalizationPrompt,
  currentRound,
  describeLevel,
  followUpAfter,
  initialState,
  inputPolicy,
  judgeInput,
  keyToChoice,
  type LearningPath,
  type Level,
  layoutGroup,
  learningScript,
  levelPlan,
  levelRequires,
  levelsFor,
  pairUp,
  parseDraft,
  parseLearningJson,
  parseLearningPath,
  pathScript,
  playableLevels,
  playIssues,
  presentRound,
  readLearningHtml,
  requiredRounds,
  resolveLevel,
  resolveLocks,
  roundScript,
  SCENE_CSS,
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
    expect(upgraded.format).toBe('wwm-learning/0.3');
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
    // CSP-safe: no <style> element and no style attribute (a strict style-src would block both)
    expect(svg).not.toMatch(/<style|\sstyle=/i);
    const file = readFileSync(new URL('../src/scene.css', import.meta.url), 'utf8');
    expect(
      file.trim(),
      'scene.css is generated from SCENE_CSS: run `pnpm --filter @wwm/learning scene-css`',
    ).toBe(SCENE_CSS);
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
    const byText = new Map(voice.clips.map((clip) => [clip.text, clip]));
    const stale: string[] = [];
    for (const line of pathScript(baselinePath)) {
      const clip = byText.get(line.text);
      const hash = createHash('sha256').update(clipKey(line.text, voice)).digest('hex').slice(0, 32);
      if (!clip || clip.hash !== hash) stale.push(line.id);
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
    expect(steps[0]?.say).toEqual([
      'compare-groups.intro',
      'compare-groups.r1.prompt',
      'compare-groups.r1.callout',
    ]);
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

describe('Phase 22: callouts, shuffling and input', () => {
  it('names each choice in on-screen order with a cue on its first word', () => {
    const equal = compare.rounds.find((round) => round.id === 'r4') as Activity['rounds'][number];
    const callout = calloutLine(compare, equal);
    expect(callout.text).toBe('Island A, island B, or the same?');
    expect(callout.cues).toEqual([
      { word: 0, type: 'choice', id: 'a' },
      { word: 2, type: 'choice', id: 'b' },
      { word: 5, type: 'choice', id: 'same' },
    ]);
    const triangle = baselinePath.activities.find((activity) => activity.id === 'find-triangle') as Activity;
    expect(calloutLine(triangle, triangle.rounds[0] as Activity['rounds'][number]).text).toBe(
      'Square, circle, or triangle?',
    );
    const count = baselinePath.activities[0] as Activity;
    expect(calloutLine(count, count.rounds[0] as Activity['rounds'][number]).text).toBe(
      'Group A, group B, or group C?',
    );
  });
  it('shuffles positions per session, deterministically, keeping the answer right', () => {
    const trick = compare.rounds.find((round) => round.id === 'r3') as Activity['rounds'][number];
    let swapped = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const shown = presentRound(trick, seed);
      expect(presentRound(trick, seed)).toEqual(shown);
      if (shown.kind !== 'compare') throw new Error('kind');
      const [a, b] = shown.islands;
      expect(shown.answer).toBe(a.count > b.count ? 'a' : 'b');
      if (shown.answer === 'a') swapped++;
    }
    expect(swapped).toBeGreaterThan(5);
    expect(swapped).toBeLessThan(35);
    expect(presentRound(trick, 7, 'none')).toBe(trick);
  });
  it('plays a shuffled round through the state machine with the shuffled answer', () => {
    let state = initialState(compare, { seed: 12345 });
    state = step(compare, state, { type: 'start' }).state;
    const shown = currentRound(compare, state);
    const result = step(compare, state, { type: 'answer', choice: String(shown.answer) });
    expect(result.show).toBe('celebrate');
  });
  it('covers every shuffled callout order in the script so each has a clip', () => {
    const texts = new Set(pathScript(baselinePath).map((line) => line.text));
    const triangle = baselinePath.activities.find((activity) => activity.id === 'find-triangle') as Activity;
    for (let seed = 1; seed < 30; seed++)
      expect(
        texts.has(
          calloutLine(triangle, presentRound(triangle.rounds[0] as Activity['rounds'][number], seed)).text,
        ),
      ).toBe(true);
  });
  it('invites the declared input, falls back to what the device can do, and nudges twice before accepting', () => {
    const r2 = compare.rounds.find((round) => round.id === 'r2') as Activity['rounds'][number];
    const laptop = { tap: true, keyboard: true, tilt: false };
    const phone = { tap: true, keyboard: false, tilt: false };
    const policy = inputPolicy(baselinePath, compare, r2, laptop);
    expect(policy).toMatchObject({
      invited: ['letter-key'],
      promptLine: 'pip.input.letter-key',
      badges: true,
    });
    expect(judgeInput(policy, 'tap', 0)).toBe('nudge');
    expect(judgeInput(policy, 'tap', 1)).toBe('nudge');
    expect(judgeInput(policy, 'tap', 2)).toBe('accept');
    expect(judgeInput(policy, 'letter-key', 0)).toBe('accept');
    expect(inputPolicy(baselinePath, compare, r2, phone).invited).toEqual(['tap']);
    const tapOnly = { ...baselinePath, family: { levels: {}, tapOnly: true } };
    expect(inputPolicy(tapOnly, compare, r2, laptop)).toMatchObject({
      invited: ['tap', 'arrows'],
      badges: false,
    });
    expect(keyToChoice(r2, 'b')).toBe('b');
    const r4 = compare.rounds.find((round) => round.id === 'r4') as Activity['rounds'][number];
    expect(keyToChoice(r4, 's')).toBe('same');
    expect(keyToChoice(r4, 'x')).toBeNull();
  });
});

describe('Phase 22: levels and lock configuration', () => {
  it('ships the author’s levels with a default, and generates levels for lessons without any', () => {
    expect(levelsFor(compare).map((level) => level.id)).toEqual(['explore', 'goal-only', 'gated', 'mission']);
    expect(resolveLevel(baselinePath, compare).id).toBe('gated');
    const triangle = baselinePath.activities.find((activity) => activity.id === 'find-triangle') as Activity;
    expect(levelsFor(triangle).map((level) => level.id)).toEqual(['explore', 'gated']);
  });
  it('resolves each step’s lock from the level, with per-step overrides', () => {
    const mission = levelsFor(compare).find((level) => level.id === 'mission') as Level;
    expect(levelPlan(compare, mission).map((step) => [step.kind, step.lock])).toEqual([
      ['round', 'path'],
      ['round', 'none'],
      ['mission', 'path'],
      ['round', 'path'],
      ['mission', 'goal'],
      ['round', 'path'],
    ]);
    expect(resolveLocks(mission)).toMatchObject({
      connectors: ['bridge'],
      goal: true,
      signals: { beacon: false },
    });
  });
  it('describes each level in plain words from its configuration', () => {
    const [explore, goalOnly, gated, mission] = levelsFor(compare) as Level[];
    expect(describeLevel(compare, explore as Level)).toContain('Nothing is locked');
    expect(describeLevel(compare, goalOnly as Level)).toContain('the finish waits');
    expect(describeLevel(compare, gated as Level)).toBe(
      'Bridges and lifts stay locked until Pip’s question is answered. The finish waits too. A grown-up can open a lock.',
    );
    const text = describeLevel(compare, mission as Level);
    expect(text).toContain('Missions: collect 4 gems and find the island with the most gems.');
    expect(text).toContain('no light points to the gate');
  });
  it('offers only levels a game can fully honour', () => {
    expect(playableLevels(compare, ['locks.goal']).map((level) => level.id)).toEqual([
      'explore',
      'goal-only',
    ]);
    const all = [
      'locks.goal',
      'locks.path.bridge',
      'locks.path.elevator',
      'mission.collect',
      'mission.reach',
    ];
    expect(playableLevels(compare, all)).toHaveLength(4);
    expect(levelRequires(compare, levelsFor(compare)[3] as Level)).toEqual([
      'locks.goal',
      'locks.path.bridge',
      'mission.collect',
      'mission.reach',
    ]);
  });
  it('rejects contradictory lock configurations with readable messages', () => {
    const rounds = compare.rounds;
    const level = (locks: Level['locks'], steps: Level['steps'] = 'rounds'): Level => ({
      id: 'x',
      label: 'X',
      steps,
      locks,
    });
    expect(playIssues(rounds, { defaultLevel: 'x', levels: [level({ mode: 'path' })] })[0]).toContain(
      'needs connectors',
    );
    expect(
      playIssues(rounds, { defaultLevel: 'x', levels: [level({ mode: 'goal', goal: false })] })[0],
    ).toContain('always locks the finish');
    expect(
      playIssues(rounds, {
        defaultLevel: 'x',
        levels: [level({ mode: 'goal' }, [{ round: 'r1', lock: 'path' }])],
      })[0],
    ).toContain('only lock the path');
    expect(
      playIssues(rounds, {
        defaultLevel: 'x',
        levels: [level({ mode: 'goal' }, [{ round: 'r1', lock: 'none' }])],
      })[0],
    ).toContain('at least one step');
    expect(
      playIssues(rounds, {
        defaultLevel: 'x',
        levels: [level({ mode: 'none' }, [{ round: 'r2' }, { round: 'r1' }])],
      })[0],
    ).toContain('in the order');
    expect(playIssues(rounds, { defaultLevel: 'nope', levels: [level({ mode: 'none' })] })[0]).toContain(
      'defaultLevel',
    );
    expect(
      playIssues(rounds, { defaultLevel: 'x', levels: [level({ mode: 'none' }, [{ round: 'r3b' }])] })[0],
    ).toContain('not a required round');
  });
  it('records a grown-up’s level choice and tap-only setting, and rejects unknown levels', () => {
    const chosen = applyFamilySettings(baselinePath, {
      levels: { 'compare-groups': 'mission' },
      tapOnly: true,
    });
    expect(resolveLevel(chosen, compare).id).toBe('mission');
    expect(parseLearningPath(chosen).family).toEqual({
      levels: { 'compare-groups': 'mission' },
      tapOnly: true,
    });
    expect(() =>
      applyFamilySettings(baselinePath, { levels: { 'compare-groups': 'nope' }, tapOnly: false }),
    ).toThrow();
    expect(() =>
      parseLearningPath({
        ...baselinePath,
        family: { levels: { 'compare-groups': 'nope' }, tapOnly: false },
      }),
    ).toThrow();
  });
  it('lets a game jump to a level’s step and plays the triggered follow-up next', () => {
    let state = initialState(compare);
    let result = step(compare, state, { type: 'play', roundId: 'r3' });
    expect(result.say).toEqual([
      'compare-groups.intro',
      'compare-groups.r3.prompt',
      'compare-groups.r3.callout',
    ]);
    state = step(compare, result.state, { type: 'match' }).state;
    state = step(compare, state, { type: 'answer', choice: 'b' }).state;
    expect(followUpAfter(compare, state, 'r3')).toBe('r3b');
    result = step(compare, state, { type: 'play', roundId: 'r3b' });
    expect(result.say).toEqual(['compare-groups.r3b.prompt', 'compare-groups.r3b.callout']);
  });
  it('reads a Phase 20 (0.2) document', () => {
    const old = { ...structuredClone(baselinePath), format: 'wwm-learning/0.2', version: '2.0.0' } as Record<
      string,
      unknown
    >;
    delete old.play;
    expect(parseLearningPath(old).format).toBe('wwm-learning/0.3');
  });
});
