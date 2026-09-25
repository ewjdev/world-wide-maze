/**
 * Phase 13: the portal sensor (contracts §10.1). It fires `{type:'portal', portalId}` once on entering, re-arms
 * after the ball leaves, never fires when the ball is placed onto it, and changes nothing in the simulation
 * (a sensor with no contact response: trajectories are bit-identical with and without portals).
 */
import { type InputSample, PORTAL_RADIUS_M, type Portal, type SimEvent, type StageData } from '@wwm/schema';
import { pageToWorld } from '@wwm/schema/space';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createSimulation, type RapierSimulation } from '../src/simulation.ts';
import { HANDMADE, island, makeStage, rect } from './helpers/stages.ts';

const IDLE: InputSample = { tiltX: 0, tiltZ: 0, frameYaw: 0, power: false, jump: false };

const portal = (id: number, pos: [number, number]): Portal => ({
  id,
  islandId: 0,
  pos,
  href: `https://example.com/${id}`,
  label: `Portal ${id}`,
  sourceElementId: id,
});

/** A railed 1000 × 1000 px plate; the ball starts at (500, 700), a portal sits 4.4 m "up the page". */
const PLATE: StageData = {
  ...makeStage({
    islands: [island(0, rect(0, 0, 1000, 1000), 0)],
    start: [500, 700],
    width: 1000,
    height: 1000,
  }),
  portals: [portal(0, [500, 640]), portal(1, [150, 150])],
};

function run(sim: RapierSimulation, n: number, input: Partial<InputSample> = {}): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...sim.step({ ...IDLE, ...input }).events);
  return events;
}
const portalsOf = (ev: SimEvent[]) =>
  ev.flatMap((e) => (e.type === 'portal' ? [e.portalId] : ([] as number[])));

let sim: RapierSimulation;
beforeAll(async () => {
  sim = await createSimulation();
});
afterAll(() => sim.dispose());

describe('portal sensor', () => {
  test('rolling through fires once; leaving re-arms; rolling back fires again', async () => {
    await sim.load(PLATE);
    run(sim, 30);
    // forward (frameYaw 0 = −Z = up the page) across the portal and beyond it
    const there = run(sim, 240, { power: true, tiltZ: 0.25 });
    expect(portalsOf(there)).toEqual([0]);
    const z = sim.getBallState().pos[2];
    const portalZ = pageToWorld([500, 640], 0)[2];
    expect(z).toBeLessThan(portalZ - PORTAL_RADIUS_M); // it rolled out the far side
    // back again (backwards tilt), through the same portal
    const back = run(sim, 420, { power: true, tiltZ: -0.25 });
    expect(portalsOf(back)).toEqual([0]);
  });

  test('a ball placed onto a portal (respawn, teleport) does not fire until it leaves and re-enters', async () => {
    await sim.load(PLATE);
    sim.reset([150, 150]);
    expect(portalsOf(run(sim, 60))).toEqual([]);
    const [x, y, z] = pageToWorld([500, 640], 0);
    sim.setBallState([x, y + 0.5, z]);
    expect(portalsOf(run(sim, 60))).toEqual([]);
  });

  test('no contact response: trajectories are identical with and without portals', async () => {
    const inputs: InputSample[] = [];
    for (let i = 0; i < 600; i++)
      inputs.push({ ...IDLE, power: i > 20, tiltZ: 0.22, tiltX: Math.sin(i / 60) * 0.02, frameYaw: 0 });
    const trace = async (stage: StageData) => {
      await sim.load(stage);
      const out: number[] = [];
      const events: SimEvent[] = [];
      for (const s of inputs) {
        const r = sim.step(s);
        out.push(...r.ball.pos, ...r.ball.vel);
        events.push(...r.events);
      }
      return { out, events };
    };
    const without = await trace({ ...PLATE, portals: [] });
    const withP = await trace(PLATE);
    expect(withP.out).toEqual(without.out);
    expect(withP.events.filter((e) => e.type !== 'portal')).toEqual(without.events);
    expect(portalsOf(withP.events)).toContain(0);
  });

  test('stages without a portals field still load (optional, contracts §10.1)', async () => {
    const { portals: _, ...legacy } = HANDMADE as StageData & { portals?: Portal[] };
    await sim.load(legacy as StageData);
    expect(portalsOf(run(sim, 30))).toEqual([]);
  });
});
