import { readFileSync } from 'node:fs';
import { guidedLearningScript, levelPlan, levelsFor, resolveLocks, rocketPath } from '@wwm/learning';
import { parseStage, type StageData } from '@wwm/schema';
import { describe, expect, it } from 'vitest';
import { LearningGates } from '../src/learning/gates.ts';
import { lessonFromBaseline, lessonFromHtml } from '../src/learning/load.ts';
import { bindLevel } from '../src/learning/locks.ts';
import { FakeLockPort } from '../src/learning/port.ts';

const stage = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;
const lesson = lessonFromBaseline('rocket-lab', true);
const a = lesson.activity;
const level = levelsFor(a)[0]!;
const voice = () => ({
  play: async () => {},
  stop: () => {},
  unlock: () => {},
  preload: () => {},
  sourceFor: () => 'silent' as const,
});

describe('Rocket loader and locked maze progress', () => {
  it('rejects disabled builds and imports before state construction', () => {
    expect(() => lessonFromBaseline('rocket-lab', false)).toThrow(/not available/);
    expect(() => lessonFromHtml(guidedLearningScript(rocketPath), 'rocket.html', undefined, false)).toThrow(
      /not available/,
    );
    expect(lessonFromHtml(guidedLearningScript(rocketPath), 'rocket.html', undefined, true).activity).toEqual(
      a,
    );
  });
  it.each([0, 1, 4])('keeps all four required goal dependencies with %s physical posts', (count) => {
    const spots = Array.from({ length: count }, (_, i) => ({
      islandId: i % 4,
      pos: [i * 400, 100] as [number, number],
      progress: i / 4,
    }));
    const b = bindLevel(stage, levelPlan(a, level), resolveLocks(level), spots, true);
    expect(b.steps).toHaveLength(4);
    expect(b.steps.every((s) => s.goal)).toBe(true);
    expect(b.goalLockId).not.toBeNull();
  });
  it('gates every required round, preserves accepted explanations on close, and never unlocks early', () => {
    const port = new FakeLockPort();
    const g = new LearningGates({ muted: () => true, onClose: () => {}, locks: port, voice });
    g.use(lesson);
    g.stageReady(g.decorate(stage));
    expect(g.goalLocked()).toBe(true);
    expect(g.open(-1)).toBe(true);
    const intro = g.getView().gate!.state.effect!.token;
    g.answer('circle');
    g.proceed();
    g.rollOn();
    expect(g.getView().gate!.state.effect!.token).toBe(intro);
    g.completeMotion(intro);
    for (let i = 0; i < 4; i++) {
      const gate = g.getView().gate!;
      expect(gate.round.id).toBe(`r${i + 1}`);
      g.answer(String(gate.round.answer));
      const token = g.getView().gate!.state.effect!.token;
      expect(g.getView().gate!.state.built).toBe(i);
      expect(g.goalLocked()).toBe(true);
      if (i === 0) {
        g.skip();
        g.open(-1);
        expect(g.getView().gate!.state.effect!.token).not.toBe(token);
        g.completeMotion(token);
        expect(g.getView().gate!.state.built).toBe(0);
      }
      g.completeMotion(g.getView().gate!.state.effect!.token);
      expect(g.getView().gate!.state.built).toBe(i + 1);
      expect(g.goalLocked()).toBe(i !== 3);
      g.proceed();
      if (i < 3) g.open(-1);
    }
    expect(g.getView().gate!.mode).toBe('bonus-offer');
  });
  it('keeps an actual zero-post stage locked, and the grown-up override can release it', () => {
    const sparse = parseStage(
      JSON.parse(
        readFileSync(
          new URL('../../../fixtures/learning/rocket-lab/sparse-stage.json', import.meta.url),
          'utf8',
        ),
      ),
    );
    const g = new LearningGates({ muted: () => true, onClose: () => {}, locks: new FakeLockPort(), voice });
    g.use(lesson);
    g.stageReady(g.decorate(sparse));
    expect(g.debug().binding?.steps.every((s) => s.portalId === null)).toBe(true);
    expect(g.goalLocked()).toBe(true);
    for (let i = 0; i < 4; i++) {
      expect(g.overrideNext()).toBe(true);
      expect(g.goalLocked()).toBe(i !== 3);
    }
    expect(g.overrideNext()).toBe(false);
  });
  it('restart cancels an open experiment and rejects its old completion', () => {
    const g = new LearningGates({ muted: () => true, onClose: () => {}, locks: new FakeLockPort(), voice });
    g.use(lesson);
    g.stageReady(g.decorate(stage));
    g.open(-1);
    const old = g.getView().gate!.state.effect!.token;
    g.resetProgress();
    expect(g.getView().gate).toBeNull();
    expect(g.getView().built).toBe(0);
    g.open(-1);
    const fresh = g.getView().gate!.state.effect!.token;
    expect(fresh).not.toBe(old);
    g.completeMotion(old);
    expect(g.getView().gate!.state.demoSeen).toBe(false);
  });
});
