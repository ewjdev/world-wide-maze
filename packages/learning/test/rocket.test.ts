import { describe, expect, it } from 'vitest';
import {
  baselinePath,
  bundledLessonPath,
  currentRound,
  expectedMotion,
  guidedCapabilities,
  guidedLearningScript,
  initialState,
  type LessonState,
  learningScript,
  MOTION_CAPABILITIES,
  normalizeLearningDocument,
  parseGuidedPath,
  parseLearningPath,
  presentRound,
  readGuidedLearningHtml,
  readLearningHtml,
  requiredRounds,
  rocketPath,
  sceneSvg,
  step,
} from '../src/index.ts';

const activity = rocketPath.activities[0]!;
const complete = (s: LessonState) =>
  step(activity, s, { type: 'effect-complete', token: s.effect!.token }).state;
const start = () =>
  complete(step(activity, initialState(activity, { shuffle: 'none' }), { type: 'start' }).state);

describe('Rocket document and scientific scene boundary', () => {
  it('separates the curated path and legacy readers without changing the six baseline lessons', () => {
    expect(baselinePath.activities).toHaveLength(6);
    expect(requiredRounds(activity)).toBe(4);
    expect(activity.rounds.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
    expect(() => bundledLessonPath('rocket-lab')).toThrow(/not available/);
    expect(bundledLessonPath('rocket-lab', true)).toBe(rocketPath);
    expect(() => parseLearningPath(rocketPath)).toThrow();
    expect(() => readLearningHtml(guidedLearningScript(rocketPath))).toThrow();
    expect(readGuidedLearningHtml(learningScript(baselinePath))).toEqual(baselinePath);
    expect(normalizeLearningDocument(rocketPath).kind).toBe('guided-v05');
    expect(guidedCapabilities(rocketPath, MOTION_CAPABILITIES)).toEqual([]);
    expect(guidedCapabilities(rocketPath, [])).toHaveLength(3);
  });
  it('derives every answer from escaping gas, including the still tied balloon', () => {
    expect(
      activity.rounds.map((r) => (r.kind === 'predict-motion' ? expectedMotion(r.scene) : null)),
    ).toEqual(['left', 'right', 'still', 'up', 'right']);
    for (const round of activity.rounds) {
      if (round.kind !== 'predict-motion') throw new Error('Motion required');
      expect(round.options.find((o) => o.id === round.answer)?.motion).toBe(expectedMotion(round.scene));
      expect(presentRound(round, 678, 'none')).toEqual(round);
      for (const orientation of ['wide', 'tall'] as const) {
        const svg = sceneSvg(rocketPath.theme, round, { orientation, planks: 4, built: 0 });
        expect(svg).toContain('data-motion-body');
        expect(svg).not.toMatch(/<script|<style|style=/);
        if (round.id === 'r3') expect(svg).not.toContain('<ellipse cx="655"');
        const after = sceneSvg(rocketPath.theme, round, {
          orientation,
          planks: 4,
          built: 0,
          experiment: 'after',
        });
        expect(after).toContain('data-experiment-frame="after"');
      }
    }
  });
  it.each(['answer', 'exhaust', 'capability', 'legacy', 'lock', 'shuffle', 'duplicate'])(
    'rejects contradictory or unsupported %s',
    (mutation) => {
      const path = structuredClone(rocketPath);
      const a = path.activities[0]!;
      const r = a.rounds[0]!;
      if (r.kind !== 'predict-motion') throw new Error('Motion required');
      if (mutation === 'answer') r.answer = 'triangle';
      if (mutation === 'exhaust')
        r.scene = {
          apparatus: 'rocket',
          setting: 'launch',
          exhaust: 'left',
          startsStill: true,
        } as typeof r.scene;
      if (mutation === 'capability')
        Object.assign(path, {
          requiredCapabilities: ['round.unknown', 'scene.rocket-lab', 'demo.rocket-push'],
        });
      if (mutation === 'legacy') Object.assign(path, { format: 'wwm-learning/0.3' });
      if (mutation === 'lock') a.play!.levels[0]!.locks.goal = false;
      if (mutation === 'shuffle') path.play!.shuffle = 'positions';
      if (mutation === 'duplicate') r.options[1]!.id = r.options[0]!.id;
      expect(() => parseGuidedPath(path)).toThrow();
    },
  );
  it('round trips escaped portable data and rejects duplicate blocks', () => {
    const path = { ...rocketPath, title: 'Pip </script><img src=x onerror=x>& lab' };
    const html = guidedLearningScript(path);
    expect(html).not.toContain('<img');
    expect(readGuidedLearningHtml(html)).toEqual(path);
    expect(() => readGuidedLearningHtml(html + html)).toThrow(/exactly one/);
  });
});

describe('one shared teaching lifecycle', () => {
  it('requires the introductory demonstration even when the game requests round four', () => {
    const s = step(activity, initialState(activity), { type: 'play', roundId: 'r4' }).state;
    expect(s.index).toBe(0);
    expect(s.effect?.purpose).toBe('intro');
    expect(step(activity, s, { type: 'answer', choice: 'circle' }).state).toBe(s);
    expect(step(activity, s, { type: 'next' }).state).toBe(s);
    expect(complete(s).demoSeen).toBe(true);
  });
  it('commits progress after explanation once and ignores stale completions, replay and rapid input', () => {
    const s = start();
    const accepted = step(activity, s, { type: 'answer', choice: 'circle' }).state;
    expect(accepted).toMatchObject({ result: 'correct', solved: false, built: 0, played: [] });
    for (const e of [{ type: 'next' }, { type: 'answer', choice: 'circle' }, { type: 'hint' }] as const)
      expect(step(activity, accepted, e).state).toBe(accepted);
    const replay = step(activity, accepted, { type: 'replay-effect' });
    expect(replay.say).toEqual(['rocket-lab.r1.success']);
    expect(
      step(activity, replay.state, { type: 'effect-complete', token: accepted.effect!.token }).state,
    ).toBe(replay.state);
    const solved = complete(replay.state);
    expect(solved).toMatchObject({ solved: true, built: 1, played: ['r1'] });
    expect(step(activity, solved, { type: 'effect-complete', token: replay.state.effect!.token }).state).toBe(
      solved,
    );
    expect(complete(step(activity, solved, { type: 'replay-effect' }).state).built).toBe(1);
    expect(complete(step(activity, solved, { type: 'play', roundId: 'r1' }).state).played).toEqual(['r1']);
    const restarted = step(activity, initialState(activity), { type: 'start' }).state;
    expect(
      step(activity, restarted, { type: 'effect-complete', token: replay.state.effect!.token }).state,
    ).toBe(restarted);
  });
  it('uses hints and a worked demonstration without counting help as a solved round', () => {
    let s = start();
    s = step(activity, s, { type: 'answer', choice: 'triangle' }).state;
    expect(s).toMatchObject({ hintLevel: 1, misses: 1, built: 0 });
    s = step(activity, s, { type: 'hint' }).state;
    expect(s.effect?.purpose).toBe('hint');
    s = complete(s);
    s = step(activity, s, { type: 'hint' }).state;
    expect(s.effect?.purpose).toBe('worked');
    expect(complete(s)).toMatchObject({ solved: false, built: 0, helped: ['r1'] });
  });
  it.each([false, true])('finishes four required discoveries with optional space=%s', (accept) => {
    let s = start();
    for (let i = 0; i < 4; i++) {
      const r = currentRound(activity, s);
      expect(r.id).toBe(`r${i + 1}`);
      s = complete(step(activity, s, { type: 'answer', choice: String(r.answer) }).state);
      s = step(activity, s, { type: 'next' }).state;
    }
    expect(s).toMatchObject({ phase: 'bonus-offer', built: 4, played: ['r1', 'r2', 'r3', 'r4'] });
    s = step(activity, s, { type: 'bonus', accept }).state;
    if (accept) {
      s = complete(
        step(activity, s, { type: 'answer', choice: String(currentRound(activity, s).answer) }).state,
      );
      expect(s.built).toBe(4);
      s = step(activity, s, { type: 'next' }).state;
    }
    expect(s.phase).toBe('done');
  });
});
