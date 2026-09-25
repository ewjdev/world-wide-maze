import type { StageData } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import handmade from '../../../fixtures/stages/handmade-simple.json' with { type: 'json' };
import { LocalLeaderboard } from '../src/game/leaderboard.ts';
import {
  addScore,
  countItems,
  finishStage,
  fireworksCount,
  GameTimer,
  ordinal,
  restartPointFor,
  sanitizeName,
  stageScore,
  timeBonus,
} from '../src/game/rules.ts';

const STAGE = handmade as unknown as StageData;

describe('scoring (E)', () => {
  test('small +1, large +100, time bonus 5 × whole seconds', () => {
    expect(timeBonus(254)).toBe(1270);
    expect(stageScore(254, 9, 2, true)).toBe(1270 + 200 + 9);
    expect(stageScore(254, 9, 2, false)).toBe(209); // game over: items only
  });

  test('one-up on each multiple of 3000 while spares < 3', () => {
    expect(addScore({ total: 2950, spares: 1 }, 100)).toEqual({ total: 3050, spares: 2, oneUps: 1 });
    expect(addScore({ total: 2950, spares: 3 }, 100)).toEqual({ total: 3050, spares: 3, oneUps: 0 });
    expect(addScore({ total: 100, spares: 0 }, 100)).toEqual({ total: 200, spares: 0, oneUps: 0 });
    expect(addScore({ total: 5999, spares: 0 }, 1)).toEqual({ total: 6000, spares: 1, oneUps: 1 });
    expect(addScore({ total: 2000, spares: 0 }, 7000).spares).toBe(3);
  });

  test('finishStage adds only the time bonus to the total (items were added on pickup)', () => {
    const r = finishStage({ total: 2800, spares: 2 }, { timeInt: 100, small: 9, large: 2, cleared: true });
    expect(r.bonus).toBe(500);
    expect(r.score).toEqual({ total: 3300, spares: 3, oneUps: 1 });
    expect(r.stageScore).toBe(709);
    const over = finishStage({ total: 50, spares: -1 }, { timeInt: 100, small: 3, large: 0, cleared: false });
    expect(over.bonus).toBe(0);
    expect(over.stageScore).toBe(3);
    expect(over.score.total).toBe(50);
  });

  test('fireworks = round(timeRemains) mod 10', () => {
    expect(fireworksCount(254.6)).toBe(5);
    expect(fireworksCount(250.2)).toBe(0);
    expect(fireworksCount(7.4)).toBe(7);
  });
});

describe('timer (E)', () => {
  test('whole seconds follow Math.round and only step down; last30 and timesup fire once', () => {
    const t = new GameTimer(300);
    expect(t.tick(1)).toEqual([]); // not started
    t.start();
    t.tick(0.4);
    expect(t.remainsInt).toBe(300); // round(299.6) = 300
    t.tick(0.2);
    expect(t.remainsInt).toBe(299); // round(299.4)
    const ev: string[] = [];
    for (let i = 0; i < 400; i++) ev.push(...t.tick(1));
    expect(ev).toEqual(['last30', 'timesup']);
    expect(t.remainsInt).toBe(0);
    expect(t.running).toBe(false);
  });

  test('a big dt still dispatches last30 before timesup', () => {
    const t = new GameTimer(40);
    t.start();
    expect(t.tick(60)).toEqual(['last30', 'timesup']);
  });

  test('reset restores the full limit (E: every respawn)', () => {
    const t = new GameTimer(300);
    t.start();
    t.tick(100);
    t.reset();
    expect(t.remainsInt).toBe(300);
    expect(t.running).toBe(false);
  });

  test('stop pauses the countdown', () => {
    const t = new GameTimer(300);
    t.start();
    t.tick(10);
    t.stop();
    t.tick(10);
    expect(t.remainsInt).toBe(290);
  });
});

describe('restart point (E)', () => {
  test('nearest restart point of the last-touched island', () => {
    const island = STAGE.islands[1];
    if (!island) throw new Error('fixture');
    const [p0, p1] = island.restartPoints;
    if (!p0 || !p1) throw new Error('fixture');
    expect(restartPointFor(STAGE, island.id, [p1[0] + 1, p1[1] + 1])).toEqual(p1);
    expect(restartPointFor(STAGE, island.id, [p0[0] - 1, p0[1]])).toEqual(p0);
  });
  test('stage start when no island was touched', () => {
    expect(restartPointFor(STAGE, null, null)).toEqual(STAGE.start.pos);
    expect(restartPointFor(STAGE, 999, [0, 0])).toEqual(STAGE.start.pos);
  });
  test('item totals', () => {
    expect(countItems(STAGE)).toEqual({ largeTotal: 2, smallTotal: 20 });
  });
});

describe('names and ranks', () => {
  test('E: names are sanitised to [a-z0-9_]', () => {
    expect(sanitizeName('Ana María!')).toBe('ana-mar-a-');
    expect(sanitizeName('player_1')).toBe('player_1');
  });
  test('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
    ]);
  });
});

describe('LocalLeaderboard (stub for Phase 10)', () => {
  test('ranks run totals, best first', async () => {
    const m = new Map<string, string>();
    const lb = new LocalLeaderboard({
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
    });
    expect(await lb.rankFor(500)).toBe(1);
    expect((await lb.submitRun({ kind: 'run', name: 'a', totalScore: 500, stages: [] })).rank).toBe(1);
    expect((await lb.submitRun({ kind: 'run', name: 'b', totalScore: 900, stages: [] })).rank).toBe(1);
    expect((await lb.submitRun({ kind: 'run', name: 'c', totalScore: 100, stages: [] })).rank).toBe(3);
    expect(await lb.rankFor(600)).toBe(2);
    expect((await lb.topRuns()).map((e) => e.name)).toEqual(['b', 'a', 'c']);
    await lb.submitStage({ kind: 'stage', stageId: 's', name: 'a', score: 10, timeMs: 1000 });
    expect((await lb.topStage('s'))[0]?.timeMs).toBe(1000);
  });
});
