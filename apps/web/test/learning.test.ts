/**
 * Phase 20 M4b: Pip gates. Gate placement on a stage (deterministic, the builder's portal rules), the glue from
 * gates to the shared lesson state machine, the cursor and tilt stepping, loading learning pages, and the
 * `wwm-learning:` href shared with the engine.
 */
import { readFileSync } from 'node:fs';
import { LEARNING_HREF as ENGINE_HREF, isLearningHref as engineIsLearning, portalColor } from '@wwm/engine';
import { baselinePath, initialState, type LearningPath, learningScript, lineId, step } from '@wwm/learning';
import { type StageData, validateStage } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import {
  choiceForDigit,
  gatesFor,
  LearningGates,
  moveCursor,
  openStep,
  TiltStepper,
} from '../src/learning/gates.ts';
import { gateNumber, isLearningHref, LEARNING_HREF, learningHref } from '../src/learning/href.ts';
import {
  LessonLoadError,
  lessonFromBaseline,
  lessonFromFile,
  lessonFromHtml,
  pickActivity,
} from '../src/learning/load.ts';
import {
  GATE_RADIUS_PX,
  GATE_SPACING_PX,
  gateSpots,
  KEEP_START_PX,
  MAX_GATES,
  placeGates,
  reachableIslands,
} from '../src/learning/placement.ts';

const HANDMADE = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;

const compare = baselinePath.activities.find((a) => a.id === 'compare-groups');
if (!compare) throw new Error('baseline lost compare-groups');
const dist = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);

describe('gate placement', () => {
  test('deterministic: the same stage gets the same gates', () => {
    const a = placeGates(HANDMADE, 5);
    const b = placeGates(structuredClone(HANDMADE), 5);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  test('keeps the builder’s distances: start, goal, other gates, on the island', () => {
    const gates = placeGates(HANDMADE, 5);
    for (const g of gates) {
      expect(dist(g.pos, HANDMADE.start.pos)).toBeGreaterThanOrEqual(KEEP_START_PX);
      expect(dist(g.pos, HANDMADE.goal.pos)).toBeGreaterThanOrEqual(KEEP_START_PX);
      for (const o of gates) if (o !== g) expect(dist(g.pos, o.pos)).toBeGreaterThanOrEqual(GATE_SPACING_PX);
      for (const it of HANDMADE.items)
        if (it.kind === 'small') expect(dist(g.pos, it.pos)).toBeGreaterThan(GATE_RADIUS_PX);
    }
    // the stage with the gates as portals is still a valid stage (bar the http(s)-only href rule for links)
    const errors = validateStage({
      ...HANDMADE,
      portals: gates.map((g, i) => ({
        id: i,
        islandId: g.islandId,
        pos: g.pos,
        href: `https://example.com/${i}`,
        label: `Pip gate ${i + 1}`,
        sourceElementId: 0,
      })),
    }).errors;
    expect(errors).toEqual([]);
  });

  test('spread from the start towards the goal, in order', () => {
    const gates = placeGates(HANDMADE, 4);
    expect(gates.length).toBe(4);
    const progress = gates.map((g) => g.progress);
    expect(progress).toEqual([...progress].sort((p, q) => p - q));
    expect(progress[0]).toBeLessThan(0.5);
    expect(progress[progress.length - 1]).toBeGreaterThan(0.5);
  });

  test('returns at most N (capped at MAX_GATES) and nothing when asked for none', () => {
    expect(placeGates(HANDMADE, 2).length).toBe(2);
    expect(placeGates(HANDMADE, 50).length).toBeLessThanOrEqual(MAX_GATES);
    expect(placeGates(HANDMADE, 0)).toEqual([]);
  });

  test('a stage with no room gets no gates', () => {
    // one small island around the start: everything is within 4 D of the start or the goal
    const tiny: StageData = {
      ...HANDMADE,
      islands: [
        {
          ...(HANDMADE.islands[0] as StageData['islands'][number]),
          contour: [
            [80, 150],
            [130, 150],
            [130, 190],
            [80, 190],
          ],
        },
      ],
      bridges: [],
      elevators: [],
      items: [],
      goal: { ...HANDMADE.goal, pos: [120, 170], islandId: HANDMADE.start.islandId },
    };
    expect(gateSpots(tiny)).toEqual([]);
    expect(placeGates(tiny, 5)).toEqual([]);
  });

  test('only islands the ball can reach', () => {
    const island = HANDMADE.islands[1] as StageData['islands'][number];
    const cut: StageData = { ...HANDMADE, bridges: HANDMADE.bridges.filter((b) => b.to !== island.id) };
    expect(reachableIslands(cut).has(island.id)).toBe(false);
    expect(gateSpots(cut).some((s) => s.islandId === island.id)).toBe(false);
  });
});

describe('learning hrefs', () => {
  test('same scheme as the engine; the engine draws the theme colour', () => {
    expect(LEARNING_HREF).toBe(ENGINE_HREF);
    const href = learningHref('compare-groups', 2, '#4F9FD6');
    expect(href).toBe('wwm-learning:compare-groups/2#4f9fd6');
    expect(isLearningHref(href) && engineIsLearning(href)).toBe(true);
    expect(gateNumber(href)).toBe(2);
    expect(portalColor(learningHref('x', 1, '#e0524f'))).toBe('#e0524f');
    expect(isLearningHref('https://example.com/')).toBe(false);
    expect(gateNumber('https://example.com/2')).toBeNull();
  });
});

describe('gates → the lesson state machine', () => {
  test('the first gate starts the lesson, a solved round moves on, an unsolved one is asked again', () => {
    let state = initialState(compare);
    const first = openStep(compare, state);
    expect(first.state.phase).toBe('round');
    expect(first.say).toEqual([
      lineId.gate,
      lineId.intro(compare.id),
      lineId.prompt(compare.id, 'r1'),
      lineId.callout(compare.id, 'r1'),
    ]);
    state = first.state;
    // skipped: the next gate asks the same round again
    expect(openStep(compare, state)).toMatchObject({ state, say: [lineId.prompt(compare.id, 'r1')] });
    state = step(compare, state, { type: 'answer', choice: 'b' }).state;
    expect(state.solved).toBe(true);
    const second = openStep(compare, state);
    expect(second.state.index).toBe(1);
    expect(second.say).toEqual([lineId.prompt(compare.id, 'r2'), lineId.callout(compare.id, 'r2')]);
  });

  test('after the main rounds a gate offers the bonus, and after that it only rolls on', () => {
    let state = initialState(compare);
    state = openStep(compare, state).state;
    for (const answer of ['b', 'a', 'b', 'same']) {
      state = step(compare, state, { type: 'answer', choice: answer }).state;
      state = openStep(compare, state).state;
    }
    expect(state.phase).toBe('bonus-offer');
    state = step(compare, state, { type: 'bonus', accept: false }).state;
    expect(state.phase).toBe('done');
    expect(openStep(compare, state).say).toEqual([lineId.rollOn]);
  });

  test('gates per stage: the main path plus the trick follow-up, capped', () => {
    expect(gatesFor(compare)).toBe(5);
    const one = baselinePath.activities.find((a) => a.id === 'count-three');
    expect(one && gatesFor(one)).toBe(1);
  });

  test('cursor, number keys and tilt stepping', () => {
    expect(moveCursor(null, -1, 2)).toBe(0);
    expect(moveCursor(null, 1, 3)).toBe(2);
    expect(moveCursor(0, -1, 3)).toBe(0);
    expect(moveCursor(0, 1, 3)).toBe(1);
    const r4 = compare.rounds.find((r) => r.id === 'r4');
    const r5b = compare.rounds.find((r) => r.id === 'r5b');
    if (!r4 || !r5b) throw new Error('rounds');
    expect(choiceForDigit(r4, ['a', 'same', 'b'], 2)).toBe('same');
    expect(choiceForDigit(r5b, ['2', '3', '4'], 3)).toBe('3');
    expect(choiceForDigit(r5b, ['2', '3', '4'], 1)).toBeNull();

    const tilt = new TiltStepper();
    expect(tilt.update(0.3, 0)).toBe(0); // inside the dead zone
    expect(tilt.update(0.6, 10)).toBe(1); // tipped right
    expect(tilt.update(0.6, 100)).toBe(0); // held: no repeat yet
    expect(tilt.update(0.35, 200)).toBe(0); // hysteresis: still held, not released
    expect(tilt.update(0.6, 10 + TiltStepper.REPEAT_FIRST_MS)).toBe(1); // repeat
    expect(tilt.update(0.1, 1500)).toBe(0); // released
    expect(tilt.update(-0.7, 1510)).toBe(-1); // tipped left
  });
});

describe('the session (LearningGates)', () => {
  const silent = () => ({
    play: async () => {},
    stop: () => {},
    unlock: () => {},
    preload: () => {},
    sourceFor: () => 'silent' as const,
  });

  function session() {
    const closed: [number, string][] = [];
    const g = new LearningGates({
      muted: () => true,
      onClose: (id, how) => closed.push([id, how]),
      voice: silent,
    });
    g.use(lessonFromBaseline('compare-groups'));
    return { g, closed };
  }

  test('decorates a stage: link portals become numbered Pip gates', () => {
    const { g } = session();
    const stage = g.decorate({
      ...HANDMADE,
      portals: [
        { id: 0, islandId: 0, pos: [160, 170], href: 'https://x.example/', label: 'x', sourceElementId: 3 },
      ],
    });
    const portals = stage.portals ?? [];
    expect(portals.length).toBe(5);
    expect(portals.every((p) => isLearningHref(p.href))).toBe(true);
    expect(portals.map((p) => gateNumber(p.href))).toEqual([1, 2, 3, 4, 5]);
    expect(portals[0]?.label).toBe('Pip gate 1');
  });

  test('wrong answer climbs the hints, a right one locks, roll on closes; the state lasts across gates', () => {
    const { g, closed } = session();
    g.open(0, 1, 0);
    expect(g.getView().gate?.round.id).toBe('r1');
    g.move(-1); // leftmost: island A (wrong)
    g.confirm();
    expect(g.getView().gate?.state).toMatchObject({ result: 'try-again', hintLevel: 1, solved: false });
    g.match();
    expect(g.getView().gate?.show).toBe('match');
    g.answer('b');
    expect(g.getView().gate?.state.solved).toBe(true);
    expect(g.getView().built).toBe(1);
    g.answer('a'); // locked
    expect(g.getView().gate?.state.choice).toBe('b');
    g.confirm(); // roll on
    expect(g.isOpen).toBe(false);
    expect(closed).toEqual([[0, 'rolled-on']]);
    g.open(1, 2, 1000);
    expect(g.getView().gate?.round.id).toBe('r2');
    g.skip();
    expect(closed[1]).toEqual([1, 'skipped']);
    g.open(2, 3, 2000);
    expect(g.getView().gate?.round.id).toBe('r2'); // still waiting at r2, no penalty
  });

  test('phone tilt moves the cursor; JUMP confirms only after a release and a moment', () => {
    const { g } = session();
    g.open(0, 1, 0);
    g.input(0.8, true, 'phone', 50); // tipped right with JUMP still held from rolling in
    expect(g.getView().gate?.cursor).toBe(1);
    g.input(0.8, false, 'phone', 100);
    g.input(0.8, true, 'phone', 400); // pressed after a release
    expect(g.getView().gate?.state.solved).toBe(true);
    // the keyboard's arrows arrive as key events, not as tilt
    g.input(-0.9, false, 'keyboard', 500);
    expect(g.getView().gate?.cursor).toBe(1);
  });
});

describe('loading learning pages', () => {
  const page = (path: LearningPath) =>
    `<!doctype html><html><body><h1>Lesson</h1>${learningScript(path)}</body></html>`;

  test('?learn= picks a baseline activity; unknown ids fail kindly', () => {
    expect(lessonFromBaseline('compare-groups').activity.id).toBe('compare-groups');
    expect(() => lessonFromBaseline('nope')).toThrow(LessonLoadError);
    expect(pickActivity(baselinePath).id).toBe(baselinePath.activities[0]?.id);
  });

  test('a downloaded page: only its inert JSON is read', async () => {
    const lesson = await lessonFromFile(
      new File([page(baselinePath)], 'learning-path.html'),
      'compare-groups',
    );
    expect(lesson.source).toEqual({ kind: 'file', name: 'learning-path.html' });
    expect(lesson.activity.id).toBe('compare-groups');
    expect(lessonFromHtml(page(baselinePath), 'p.html').activity.id).toBe(baselinePath.activities[0]?.id);
  });

  test('not a learning page, a broken one, two of them', () => {
    const kind = (html: string) => {
      try {
        lessonFromHtml(html, 'f.html');
        return 'ok';
      } catch (err) {
        return err instanceof LessonLoadError ? err.kind : 'other';
      }
    };
    expect(kind('<html><body>hello</body></html>')).toBe('not-learning');
    expect(
      kind('<script id="wwm-learning" type="application/json">{"format":"wwm-learning/9"}</script>'),
    ).toBe('invalid');
    expect(kind(page(baselinePath) + learningScript(baselinePath))).toBe('not-learning');
  });
});
