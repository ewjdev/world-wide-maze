/** Unit tests for the leaderboard rules (Phase 10): names, profanity, plausibility, replay scoring. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHYSICS_VERSION, replay } from '@wwm/physics';
import { type InputSample, SIM_HZ, type StageData } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import {
  checkName,
  checkStageScore,
  foldName,
  isProfane,
  MAX_REPLAY_SAMPLES,
  parseReplay,
  RAPIER_WASM_BYTES,
  replayMatches,
  scoreReplayEvents,
  stageLimits,
} from '../src/routes/scores-rules.ts';
import { escapeHtml, playPath, shareParams } from '../src/routes/share-html.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const stage = JSON.parse(
  readFileSync(resolve(root, 'fixtures/stages/handmade-simple.json'), 'utf8'),
) as StageData;
const inputs = JSON.parse(
  readFileSync(resolve(root, 'fixtures/replays/handmade-simple.keyboard.json'), 'utf8'),
) as InputSample[];
const idle: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };

describe('names', () => {
  test('2013 alphabet [a-z0-9_], 1–32 characters', () => {
    for (const ok of ['a', 'player_1', 'x'.repeat(32), '___', '2013'])
      expect(checkName(ok)).toEqual({ ok: true });
    for (const bad of ['', 'A', 'has space', 'x'.repeat(33), 'dash-y', 'dot.dot', 'ünï'])
      expect(checkName(bad)).toEqual({ ok: false, reason: 'format' });
  });
  test('profanity: leetspeak, separators and repeats are folded', () => {
    expect(foldName('sh1t_h34d')).toBe('shithead');
    expect(foldName('fuuuuck')).toBe('fuck');
    for (const bad of ['fuck', 'f_u_c_k', 'fuuuck', 'sh1t', 'a55hole', 'b1tch_please', 'n4z1'])
      expect(isProfane(bad), bad).toBe(true);
  });
  test('profanity: ordinary words that contain a stem pass (Scunthorpe)', () => {
    for (const ok of [
      'scunthorpe',
      'cocktail',
      'peacock',
      'dickens',
      'therapist',
      'grape_ape',
      'torpedo',
      'saqoosha',
    ])
      expect(isProfane(ok), ok).toBe(false);
  });
});

describe('plausibility', () => {
  const L = stageLimits(stage);
  test('stage maximum = items + time bonus at the fastest possible finish', () => {
    expect(L.small).toBe(20);
    expect(L.large).toBe(2);
    expect(L.itemMax).toBe(220);
    expect(L.minTimeMs).toBeGreaterThan(0);
    expect(L.maxScore).toBe(220 + 5 * Math.floor(300 - L.minTimeMs / 1000));
  });
  test('par × 0.5 raises the minimum time when a par is known', () => {
    expect(stageLimits(stage, 60_000).minTimeMs).toBe(30_000);
  });
  test('checks', () => {
    expect(checkStageScore(L, L.maxScore, L.minTimeMs, true).ok).toBe(true);
    expect(checkStageScore(L, L.maxScore + 1, 60_000, true).ok).toBe(false);
    expect(checkStageScore(L, 10, L.minTimeMs - 1, true).ok).toBe(false);
    // An unfinished last stage of a run (game over): items only, any time.
    expect(checkStageScore(L, 200, 5, false).ok).toBe(true);
    // …but a time bonus implies a finish.
    expect(checkStageScore(L, 300, 5, false).ok).toBe(false);
    expect(checkStageScore(L, -1, 60_000, true).ok).toBe(false);
    expect(checkStageScore(L, 1.5, 60_000, true).ok).toBe(false);
  });
});

describe('replays', () => {
  test('both shapes parse; the bare array has no physics version', () => {
    expect(parseReplay(undefined)).toBeNull();
    expect(parseReplay([idle])).toEqual({ physicsVersion: null, inputs: [idle] });
    expect(parseReplay({ physicsVersion: '0.1.0', inputs: [idle] })).toEqual({
      physicsVersion: '0.1.0',
      inputs: [idle],
    });
    expect(() => parseReplay({ inputs: [idle] })).toThrow();
    expect(() => parseReplay([{ tiltX: 'x' }])).toThrow();
    expect(() => parseReplay(new Array(MAX_REPLAY_SAMPLES + 1).fill(idle))).toThrow();
  });

  test('event scoring: items, timer from first POWER, reset on lost', () => {
    const ins = [idle, idle, { ...idle, power: true }, ...new Array(SIM_HZ * 10).fill(idle)];
    const ev = [
      { tick: 5, event: { type: 'item', itemId: 1, kind: 'small' } },
      { tick: 6, event: { type: 'item', itemId: 1, kind: 'small' } }, // duplicate ignored
      { tick: 7, event: { type: 'item', itemId: 2, kind: 'large' } },
    ];
    const goalTick = 2 + SIM_HZ * 10; // 10 s after the first POWER press (tick index 2)
    const r = scoreReplayEvents(ev, ins, 300, goalTick, goalTick);
    expect(r).toMatchObject({ goal: true, small: 1, large: 1, itemScore: 101, timeBonus: 5 * 290 });
    const lost = scoreReplayEvents(
      [...ev, { tick: 2 + SIM_HZ * 4, event: { type: 'lost' } }],
      ins,
      300,
      goalTick,
      goalTick,
    );
    expect(lost.timeBonus).toBe(5 * 294); // the timer restarted at the respawn
    expect(scoreReplayEvents(ev, ins, 300, -1, 100)).toMatchObject({ goal: false, score: 101 });
  });

  test('matching tolerance: items exact, time bonus within the slack, multiples of 5', () => {
    const r = { goal: true, small: 1, large: 1, itemScore: 101, timeBonus: 1000, score: 1101, ticks: 1 };
    expect(replayMatches(1101, r)).toBe(true);
    expect(replayMatches(1116, r)).toBe(true);
    expect(replayMatches(1121, r)).toBe(false);
    expect(replayMatches(1102, r)).toBe(false);
    expect(replayMatches(101, { ...r, goal: false, timeBonus: 0 })).toBe(true);
    expect(replayMatches(102, { ...r, goal: false, timeBonus: 0 })).toBe(false);
  });

  test('the fixture replay scores 1479 headlessly (the integration test submits this)', async () => {
    const r = await replay(stage, inputs, { stopAtGoal: true });
    const s = scoreReplayEvents(r.events, inputs, stage.timeLimitSec, r.goalTick, r.ticks);
    expect(s).toMatchObject({ goal: true, small: 9, large: 2, score: 1479 });
    expect(PHYSICS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('the dist WASM the workerd shim precompiles is byte-identical to the inlined copy', () => {
    const req = createRequire(resolve(root, 'apps/worker/package.json'));
    const dist = dirname(req.resolve('@dimforge/rapier3d-deterministic-compat'));
    const wasm = readFileSync(resolve(dist, 'rapier_wasm3d_bg.wasm'));
    expect(wasm.byteLength).toBe(RAPIER_WASM_BYTES);
    const mjs = readFileSync(resolve(dist, 'rapier.mjs'), 'utf8');
    const b64 = /toByteArray\("([A-Za-z0-9+/=]+)"\)/.exec(mjs)?.[1] ?? '';
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    expect(sha(Buffer.from(b64, 'base64'))).toBe(sha(wasm));
  });
});

describe('share helpers', () => {
  test('beat/by are sanitised and carried to the play URL', () => {
    expect(shareParams(new URLSearchParams('beat=1200&by=ann_1'))).toEqual({ beat: 1200, by: 'ann_1' });
    expect(shareParams(new URLSearchParams('beat=-3&by=<b>'))).toEqual({ beat: null, by: null });
    expect(playPath({ stageId: 'abc', beat: 5, by: 'x' })).toBe('/play/abc?beat=5&by=x');
    expect(playPath({ stageId: 'abc', beat: null, by: null })).toBe('/play/abc');
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
});
