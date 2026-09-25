/**
 * The converted 2013 stage (reference/aid-dcc.stage.json, from `pnpm ref:fetch`; gitignored, never committed)
 * must be traversable: 38 islands, 31 bridges/ramps, 6 elevators, 505 items. Skipped when not fetched.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { StageData } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { runInputs } from '../src/replay.ts';
import { createSimulation } from '../src/simulation.ts';
import { flyWaypoints } from './helpers/pilot.ts';
import { plannedRoute } from './helpers/route.ts';
import { AID_DCC_URL } from './helpers/stages.ts';

describe.skipIf(!existsSync(AID_DCC_URL))('reference aid-dcc (2013 stage)', () => {
  test('start → goal with the test pilot: elevators both ways, no falls, deterministic re-run', async () => {
    const stage = JSON.parse(readFileSync(AID_DCC_URL, 'utf8')) as StageData;
    const sim = await createSimulation();
    await sim.load(stage);
    const run = flyWaypoints(sim, stage, plannedRoute(stage), { maxTicks: 400 * 120 });
    const kinds = run.events.map((e) => e.event.type);
    const elevators = run.events.filter((e) => e.event.type === 'elevator');
    const islands = new Set(run.events.flatMap((e) => (e.event.type === 'island' ? [e.event.islandId] : [])));
    console.log(
      `[physics] aid-dcc traversed: goal at tick ${run.goalTick} (${(run.goalTick / 120).toFixed(0)} s), ` +
        `${islands.size} islands, ${elevators.length / 2} elevator rides, ${kinds.filter((k) => k === 'item').length} items`,
    );
    expect(run.goalTick).toBeGreaterThan(0);
    expect(kinds).not.toContain('fell');
    expect(elevators.length).toBeGreaterThanOrEqual(4);

    await sim.load(stage);
    const again = runInputs(sim, run.inputs);
    sim.dispose();
    expect(again.goalTick).toBe(run.goalTick);
    expect(again.events).toEqual(run.events);
  }, 120_000);
});
