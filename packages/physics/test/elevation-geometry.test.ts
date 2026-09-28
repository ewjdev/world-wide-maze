import { type Bridge, bridgeSurfaceMesh, parseStage } from '@wwm/schema';
import { expect, test } from 'vitest';
import { bridgeSpecs } from '../src/geometry.ts';
import { DEFAULT_PARAMS } from '../src/params.ts';
import { HANDMADE } from './helpers/stages.ts';

test('straight unbanked smooth ramp round-trips and builds shared collider', () => {
  const stage = structuredClone(HANDMADE);
  const bridge = stage.bridges[0] as Bridge;
  bridge.elevationProfile = 'smoothstep';
  bridge.levelB = bridge.levelA + 1;
  bridge.type = 'ramp';
  bridge.rails = false;
  const parsed = parseStage(JSON.parse(JSON.stringify(stage)));
  const parsedBridge = parsed.bridges[0] as Bridge;
  const [deck] = bridgeSpecs(parsedBridge, new Map(parsed.islands.map((i) => [i.id, i])), DEFAULT_PARAMS);
  if (deck?.shape !== 'trimesh') throw new Error('Profile must select shared mesh even without curve/bank');
  expect(deck.vertices).toEqual(bridgeSurfaceMesh(parsedBridge, DEFAULT_PARAMS.slabThickness).vertices);
});
