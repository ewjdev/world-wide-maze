/** Phase 22 (contracts §10.4, CCR-GAME-01): runtime locks in the simulation. */
import { readFileSync } from 'node:fs';
import {
  type InputSample,
  LEVEL_HEIGHT_M,
  type LockSpec,
  PX_PER_METER,
  ReplaySchema,
  SIM_HZ,
  type SimEvent,
} from '@wwm/schema';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { barrierPose, LOCK_HEIGHT_M, lockBoxes } from '../src/locks.ts';
import { replay } from '../src/replay.ts';
import { createSimulation, type RapierSimulation } from '../src/simulation.ts';
import { ramGate } from './helpers/lock-drive.ts';
import { HANDMADE, HANDMADE_REPLAY_URL } from './helpers/stages.ts';

const IDLE: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };
/** island 0 → 1 has three parallel bridges: lock them all (a cut), each at island 0 */
const CUT: LockSpec[] = [0, 1, 2].map((b) => ({ id: 10 + b, kind: 'bridge', targetId: b, islandId: 0 }));
const GOAL: LockSpec = { id: 30, kind: 'goal', targetId: 0, islandId: HANDMADE.goal.islandId };
const LIFT_LOW: LockSpec = { id: 20, kind: 'elevator', targetId: 0, islandId: 2 };
const LIFT_HIGH: LockSpec = { id: 21, kind: 'elevator', targetId: 0, islandId: 3 };

function run(sim: RapierSimulation, n: number, input: Partial<InputSample> = {}): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...sim.step({ ...IDLE, ...input }).events);
  return events;
}
const lockedIds = (ev: SimEvent[]) => ev.flatMap((e) => (e.type === 'locked' ? [e.lockId] : []));

let sim: RapierSimulation;
beforeAll(async () => {
  sim = await createSimulation();
});
afterAll(() => sim.dispose());

describe('barrierPose / lockBoxes (pure geometry shared with the engine)', () => {
  test('bridge gate: on the island edge, facing into the bridge, spanning the deck + wings', () => {
    const b = barrierPose(HANDMADE, { id: 1, kind: 'bridge', targetId: 1, islandId: 0 });
    expect(b).not.toBeNull();
    if (!b) return;
    // bridge 1: a = [280, 170] on island 0's east edge (x = 280), b = [360, 170]; width 48 px
    expect(b.dir[0]).toBeCloseTo(1, 9);
    expect(b.dir[1]).toBeCloseTo(0, 9);
    expect(b.yaw).toBeCloseTo(0, 9);
    // island-side face on the edge (the edge search steps 1 px into the island)
    expect(Math.abs(b.center[0] - b.thickness / 2 - 280 / PX_PER_METER)).toBeLessThan(1.5 / PX_PER_METER);
    expect(b.center[2]).toBeCloseTo(170 / PX_PER_METER, 6);
    expect(b.center[1]).toBe(0);
    expect(b.page[0]).toBeCloseTo(b.center[0] * PX_PER_METER, 6);
    expect(b.deckWidth).toBeCloseTo(48 / PX_PER_METER, 6);
    expect(b.width).toBeGreaterThan(b.deckWidth + 1);
    expect(b.height).toBe(LOCK_HEIGHT_M);
    // fences run to the far end of the deck (b = 360 px)
    expect(b.center[0] + b.thickness / 2 + b.fence.length).toBeCloseTo(360 / PX_PER_METER, 6);
    expect(b.fence.length).toBeGreaterThan(5);
    // from the other side it faces west
    const o = barrierPose(HANDMADE, { id: 2, kind: 'bridge', targetId: 1, islandId: 1 });
    expect(o?.dir[0]).toBeCloseTo(-1, 9);
    expect(Math.abs((o?.center[0] ?? 0) + (o?.thickness ?? 0) / 2 - 360 / PX_PER_METER)).toBeLessThan(
      1.5 / PX_PER_METER,
    );
  });

  test('ramp gate stands at the floor height of its island; fences cover the whole rise', () => {
    const lo = barrierPose(HANDMADE, { id: 1, kind: 'bridge', targetId: 3, islandId: 1 });
    const hi = barrierPose(HANDMADE, { id: 2, kind: 'bridge', targetId: 3, islandId: 2 });
    expect(lo?.center[1]).toBe(0);
    expect(hi?.center[1]).toBeCloseTo(1.5 * LEVEL_HEIGHT_M, 9);
    expect(lo?.fence.top).toBeCloseTo(1.5 + LOCK_HEIGHT_M, 9);
    expect(lo?.dir[1]).toBeCloseTo(1, 9); // island 1 → 2 is +z (page down)
    expect(hi?.dir[1]).toBeCloseTo(-1, 9);
  });

  test('elevator gate: just before the entry end of the platform on the lock island, at that level', () => {
    const lo = barrierPose(HANDMADE, LIFT_LOW);
    const hi = barrierPose(HANDMADE, LIFT_HIGH);
    expect(lo?.kind).toBe('elevator');
    expect(lo?.center[1]).toBeCloseTo(1.5, 9);
    expect(hi?.center[1]).toBeCloseTo(4, 9);
    // the lift runs a = [360, 540] (low, east) → b = [344, 540] (high, west)
    expect(lo?.dir[0]).toBeCloseTo(-1, 9); // from the low island westwards into the platform
    expect(hi?.dir[0]).toBeCloseTo(1, 9);
    // the high platform ends at b (x = 344 px, the upper island's edge): the gate stands on the island before it
    expect(hi?.center[0]).toBeCloseTo(344 / PX_PER_METER - (hi?.thickness ?? 0) / 2 - 0.1, 6);
    // the low platform ends 18.75 px east of b, on the low island
    expect(lo?.center[0]).toBeCloseTo((344 + 18.75) / PX_PER_METER + (lo?.thickness ?? 0) / 2 + 0.1, 6);
  });

  test('specs that do not match the stage: null pose, no boxes, load throws', async () => {
    expect(barrierPose(HANDMADE, { id: 1, kind: 'bridge', targetId: 1, islandId: 3 })).toBeNull();
    expect(barrierPose(HANDMADE, { id: 1, kind: 'bridge', targetId: 99, islandId: 0 })).toBeNull();
    expect(barrierPose(HANDMADE, GOAL)).toBeNull();
    expect(lockBoxes(HANDMADE, GOAL)).toEqual([]);
    expect(lockBoxes(HANDMADE, CUT[0] as LockSpec)).toHaveLength(3);
    await expect(
      sim.load(HANDMADE, { locks: [{ id: 1, kind: 'elevator', targetId: 0, islandId: 0 }] }),
    ).rejects.toThrow(/does not match/);
    await expect(sim.load(HANDMADE, { locks: [GOAL, { ...GOAL }] })).rejects.toThrow(/duplicate/);
  });
});

describe('M0 spike: a closed gate holds at full speed with POWER + repeated JUMP', () => {
  test.each([0, 20, -20, 40, -40, 60, -60])(
    'approach at %i°: blocked for 8 s, `locked` ≤ 1/s',
    async (angleDeg) => {
      const r = await ramGate(sim, HANDMADE, CUT, 11, { angleDeg, seconds: 8, jumpEvery: 0.3 });
      expect(r.approachSpeed).toBeGreaterThan(12);
      expect(r.islands).not.toContain(1);
      expect(r.fell).toBe(false);
      expect(r.maxPastFace).toBeLessThan(0.2); // contact softness only; the gate is 0.3 m thick
      expect(r.maxHeight).toBeLessThan(LOCK_HEIGHT_M - 0.8);
      expect(r.locked).toBeGreaterThanOrEqual(5);
      expect(r.locked).toBeLessThanOrEqual(8);
      for (let i = 1; i < r.lockedTicks.length; i++)
        expect((r.lockedTicks[i] as number) - (r.lockedTicks[i - 1] as number)).toBeGreaterThanOrEqual(
          SIM_HZ,
        );
    },
  );

  test('an open lock passes: the same drive reaches island 1', async () => {
    const r = await ramGate(sim, HANDMADE, CUT, 11, {
      angleDeg: 0,
      seconds: 4,
      openAtTick: 1,
      targetPastM: 12,
    });
    expect(r.islands).toContain(1);
    expect(r.locked).toBe(0);
  });

  test('setLock mid-run opens: blocked for 3 s, then the ball rolls through', async () => {
    const r = await ramGate(sim, HANDMADE, CUT, 11, {
      angleDeg: 0,
      seconds: 7,
      openAtTick: 3 * SIM_HZ,
      targetPastM: 12,
      jumpEvery: 100, // no jumping
    });
    expect(r.locked).toBeGreaterThanOrEqual(1);
    expect(Math.max(...r.lockedTicks)).toBeLessThan(3 * SIM_HZ);
    expect(r.islands).toContain(1);
  });

  test('an elevator gate holds too (low and high side)', async () => {
    for (const lock of [LIFT_LOW, LIFT_HIGH]) {
      for (const angleDeg of [0, 30, -30]) {
        const r = await ramGate(sim, HANDMADE, [lock], lock.id, { angleDeg, seconds: 5, distM: 8 });
        expect(r.events.filter((e) => e.type === 'elevator')).toEqual([]);
        expect(r.islands).toEqual([]);
        expect(r.maxHeight).toBeLessThan(LOCK_HEIGHT_M - 0.8);
        expect(r.locked).toBeGreaterThanOrEqual(2);
        expect(r.maxPastFace).toBeLessThan(0.2);
      }
    }
  });
});

describe('goal lock', () => {
  test('closed: entering the goal emits `locked` (≤ 1/s), not `goal`; opening re-arms it', async () => {
    await sim.load(HANDMADE, { locks: [GOAL] });
    sim.reset(HANDMADE.goal.pos);
    const closed = run(sim, 3 * SIM_HZ);
    expect(closed.filter((e) => e.type === 'goal')).toHaveLength(0);
    expect(lockedIds(closed)).toEqual([30, 30, 30]);
    sim.setLock(30, true);
    const opened = run(sim, 10);
    expect(opened.filter((e) => e.type === 'goal')).toHaveLength(1);
    expect(lockedIds(opened)).toEqual([]);
  });

  test('closing it again after the goal latched changes nothing (the goal only fires once)', async () => {
    await sim.load(HANDMADE, { locks: [GOAL] });
    sim.setLock(30, true);
    sim.reset(HANDMADE.goal.pos);
    expect(run(sim, 20).filter((e) => e.type === 'goal')).toHaveLength(1);
    sim.setLock(30, false);
    expect(run(sim, 2 * SIM_HZ).filter((e) => e.type === 'goal' || e.type === 'locked')).toHaveLength(0);
  });
});

describe('elevator lock', () => {
  /** Put the ball straight onto the low platform (past its gate) and hold it there. */
  async function onLowPlatform(locks: LockSpec[]) {
    await sim.load(HANDMADE, { locks });
    const e = HANDMADE.elevators[0];
    if (!e) throw new Error('elevator');
    // platform footprint spans x 344..362.75 px; its centre at x ≈ 353 px, z = 540 px
    sim.setBallState([353 / PX_PER_METER, e.levelLow * LEVEL_HEIGHT_M + 0.51, 540 / PX_PER_METER]);
  }

  test("won't ride while closed; emits `locked`; opening while on the platform starts the ride", async () => {
    await onLowPlatform([LIFT_LOW]);
    const closed = run(sim, 2 * SIM_HZ);
    expect(closed.filter((e) => e.type === 'elevator')).toEqual([]);
    expect(lockedIds(closed)).toEqual([20]); // the trigger edge fired once while the ball sat still
    sim.setLock(20, true);
    const opened = run(sim, 3 * SIM_HZ);
    expect(opened.filter((e) => e.type === 'elevator')).toEqual([
      { type: 'elevator', elevatorId: 0, phase: 'start' },
      { type: 'elevator', elevatorId: 0, phase: 'end' },
    ]);
  });

  test('without the lock the same placement rides at once (control)', async () => {
    await onLowPlatform([]);
    const ev = run(sim, 2 * SIM_HZ);
    expect(ev.filter((e) => e.type === 'elevator' && e.phase === 'start')).toHaveLength(1);
  });
});

describe('determinism and the no-lock path', () => {
  const inputs: InputSample[] = ReplaySchema.parse(JSON.parse(readFileSync(HANDMADE_REPLAY_URL, 'utf8')));

  test('no locks: `load(stage, {})` and `load(stage, { locks: [] })` replay exactly like `load(stage)`', async () => {
    const base = await replay(HANDMADE, inputs);
    const empty = await replay(HANDMADE, inputs, { locks: [] });
    expect(empty.events).toEqual(base.events);
    expect(empty.final).toEqual(base.final);
    const s = await createSimulation();
    await s.load(HANDMADE, {});
    let last = s.getBallState();
    for (const i of inputs) last = s.step(i).ball;
    s.dispose();
    expect(last).toEqual(base.final);
  });

  test('locks opened on schedule: the fixture route still finishes, identically on every run', async () => {
    // The fixture replay crosses bridge 1 (island 0 → 1), the ramp (bridge 3) and the elevator to the goal.
    const locks: LockSpec[] = [...CUT, { id: 13, kind: 'bridge', targetId: 3, islandId: 1 }, LIFT_LOW, GOAL];
    const lockTimeline = [
      ...[10, 11, 12, 13, 20, 30].map((lockId) => ({ tick: 1, lockId, open: true })),
      { tick: 2, lockId: 12, open: false }, // bridge 2 is off the route: closing it changes nothing on the route
    ];
    const a = await replay(HANDMADE, inputs, { locks, lockTimeline });
    const b = await replay(HANDMADE, inputs, { locks, lockTimeline });
    expect(a.goalTick).toBeGreaterThan(0);
    expect(b.events).toEqual(a.events);
    expect(b.final).toEqual(a.final);
  });

  test('a closed lock on the route stops the same replay, deterministically', async () => {
    const locks: LockSpec[] = [...CUT];
    const a = await replay(HANDMADE, inputs, { locks });
    const b = await replay(HANDMADE, inputs, { locks });
    expect(a.goalTick).toBe(-1);
    expect(a.events.some((e) => e.event.type === 'locked')).toBe(true);
    expect(a.events.some((e) => e.event.type === 'island' && e.event.islandId === 1)).toBe(false);
    expect(b.events).toEqual(a.events);
    expect(b.final).toEqual(a.final);
  });
});
