import type { GamePhase } from '@wwm/schema';
import { GamePhaseSchema } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { type GameEvent, TRANSITIONS, transition } from '../src/game/machine.ts';

/** Every legal edge: [from, event, to]. The test also asserts that nothing else is legal. */
const EDGES: [GamePhase, GameEvent, GamePhase][] = [
  ['title', { type: 'START', howtoSeen: false, ready: false }, 'howto'],
  ['title', { type: 'START', howtoSeen: false, ready: true }, 'howto'],
  ['title', { type: 'START', howtoSeen: true, ready: false }, 'pairing'],
  ['title', { type: 'START', howtoSeen: true, ready: true }, 'select'],
  ['title', { type: 'CHOOSE' }, 'building'],
  ['howto', { type: 'HOWTO_DONE' }, 'pairing'],
  ['howto', { type: 'BACK' }, 'title'],
  ['pairing', { type: 'PAIRED' }, 'calibrate'],
  ['pairing', { type: 'KEYBOARD' }, 'select'],
  ['pairing', { type: 'BACK' }, 'title'],
  ['calibrate', { type: 'CALIBRATED' }, 'select'],
  ['calibrate', { type: 'KEYBOARD' }, 'select'],
  ['calibrate', { type: 'BACK' }, 'pairing'],
  ['select', { type: 'CHOOSE' }, 'building'],
  ['select', { type: 'BACK' }, 'title'],
  ['select', { type: 'TITLE' }, 'title'],
  ['building', { type: 'BUILT' }, 'intro'],
  ['building', { type: 'BUILD_FAILED' }, 'error'],
  ['building', { type: 'BACK' }, 'select'],
  ['intro', { type: 'INTRO_DONE', countdown: true }, 'countdown'],
  ['intro', { type: 'INTRO_DONE', countdown: false }, 'play'],
  ['intro', { type: 'QUIT' }, 'title'],
  ['countdown', { type: 'GO' }, 'play'],
  ['countdown', { type: 'MENU' }, 'paused'],
  ['play', { type: 'MENU' }, 'paused'],
  ['play', { type: 'FELL' }, 'falling'],
  ['play', { type: 'TIMESUP' }, 'timeup'],
  ['play', { type: 'GOAL' }, 'goal'],
  ['play', { type: 'TRAVEL' }, 'building'], // Phase 13: link portal
  ['paused', { type: 'RESUME' }, 'play'],
  ['paused', { type: 'RETRY' }, 'building'],
  ['paused', { type: 'SEARCH' }, 'select'],
  ['paused', { type: 'QUIT' }, 'title'],
  ['falling', { type: 'LOST', spares: 0 }, 'restarting'],
  ['falling', { type: 'LOST', spares: -1 }, 'gameover'],
  ['timeup', { type: 'SIGN_DONE', spares: 2 }, 'restarting'],
  ['timeup', { type: 'SIGN_DONE', spares: -1 }, 'gameover'],
  ['restarting', { type: 'SPAWNED' }, 'play'],
  ['goal', { type: 'GOAL_DONE' }, 'result'],
  ['gameover', { type: 'SIGN_DONE', spares: -1 }, 'ranking'],
  ['result', { type: 'NEXT', more: true }, 'building'],
  ['result', { type: 'NEXT', more: false }, 'select'],
  ['result', { type: 'FINISH' }, 'ranking'],
  ['ranking', { type: 'NEW_GAME' }, 'select'],
  ['ranking', { type: 'TITLE' }, 'title'],
  ['error', { type: 'CHOOSE' }, 'building'],
  ['error', { type: 'BACK' }, 'select'],
  ['error', { type: 'TITLE' }, 'title'],
];

const SAMPLE_EVENTS: GameEvent[] = [
  { type: 'TRAVEL' },
  { type: 'START', howtoSeen: true, ready: true },
  { type: 'HOWTO_DONE' },
  { type: 'PAIRED' },
  { type: 'KEYBOARD' },
  { type: 'CALIBRATED' },
  { type: 'CHOOSE' },
  { type: 'BUILT' },
  { type: 'BUILD_FAILED' },
  { type: 'INTRO_DONE', countdown: true },
  { type: 'GO' },
  { type: 'MENU' },
  { type: 'RESUME' },
  { type: 'RETRY' },
  { type: 'SEARCH' },
  { type: 'QUIT' },
  { type: 'FELL' },
  { type: 'LOST', spares: 1 },
  { type: 'TIMESUP' },
  { type: 'SIGN_DONE', spares: 1 },
  { type: 'SPAWNED' },
  { type: 'GOAL' },
  { type: 'GOAL_DONE' },
  { type: 'NEXT', more: true },
  { type: 'FINISH' },
  { type: 'NEW_GAME' },
  { type: 'TITLE' },
  { type: 'BACK' },
];

describe('game phase machine', () => {
  test.each(EDGES)('%s --%o--> %s', (from, ev, to) => {
    expect(transition(from, ev)).toBe(to);
  });

  test('covers every contract GamePhase', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...GamePhaseSchema.options].sort());
  });

  test('every other (phase, event) pair is illegal', () => {
    const legal = new Set(EDGES.map(([f, e]) => `${f}:${e.type}`));
    for (const phase of GamePhaseSchema.options) {
      for (const ev of SAMPLE_EVENTS) {
        if (legal.has(`${phase}:${ev.type}`)) continue;
        expect(transition(phase, ev), `${phase} + ${ev.type}`).toBeNull();
      }
    }
  });

  test('FAIL reaches the error screen from anywhere', () => {
    for (const phase of GamePhaseSchema.options) expect(transition(phase, { type: 'FAIL' })).toBe('error');
  });

  test('a full faithful session: title → … → ranking → new game', () => {
    const script: GameEvent[] = [
      { type: 'START', howtoSeen: false, ready: false },
      { type: 'HOWTO_DONE' },
      { type: 'PAIRED' },
      { type: 'CALIBRATED' },
      { type: 'CHOOSE' },
      { type: 'BUILT' },
      { type: 'INTRO_DONE', countdown: false },
      { type: 'MENU' },
      { type: 'RESUME' },
      { type: 'FELL' },
      { type: 'LOST', spares: 2 },
      { type: 'SPAWNED' },
      { type: 'GOAL' },
      { type: 'GOAL_DONE' },
      { type: 'NEXT', more: true },
      { type: 'BUILT' },
      { type: 'INTRO_DONE', countdown: true },
      { type: 'GO' },
      { type: 'TIMESUP' },
      { type: 'SIGN_DONE', spares: -1 },
      { type: 'SIGN_DONE', spares: -1 },
      { type: 'NEW_GAME' },
    ];
    let p: GamePhase = 'title';
    const seen: GamePhase[] = [p];
    for (const ev of script) {
      const n = transition(p, ev);
      expect(n, `${p} + ${ev.type}`).not.toBeNull();
      p = n as GamePhase;
      seen.push(p);
    }
    expect(seen.at(-1)).toBe('select');
    expect(seen).toContain('gameover');
    expect(seen).toContain('ranking');
  });
});
