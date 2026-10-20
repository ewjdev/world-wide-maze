import { describe, expect, it } from 'vitest';
import {
  type Activity,
  applyDraft,
  baselinePath,
  currentRound,
  drawFresh,
  evidenceId,
  evidenceSchema,
  expandActivity,
  type GeneratorSpec,
  generateRound,
  initialState,
  type LearningEvidence,
  type LearningPath,
  layoutGroup,
  objectiveProgress,
  parseLearningPath,
  type Round,
  requiredRounds,
  roundEvidence,
  roundHash,
  roundIssues,
  roundKey,
  roundSchema,
  step,
} from '../src/index.ts';

const clone = <T>(value: T): T => structuredClone(value);
const activity = (path: LearningPath, id: string) => path.activities.find((a) => a.id === id) as Activity;

/** The baseline with compare-groups asking for two fresh examples. */
function withFresh(count = 2): LearningPath {
  const path = clone(baselinePath);
  activity(path, 'compare-groups').fresh = { objective: 'compare-groups', count };
  return parseLearningPath(path);
}

describe('objective checks', () => {
  const compare = activity(baselinePath, 'compare-groups').rounds[0] as Extract<Round, { kind: 'compare' }>;

  it('accepts every baseline round', () => {
    for (const a of baselinePath.activities)
      for (const round of a.rounds) expect(roundIssues(round)).toEqual([]);
  });

  it('rejects spoken counts that are not on the islands', () => {
    expect(roundIssues({ ...compare, success: 'Yes! Five is more than two.' })).toEqual([
      "The success line says 5, which isn't on the islands.",
    ]);
    // "one" is usually an article, so it never fails.
    expect(roundIssues({ ...compare, success: 'Yes! Just one more gem. Four is more than two.' })).toEqual(
      [],
    );
  });

  it('rejects a spelling round whose completed word is not the spoken word', () => {
    const spelling = activity(baselinePath, 'little-word-builders').rounds[0] as Round;
    expect(roundIssues({ ...spelling, practice: { text: 'Cap', language: 'en-US' } })[0]).toContain('"CAT"');
  });

  it('rejects a Spanish colour or number that the answer does not show', () => {
    const color = activity(baselinePath, 'spanish-colors').rounds[0] as Round;
    expect(roundIssues({ ...color, practice: { text: 'azul', language: 'es-ES' } })[0]).toContain(
      'means blue',
    );
    const number = activity(baselinePath, 'spanish-counting').rounds[0] as Round;
    expect(roundIssues({ ...number, practice: { text: 'tres', language: 'es-ES' } })[0]).toContain('means 3');
  });

  it('is enforced by the document schema', () => {
    const bad = clone(baselinePath) as LearningPath;
    const round = activity(bad, 'compare-groups').rounds[0] as Extract<Round, { kind: 'compare' }>;
    round.success = 'Yes! Seven is more than two.';
    expect(() => parseLearningPath(bad)).toThrow(/Round \\?"r1\\?": The success line says 7/);
  });
});

describe('generators', () => {
  const specs: GeneratorSpec[] = [
    { kind: 'compare', max: 6, same: true, trick: true },
    { kind: 'compare', max: 8, same: false, trick: false },
    { kind: 'difference', max: 8 },
    { kind: 'count', targets: [2, 5, 8], options: 3 },
    { kind: 'spanish-color', words: ['rojo', 'azul', 'verde', 'amarillo'], options: 3 },
  ];

  it.each(specs)('always writes valid, checked, deterministic rounds: %o', (spec) => {
    const keys = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const round = generateRound(spec, seed, 'g1');
      expect(roundSchema.parse(round)).toEqual(round);
      expect(roundIssues(round), JSON.stringify(round)).toEqual([]);
      expect(generateRound(spec, seed, 'g1')).toEqual(round);
      keys.add(roundKey(round));
      if (round.kind !== 'choose')
        for (const group of round.islands) {
          // Gems stay on the narrowest island the scene draws.
          const aspect = 1.7;
          const { points, r } = layoutGroup(group, aspect);
          for (const [x, y] of points) {
            expect(x - r, JSON.stringify(group)).toBeGreaterThanOrEqual(-1e-9);
            expect(x + r, JSON.stringify(group)).toBeLessThanOrEqual(aspect + 1e-9);
            expect(y - r).toBeGreaterThanOrEqual(-1e-9);
            expect(y + r).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
    }
    // Unlike the model in the M0 spike, a generator keeps finding new items.
    expect(keys.size).toBeGreaterThan(spec.kind === 'spanish-color' ? 40 : 60);
  });

  it('offers "Same" on every compare round when equal islands are possible, so it is never a giveaway', () => {
    const spec: GeneratorSpec = { kind: 'compare', max: 6, same: true, trick: true };
    const rounds = Array.from({ length: 200 }, (_, i) => generateRound(spec, i + 1, 'g1'));
    const answers = rounds.map((round) => (round.kind === 'compare' ? round.answer : null));
    expect(rounds.every((round) => round.kind === 'compare' && round.allowSame)).toBe(true);
    expect(answers).toContain('same');
    expect(answers).toContain('a');
    expect(answers).toContain('b');
    expect(rounds.some((round) => round.prompt.startsWith('Tricky'))).toBe(true);
  });
});

describe('objectives and banks in the document', () => {
  it('ships baseline 3.2.0 with an objective per activity and generated banks', () => {
    expect(baselinePath.version).toBe('3.2.0');
    expect(baselinePath.objectives).toHaveLength(baselinePath.activities.length);
    expect(baselinePath.activities.every((a) => a.objectives?.[0] === a.id)).toBe(true);
    expect(baselinePath.banks?.map((bank) => bank.objective)).toEqual([
      'count-three',
      'count-five',
      'compare-groups',
      'spanish-colors',
    ]);
  });

  it.each([
    [
      'fresh examples without a bank',
      (p: LearningPath) => {
        activity(p, 'find-triangle').fresh = { objective: 'find-triangle', count: 1 };
      },
      'without a bank',
    ],
    [
      'an unknown activity objective',
      (p: LearningPath) => {
        activity(p, 'find-triangle').objectives = ['nope'];
      },
      'unknown objective',
    ],
    [
      'a round objective the activity does not practise',
      (p: LearningPath) => {
        (activity(p, 'find-triangle').rounds[0] as Round).objective = 'compare-groups';
      },
      "isn't one of the activity's",
    ],
    [
      'fresh examples for an objective the activity does not practise',
      (p: LearningPath) => {
        activity(p, 'find-triangle').fresh = { objective: 'compare-groups', count: 1 };
      },
      "activity's objectives",
    ],
    [
      'two banks for one objective',
      (p: LearningPath) => {
        p.banks?.push({ objective: 'count-three', generator: { kind: 'count', targets: [3], options: 2 } });
      },
      'more than one bank',
    ],
    [
      'a bonus round in a bank',
      (p: LearningPath) => {
        const round = { ...(activity(p, 'find-triangle').rounds[0] as Round), optional: true };
        p.banks?.push({ objective: 'find-triangle', items: [round] });
      },
      'must be a plain round',
    ],
  ])('rejects %s', (_name, mutate, message) => {
    const path = clone(baselinePath) as LearningPath;
    mutate(path);
    expect(() => parseLearningPath(path)).toThrow(message);
  });

  it('applies 3.1.0 family drafts to the 3.2.0 baseline', () => {
    const draft = {
      baselineId: baselinePath.id,
      baselineVersion: '3.1.0',
      title: 'Family path',
      description: 'Together.',
      introductions: baselinePath.activities.map((a) => ({ activityId: a.id, text: 'Our adventure.' })),
    };
    expect(applyDraft(baselinePath, draft).activities.every((a) => a.introduction === 'Our adventure.')).toBe(
      true,
    );
  });
});

describe('fresh examples', () => {
  it('plays fresh rounds after the required rounds and before the bonus', async () => {
    const path = withFresh(2);
    const base = activity(path, 'compare-groups');
    const { activity: expanded, origins } = await expandActivity(path, base, { seed: 7 });
    const ids = expanded.rounds.map((round) => round.id);
    const firstBonus = base.rounds.findIndex((round) => round.optional);
    expect(ids.slice(firstBonus, firstBonus + 2)).toEqual(['fresh-1', 'fresh-2']);
    expect(requiredRounds(expanded)).toBe(requiredRounds(base) + 2);
    expect(origins.get('fresh-1')).toMatchObject({
      objective: 'compare-groups',
      source: 'generator',
      fresh: true,
    });
    expect(origins.get('r1')).toMatchObject({ source: 'lesson', fresh: true });

    // The ordinary state machine plays them: answer everything right and reach the bonus offer.
    let state = step(expanded, initialState(expanded, { seed: 3 }), { type: 'start' }).state;
    const played: string[] = [];
    while (state.phase === 'round') {
      const round = currentRound(expanded, state);
      played.push(expanded.rounds[state.index]?.id ?? '');
      state = step(expanded, state, { type: 'answer', choice: String(round.answer) }).state;
      state = step(expanded, state, { type: 'next' }).state;
    }
    expect(played).toContain('fresh-2');
    expect(state.phase).toBe('bonus-offer');
  });

  it('is deterministic per seed and avoids items the child has met', async () => {
    const path = withFresh(3);
    const base = activity(path, 'compare-groups');
    const first = await drawFresh(path, base, { objective: 'compare-groups', count: 3, seed: 11 });
    expect(await drawFresh(path, base, { objective: 'compare-groups', count: 3, seed: 11 })).toEqual(first);
    const seen = new Set(first.map(({ origin }) => origin.item));
    const next = await drawFresh(path, base, { objective: 'compare-groups', count: 3, seed: 11, seen });
    expect(next.every(({ origin }) => origin.fresh && !seen.has(origin.item))).toBe(true);
    const authored = new Set(base.rounds.map(roundKey));
    expect(next.every(({ round }) => !authored.has(roundKey(round)))).toBe(true);
  });

  it('brings seen bank items back, marked not fresh, once the bank runs out', async () => {
    const path = clone(baselinePath) as LearningPath;
    const triangle = activity(path, 'find-triangle');
    const item = { ...(triangle.rounds[0] as Round), id: 'b1', prompt: 'Find the shape with three sides.' };
    path.banks?.push({ objective: 'find-triangle', items: [item] });
    triangle.fresh = { objective: 'find-triangle', count: 1 };
    const parsed = parseLearningPath(path);
    const seen = new Set([await roundHash(item)]);
    const [drawn] = await drawFresh(parsed, activity(parsed, 'find-triangle'), {
      objective: 'find-triangle',
      count: 1,
      seed: 1,
      seen,
    });
    expect(drawn?.origin).toMatchObject({ source: 'bank', fresh: false });
    expect(drawn?.round).toMatchObject({ id: 'fresh-1', objective: 'find-triangle', prompt: item.prompt });
  });

  it('identifies an item by what the child sees, not by its id', async () => {
    const round = activity(baselinePath, 'find-triangle').rounds[0] as Round;
    expect(await roundHash({ ...round, id: 'other', objective: 'x' })).toBe(await roundHash(round));
    expect(await roundHash({ ...round, prompt: 'Which one has three sides?' })).not.toBe(
      await roundHash(round),
    );
    expect(await roundHash(round)).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('evidence', () => {
  const NOW = Date.parse('2026-10-19T17:42:31.123Z');

  it('makes sortable UUIDv7 ids', () => {
    const a = evidenceId(NOW);
    const b = evidenceId(NOW + 1);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it('records a solved round with its help, at minute precision and without free text', async () => {
    const path = withFresh(1);
    const { activity: expanded, origins } = await expandActivity(path, activity(path, 'compare-groups'), {
      seed: 5,
    });
    let state = step(expanded, initialState(expanded), { type: 'start' }).state;
    const round = currentRound(expanded, state);
    const wrong = round.kind === 'compare' ? (round.answer === 'a' ? 'b' : 'a') : '';
    state = step(expanded, state, { type: 'answer', choice: wrong }).state;
    state = step(expanded, state, { type: 'hint' }).state;
    expect(() =>
      roundEvidence({
        profile: 'profile-1',
        activity: expanded,
        state,
        origin: origins.get('r1') as never,
        surface: 'lesson',
        input: 'tap',
        durationMs: 1,
      }),
    ).toThrow('solved');
    state = step(expanded, state, { type: 'answer', choice: String(round.answer) }).state;
    const event = roundEvidence({
      profile: 'profile-1',
      activity: expanded,
      state,
      origin: origins.get('r1') as never,
      surface: 'lesson',
      input: 'tap',
      durationMs: 42_000,
      now: NOW,
    });
    expect(event).toMatchObject({
      at: '2026-10-19T17:42:00.000Z',
      activity: 'compare-groups',
      objective: 'compare-groups',
      round: 'r1',
      source: 'lesson',
      outcome: 'after-retry',
      helpLevel: 2,
      duration: 'lt2m',
    });
    expect(evidenceSchema.parse(event)).toEqual(event);
    expect(() => evidenceSchema.parse({ ...event, note: 'Mia was great' })).toThrow();
  });
});

describe('objective progress', () => {
  let n = 0;
  const event = (at: string, over: Partial<LearningEvidence> = {}): LearningEvidence => ({
    v: 1,
    id: evidenceId(Date.parse(at) + n++),
    profile: 'profile-1',
    at,
    activity: 'compare-groups',
    objective: 'compare-groups',
    round: 'fresh-1',
    item: (n.toString(16) + 'a'.repeat(32)).slice(0, 32),
    source: 'generator',
    fresh: true,
    outcome: 'first-try',
    helpLevel: 0,
    surface: 'lesson',
    input: 'tap',
    duration: 'lt30s',
    ...over,
  });

  it('starts at "not started"', () => {
    expect(objectiveProgress([], ['compare-groups'])).toEqual([
      { objective: 'compare-groups', state: 'not-started', rounds: 0, solo: 0, helped: 0 },
    ]);
  });

  it('shows "with help" when the latest round needed the strategy, and "practising" otherwise', () => {
    const helped = event('2026-10-19T17:00:00.000Z', { helpLevel: 2 });
    expect(objectiveProgress([helped], ['compare-groups'])[0]?.state).toBe('with-help');
    const later = event('2026-10-19T17:05:00.000Z', { fresh: false });
    expect(objectiveProgress([helped, later], ['compare-groups'])[0]).toMatchObject({
      state: 'practising',
      rounds: 2,
      solo: 1,
      helped: 1,
    });
  });

  it('needs two fresh items on two of the family’s days for "got it on new examples"', () => {
    // 16:00 and 20:00 on October 19 in Los Angeles, but two different UTC days.
    const evening = [event('2026-10-19T23:00:00.000Z'), event('2026-10-20T03:00:00.000Z')];
    expect(
      objectiveProgress(evening, ['compare-groups'], { timeZone: 'America/Los_Angeles' })[0]?.state,
    ).toBe('practising');
    expect(objectiveProgress(evening, ['compare-groups'], { timeZone: 'UTC' })[0]?.state).toBe('got-it');
    const sameItem = [
      event('2026-10-18T17:00:00.000Z', { item: 'b'.repeat(32) }),
      event('2026-10-19T17:00:00.000Z', { item: 'b'.repeat(32) }),
    ];
    expect(objectiveProgress(sameItem, ['compare-groups'], { timeZone: 'UTC' })[0]?.state).toBe('practising');
    const notFresh = [
      event('2026-10-18T17:00:00.000Z', { fresh: false }),
      event('2026-10-19T17:00:00.000Z', { fresh: false }),
    ];
    expect(objectiveProgress(notFresh, ['compare-groups'], { timeZone: 'UTC' })[0]?.state).toBe('practising');
  });
});
