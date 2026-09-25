/**
 * Ghost runs (task 6): a solved run as a replay in the contract format (`InputSample[]` at SIM_HZ, tagged with
 * the physics version like score submissions: contracts §9 v0.2.2). Phase 08 uses it for attract mode and
 * Phase 10 for "race the bot". Replays are exact only on the same PHYSICS_VERSION.
 */
import { PHYSICS_VERSION } from '@wwm/physics';
import type { InputSample, StageData } from '@wwm/schema';
import type { SolveResult } from './solve.ts';

export interface GhostReplay {
  kind: 'wwm.ghost/1';
  stageId: string;
  physicsVersion: string;
  /** Sim time of the run (s) and falls, for display. */
  timeSec: number;
  falls: number;
  inputs: InputSample[];
}

export function toGhostReplay(stage: StageData, solve: SolveResult): GhostReplay {
  if (!solve.success) throw new Error('toGhostReplay: the solve did not reach the goal');
  return {
    kind: 'wwm.ghost/1',
    stageId: stage.stageId,
    physicsVersion: PHYSICS_VERSION,
    timeSec: solve.timeSec,
    falls: solve.falls,
    inputs: solve.inputs,
  };
}

/** Same layout as `fixtures/replays/*.json` (one sample per line) when `inputsOnly`, else the tagged object. */
export function formatGhost(g: GhostReplay, inputsOnly = false): string {
  const body = `[\n${g.inputs.map((s) => JSON.stringify(s)).join(',\n')}\n]`;
  if (inputsOnly) return `${body}\n`;
  const { inputs: _inputs, ...head } = g;
  return `${JSON.stringify(head).slice(0, -1)},"inputs":${body}}\n`;
}
