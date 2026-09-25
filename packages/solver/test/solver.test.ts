import { readFileSync } from 'node:fs';
import { createSimulation, runInputs } from '@wwm/physics';
import { MAX_TILT_PITCH, MAX_TILT_ROLL, SIM_HZ, type StageData, validateStage } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { loadCapture } from '@wwm/stage-builder/node';
import { describe, expect, test } from 'vitest';
import {
  auditIslands,
  buildNavGrid,
  buildPlayableStage,
  difficultyStars,
  formatGhost,
  PlayabilityError,
  planRoute,
  solveStage,
  toGhostReplay,
  validatePlayable,
} from '../src/index.ts';
import { elevatorStage, neckStage } from './helpers/synthetic.ts';

const handmade = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;

describe('solveStage', () => {
  test('handmade-simple: reaches the goal, replays deterministically, within the input limits, fast', async () => {
    const t0 = process.cpuUsage();
    const r = await solveStage(handmade);
    const cpu = process.cpuUsage(t0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const simSec = r.attempts.reduce((a, t) => a + t.timeSec, 0);
    console.log(
      `[solver] handmade-simple: ${r.timeSec.toFixed(1)} s sim, ${r.falls} falls, ${r.items} items, ` +
        `cpu ${cpuMs.toFixed(0)} ms (${(simSec / (cpuMs / 1000)).toFixed(0)}× real time)`,
    );
    expect(r.success).toBe(true);
    expect(r.falls).toBe(0);
    expect(r.timeSec).toBeLessThan(60);
    expect(cpuMs).toBeLessThan(3000);
    expect(simSec / (cpuMs / 1000)).toBeGreaterThan(10);
    for (const s of r.inputs) {
      expect(Math.abs(s.tiltX)).toBeLessThanOrEqual(MAX_TILT_ROLL + 1e-9);
      expect(Math.abs(s.tiltZ)).toBeLessThanOrEqual(MAX_TILT_PITCH + 1e-9);
      expect(Number.isFinite(s.frameYaw)).toBe(true);
    }
    expect(r.inputs.filter((s) => s.power).length / r.inputs.length).toBeGreaterThan(0.9);
    // Ghost run: the same inputs through the contract replay path reach the goal on the same tick.
    const sim = await createSimulation();
    await sim.load(handmade);
    const again = runInputs(sim, r.inputs);
    sim.dispose();
    expect(again.goalTick).toBe(r.inputs.length);
    expect(again.goalTick / SIM_HZ).toBeCloseTo(r.timeSec, 6);
  }, 60_000);

  test('neck width calibration matches the physics: 12 px blocks the ball, 16 px lets it through', async () => {
    const blocked = await solveStage(neckStage(12));
    expect(blocked.success).toBe(false);
    expect(['goal-pocket', 'narrow-neck']).toContain(blocked.failure?.kind);
    const open = await solveStage(neckStage(16));
    expect(open.success).toBe(true);
    expect(open.jumps).toBe(0);
  }, 60_000);

  test('jumps over a short neck narrower than the ball (and only there)', async () => {
    const st = neckStage(8, 12);
    const g = buildNavGrid(st);
    expect(g.jumps.length).toBe(1);
    const r = await solveStage(st, { grid: g });
    expect(r.success).toBe(true);
    expect(r.jumps).toBeGreaterThanOrEqual(1);
    expect(difficultyStars(r)).toBeGreaterThanOrEqual(2);
  }, 60_000);

  test('rides a trigger elevator', async () => {
    const st = elevatorStage(6);
    const r = await solveStage(st);
    expect(r.success).toBe(true);
    const sim = await createSimulation();
    await sim.load(st);
    const again = runInputs(sim, r.inputs);
    sim.dispose();
    const phases = again.events.flatMap((e) => (e.event.type === 'elevator' ? [e.event.phase] : []));
    expect(phases).toEqual(['start', 'end']);
  }, 60_000);

  test('an elevator rising less than ball + slab is diagnosed as blocked (the ball gets pinned)', async () => {
    const r = await solveStage(elevatorStage(1));
    expect(r.success).toBe(false);
    expect(r.failure?.kind).toBe('elevator-blocked');
    expect(r.failure?.elevatorId).toBe(0);
  }, 60_000);

  test('auditIslands finds an island split by a neck', () => {
    const issues = auditIslands(buildNavGrid(neckStage(10)));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('split');
    expect(issues[0]?.points.join(' ')).toMatch(/start.*goal/);
  });

  test('planRoute returns legs ending at the goal', () => {
    const g = buildNavGrid(handmade);
    const route = planRoute(g, { from: handmade.start.pos });
    expect(route).not.toBeNull();
    const last = route?.legs.at(-1)?.verts.at(-1)?.p;
    expect(last).toEqual(handmade.goal.pos);
    expect(route?.legs.filter((l) => l.elevator).length).toBeGreaterThanOrEqual(0);
  });
});

describe('validatePlayable', () => {
  test('ok with par and stars; rejects when par exceeds the limit', async () => {
    const v = await validatePlayable(handmade);
    expect(v.ok).toBe(true);
    expect(v.parTimeSec).toBeGreaterThan(0);
    expect(v.report.stars).toBeGreaterThanOrEqual(1);
    const strict = await validatePlayable(handmade, { parRejectSec: 5 });
    expect(strict.ok).toBe(false);
    expect(strict.report.reason).toMatch(/^par /);
  }, 60_000);

  test('unplayable stage: ok=false with the classified reason', async () => {
    const v = await validatePlayable(elevatorStage(1));
    expect(v.ok).toBe(false);
    expect(v.report.reason).toMatch(/elevator-blocked/);
  }, 60_000);
});

describe('buildPlayableStage', () => {
  test('rerolls seeds until the stage passes validateStage and the solver (real builder, python.org slice 1)', async () => {
    const { capture, image } = loadCapture('eval-python-home');
    const input = { capture, image, sliceIndex: 1, seed: 1, difficulty: 'normal' as const };
    // Builder 0.4.0 fixed the issues that made seeds 1–2 unplayable here (Phase 03b), so seed 1 is made
    // unplayable on purpose to exercise the reroll with the real builder.
    const build: typeof buildStage = (inp) =>
      inp.seed === 1 ? { stage: elevatorStage(1), debug: {} as never } : buildStage(inp);
    const p = await buildPlayableStage(input, { build, maxSeeds: 4 });
    expect(validateStage(p.stage).ok).toBe(true);
    expect(p.validation.ok).toBe(true);
    expect(p.seed).toBe(2);
    expect(p.tried.length).toBe(p.seed - 1);
    // Every returned stage really is solvable: re-solve independently.
    const again = await solveStage(p.stage);
    expect(again.success).toBe(true);
  }, 120_000);

  test('throws PlayabilityError (UNPLAYABLE) when no seed works', async () => {
    const bad = elevatorStage(1);
    await expect(
      buildPlayableStage(
        { capture: {} as never, image: {} as never, sliceIndex: 0, seed: 7, difficulty: 'normal' },
        { build: () => ({ stage: bad, debug: {} as never }), maxSeeds: 2 },
      ),
    ).rejects.toBeInstanceOf(PlayabilityError);
  }, 60_000);

  test('skips seeds whose build throws or fails validateStage', async () => {
    let calls = 0;
    const p = await buildPlayableStage(
      { capture: {} as never, image: {} as never, sliceIndex: 0, seed: 3, difficulty: 'normal' },
      {
        build: (inp) => {
          calls++;
          if (inp.seed === 3) throw new Error('boom');
          if (inp.seed === 4) return { stage: { ...handmade, islands: [] }, debug: {} as never };
          return { stage: handmade, debug: {} as never };
        },
      },
    );
    expect(calls).toBe(3);
    expect(p.seed).toBe(5);
    expect(p.tried.map((t) => t.reason)).toEqual([
      expect.stringMatching(/^build failed/),
      expect.stringMatching(/^invalid/),
    ]);
  }, 60_000);
});

describe('ghost replays', () => {
  test('toGhostReplay/formatGhost round-trip', async () => {
    const r = await solveStage(handmade);
    const ghost = toGhostReplay(handmade, r);
    expect(ghost.physicsVersion).toMatch(/^\d+\.\d+\.\d+/);
    const parsed = JSON.parse(formatGhost(ghost)) as typeof ghost;
    expect(parsed.inputs).toEqual(r.inputs);
    expect(JSON.parse(formatGhost(ghost, true))).toEqual(r.inputs);
  }, 60_000);
});
