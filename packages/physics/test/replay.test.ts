import { readFileSync } from 'node:fs';
import { type InputSample, parseStage, ReplaySchema, SIM_HZ } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { record, replay, runInputs } from '../src/replay.ts';
import { createSimulation } from '../src/simulation.ts';
import { HANDMADE, HANDMADE_REPLAY_URL } from './helpers/stages.ts';

const inputs: InputSample[] = ReplaySchema.parse(JSON.parse(readFileSync(HANDMADE_REPLAY_URL, 'utf8')));

describe('fixtures/replays/handmade-simple.keyboard.json', () => {
  test('is a valid contract Replay within keyboard tilt limits', () => {
    expect(inputs.length).toBeGreaterThan(SIM_HZ);
    for (const s of inputs) {
      expect(Math.abs(s.tiltX)).toBeLessThanOrEqual(0.436);
      expect(Math.abs(s.tiltZ)).toBeLessThanOrEqual(0.436);
    }
  });

  test('reaches the goal, crossing a bridge, the ramp and the elevator; each item fires once', async () => {
    const r = await replay(parseStage(HANDMADE), inputs);
    expect(r.goalTick).toBe(inputs.length);
    const types = r.events.map((e) => e.event.type);
    expect(types.filter((t) => t === 'goal')).toHaveLength(1);
    expect(r.events.filter((e) => e.event.type === 'elevator').map((e) => e.event)).toEqual([
      { type: 'elevator', elevatorId: 0, phase: 'start' },
      { type: 'elevator', elevatorId: 0, phase: 'end' },
    ]);
    const islands = r.events.flatMap((e) => (e.event.type === 'island' ? [e.event.islandId] : []));
    expect(islands).toEqual([0, 1, 2, 3]);
    const items = r.events.flatMap((e) => (e.event.type === 'item' ? [e.event.itemId] : []));
    expect(new Set(items).size).toBe(items.length);
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(r.events.filter((e) => e.event.type === 'item' && e.event.kind === 'large')).toHaveLength(2);
    expect(types).not.toContain('fell');
  });

  test('determinism: 3 runs give identical event streams and final state (tolerance 1e-6, observed exact)', async () => {
    const runs = [
      await replay(HANDMADE, inputs),
      await replay(HANDMADE, inputs),
      await replay(HANDMADE, inputs),
    ];
    const [a, b, c] = runs as [(typeof runs)[0], (typeof runs)[0], (typeof runs)[0]];
    expect(b.events).toEqual(a.events);
    expect(c.events).toEqual(a.events);
    for (const r of [b, c]) {
      for (let k = 0; k < 3; k++) {
        expect(Math.abs((r.final.pos[k] as number) - (a.final.pos[k] as number))).toBeLessThan(1e-6);
      }
      expect(r.final).toEqual(a.final); // bit-identical with the deterministic Rapier build
    }
  });

  test('determinism holds on one reused Simulation after load() (no state leaks between runs)', async () => {
    const sim = await createSimulation();
    await sim.load(HANDMADE);
    const first = runInputs(sim, inputs);
    await sim.load(HANDMADE);
    const second = runInputs(sim, inputs);
    sim.dispose();
    expect(second.events).toEqual(first.events);
    expect(second.final).toEqual(first.final);
  });

  test('record() captures exactly what was stepped', async () => {
    const base = await createSimulation();
    const { sim, inputs: recorded } = record(base);
    await sim.load(HANDMADE);
    for (const s of inputs.slice(0, 500)) sim.step(s);
    sim.dispose();
    expect(recorded).toEqual(inputs.slice(0, 500));
  });

  test('60 Hz parity mode (A/B feel) runs the same replay without errors', async () => {
    const half = inputs.filter((_, i) => i % 2 === 0);
    const r = await replay(HANDMADE, half, { params: { simHz: 60 } });
    expect(r.ticks).toBe(half.length);
  });
});
