import { bridgeSurfaceMesh, type InputSample } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { createSimulation, RACE_HORIZONTAL_SPEED_LIMIT, surfaceTravelGrade } from '../src/simulation.ts';
import { island, makeStage, rect } from './helpers/stages.ts';

const idle: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };
const flat = makeStage({
  islands: [island(0, rect(0, 0, 10000, 10000), 0, { guardrails: [] })],
  start: [200, 200],
});
const slope = makeStage({
  islands: [
    island(0, rect(0, 0, 270, 270), 12, { guardrails: [] }),
    island(1, rect(1350, 0, 2700, 270), 0, { guardrails: [] }),
  ],
  bridges: [
    {
      id: 0,
      from: 0,
      to: 1,
      a: [270, 135],
      b: [1350, 135],
      width: 150,
      type: 'ramp',
      levelA: 12,
      levelB: 0,
      rails: false,
      elevationProfile: 'smoothstep',
    },
  ],
  start: [135, 135],
  width: 4050,
  height: 270,
});

describe('Race elevation physics', () => {
  test('default and explicitly disabled profiles remain exactly identical', async () => {
    const a = await createSimulation();
    const b = await createSimulation({ raceElevation: false });
    try {
      await a.load(flat);
      await b.load(flat);
      for (let tick = 0; tick < 500; tick++) {
        const input = { ...idle, power: tick < 350, tiltZ: 0.436, tiltX: 0.2, jump: tick === 250 };
        expect(a.step(input)).toEqual(b.step(input));
      }
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  test('support is actual contact, excludes overhead decks, and clears on teleport/reset', async () => {
    const sim = await createSimulation({ raceElevation: true });
    try {
      await sim.load({
        ...flat,
        islands: [...flat.islands, island(1, rect(0, 0, 10000, 10000), 8, { guardrails: [] })],
      });
      // Explicit test setup: under an upper island, on the lower island.
      sim.setBallState([10, 0.5, 10]);
      for (let i = 0; i < 30; i++) sim.step(idle);
      expect(sim.getSurfaceSupport()?.surfaceId).toBe('island:0');
      expect(sim.getSurfaceSupport()?.normal[1]).toBeGreaterThan(0.99);
      sim.setBallState([10, 4, 10]);
      expect(sim.getSurfaceSupport()).toBeNull();
      sim.step(idle);
      expect(sim.getSurfaceSupport()).toBeNull();
      sim.reset();
      expect(sim.getSurfaceSupport()).toBeNull();
    } finally {
      sim.dispose();
    }
  });

  test('contact grade reverses with travel and ignores camera/vertical velocity', async () => {
    const sim = await createSimulation({ raceElevation: true });
    try {
      await sim.load(slope);
      // Midpoint of smoothstep is at 6m. Injected pose is solely unit-test setup.
      sim.setBallState([60, 6.53, 10]);
      for (let i = 0; i < 12; i++) sim.step(idle);
      const support = sim.getSurfaceSupport();
      expect(support?.surfaceId).toBe('bridge:0');
      expect(surfaceTravelGrade(support, [10, 100, 0])).toBeLessThan(-0.2);
      expect(surfaceTravelGrade(support, [-10, -100, 0])).toBeGreaterThan(0.2);
      expect(Math.abs(surfaceTravelGrade(support, [0, -100, 10]))).toBeLessThan(0.001);
    } finally {
      sim.dispose();
    }
  });

  test('horizontal cap applies after impulse and step while preserving airborne Y; default remains uncapped', async () => {
    for (const enabled of [true, false]) {
      const sim = await createSimulation({ raceElevation: enabled });
      try {
        await sim.load(flat);
        sim.setBallState([10, 20, 10], [40, 9, 0]);
        sim.applyVelocityDelta([30, 7, 0]);
        const after = sim.getBallState();
        expect(after.vel[1]).toBe(16);
        expect(after.vel[0]).toBe(enabled ? RACE_HORIZONTAL_SPEED_LIMIT : 70);
        sim.setBallState([10, 20, 10], [70, 9, 0]);
        const b = sim.step(idle).ball;
        if (enabled) expect(Math.hypot(b.vel[0], b.vel[2])).toBe(48);
        if (!enabled) expect(b.vel[0]).toBeGreaterThan(48);
      } finally {
        sim.dispose();
      }
    }
  });

  test('grounded cap preserves the contact-normal component; jump impulses retain their vertical delta', async () => {
    const sim = await createSimulation({ raceElevation: true });
    try {
      await sim.load(slope);
      sim.setBallState([60, 6.53, 10]);
      for (let i = 0; i < 12; i++) sim.step(idle);
      const support = sim.getSurfaceSupport();
      expect(support).not.toBeNull();
      if (!support) throw new Error('expected ramp support');
      const [nx, ny, nz] = support.normal;
      const v = sim.getBallState().vel;
      const normalBefore = nx * v[0] + ny * v[1] + nz * v[2];
      sim.applyVelocityDelta([70, (-nx * 70) / ny, 0]);
      const capped = sim.getBallState().vel;
      expect(Math.hypot(capped[0], capped[2])).toBeCloseTo(48, 4);
      expect(nx * capped[0] + ny * capped[1] + nz * capped[2]).toBeCloseTo(normalBefore, 4);
      sim.applyVelocityDelta([5, 16, 0]);
      expect(sim.getBallState().vel[1]).toBeCloseTo(capped[1] + 16, 4);
      expect(sim.getSurfaceSupport()).toBeNull();
      await sim.load(flat);
      expect(sim.getSurfaceSupport()).toBeNull();
    } finally {
      sim.dispose();
    }
  });

  test('identical overlapping support contacts select a stable identity on reload', async () => {
    const sim = await createSimulation({ raceElevation: true });
    const base = flat.islands[0];
    if (!base) throw new Error('flat fixture island missing');
    const overlapping = { ...flat, islands: [...flat.islands, { ...base, id: 1 }] };
    try {
      const identities = [];
      for (let repeat = 0; repeat < 3; repeat++) {
        await sim.load(overlapping);
        expect(sim.getSurfaceSupport()).toBeNull();
        for (let tick = 0; tick < 30; tick++) sim.step(idle);
        identities.push(sim.getSurfaceSupport()?.surfaceId);
      }
      expect(identities).toEqual(['island:0', 'island:0', 'island:0']);
    } finally {
      sim.dispose();
    }
  });

  test('nominal 20-degree ramp collider top triangles remain inside the numerical angle envelope', () => {
    const ramp = slope.bridges[0];
    if (!ramp) throw new Error('ramp missing');
    const mesh = bridgeSurfaceMesh({ ...ramp, levelA: (80 * Math.tan((20 * Math.PI) / 180)) / 1.5 }, 0.5);
    let maximum = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const ia = mesh.indices[i] as number;
      const ib = mesh.indices[i + 1] as number;
      const ic = mesh.indices[i + 2] as number;
      const a = Array.from(mesh.vertices.slice(ia * 3, ia * 3 + 3));
      const u = Array.from(mesh.vertices.slice(ib * 3, ib * 3 + 3)).map((v, j) => v - (a[j] as number));
      const v = Array.from(mesh.vertices.slice(ic * 3, ic * 3 + 3)).map((w, j) => w - (a[j] as number));
      const nx = (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number);
      const ny = (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number);
      const nz = (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number);
      if (ny > 1e-8) maximum = Math.max(maximum, (Math.atan(Math.hypot(nx, nz) / ny) * 180) / Math.PI);
    }
    expect(maximum).toBeGreaterThan(19.9);
    expect(maximum).toBeLessThanOrEqual(20.01);
  });

  test('ordinary powered moderate climb maintains a complete 8m/s charging window without turbo', async () => {
    const sim = await createSimulation({ raceElevation: true });
    const climb = {
      ...slope,
      islands: slope.islands.map((i) => ({ ...i, level: i.id === 0 ? 0 : 12 })),
      bridges: slope.bridges.map((b) => ({ ...b, levelA: 0, levelB: 12 })),
    };
    try {
      await sim.load(climb);
      let consecutive = 0;
      let longest = 0;
      for (let tick = 0; tick < 1200; tick++) {
        const b = sim.step({ ...idle, power: true, tiltZ: 0.436, frameYaw: -Math.PI / 2 }).ball;
        const support = sim.getSurfaceSupport();
        const qualifies =
          support?.surfaceId === 'bridge:0' &&
          surfaceTravelGrade(support, b.vel) > 0.001 &&
          Math.hypot(b.vel[0], b.vel[2]) >= 8;
        consecutive = qualifies ? consecutive + 1 : 0;
        longest = Math.max(longest, consecutive);
      }
      expect(longest).toBeGreaterThanOrEqual(360);
      expect(sim.getBallState().pos[0]).toBeGreaterThan(100);
    } finally {
      sim.dispose();
    }
  });

  test('ordinary descent earns terrain speed and crosses seams without falls; replay is exact', async () => {
    const sim = await createSimulation({ raceElevation: true });
    const replay = await createSimulation({ raceElevation: true });
    try {
      await sim.load(slope);
      await replay.load(slope);
      let max = 0;
      let exitSpeed = 0;
      for (let tick = 0; tick < 900; tick++) {
        const input = { ...idle, power: true, tiltZ: 0.436, frameYaw: -Math.PI / 2 };
        const result = sim.step(input);
        expect(replay.step(input)).toEqual(result);
        expect(replay.getSurfaceSupport()).toEqual(sim.getSurfaceSupport());
        expect(result.events.some((e) => e.type === 'fell')).toBe(false);
        max = Math.max(max, Math.hypot(result.ball.vel[0], result.ball.vel[2]));
        if (!exitSpeed && result.ball.pos[0] >= 100) exitSpeed = result.ball.vel[0];
      }
      expect(max).toBeGreaterThan(35);
      expect(max).toBeLessThanOrEqual(48.00001);
      expect(exitSpeed).toBeGreaterThan(24);
      expect(sim.getBallState().vel[0]).toBeLessThan(exitSpeed);
    } finally {
      sim.dispose();
      replay.dispose();
    }
  });
});
