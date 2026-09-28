import { readFileSync } from 'node:fs';
import { bridgeSections, bridgeSurfaceMesh, type StageData } from '@wwm/schema';
import { expect, test } from 'vitest';
import { buildHeightfield, sampleTop } from '../src/geom/heightfield.ts';
import { buildStageMeshes } from '../src/geom/structures.ts';
import { planTiles } from '../src/geom/tiling.ts';

test('straight unbanked elevation profile uses shared surface in render and camera', () => {
  const stage: StageData = JSON.parse(
    readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
  );
  stage.islands = [];
  stage.elevators = [];
  stage.bridges = [
    {
      id: 0,
      from: 0,
      to: 1,
      a: [135, 135],
      b: [675, 135],
      width: 100,
      type: 'ramp',
      levelA: 0,
      levelB: 8,
      elevationProfile: 'smoothstep',
      rails: false,
    },
  ];
  const bridge = stage.bridges[0];
  if (!bridge) throw new Error('fixture');
  const mesh = buildStageMeshes(stage, planTiles(stage.size.width, stage.size.height, 1, 4096));
  const shared = bridgeSurfaceMesh(bridge, 0.463);
  // Every shared surface vertex is present in the rendered non-indexed triangles.
  const rendered = new Set<string>();
  for (let i = 0; i < mesh.bridges.position.length; i += 3)
    rendered.add(Array.from(mesh.bridges.position.slice(i, i + 3)).join(','));
  for (let i = 0; i < shared.vertices.length; i += 3)
    expect(rendered.has(Array.from(shared.vertices.slice(i, i + 3)).join(','))).toBe(true);
  const hf = buildHeightfield(stage);
  const section = bridgeSections(bridge).find((s) => s.progress >= 0.25);
  if (!section) throw new Error('section');
  expect(sampleTop(hf, section.pos[0] / 13.5, section.pos[1] / 13.5)).toBeCloseTo(section.y, 0);
  expect(section.y).toBeLessThan(8 * section.progress - 0.5);
});
