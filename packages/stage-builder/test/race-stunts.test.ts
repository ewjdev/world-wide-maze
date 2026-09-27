import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateStage } from '@wwm/schema';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../src/node/png.ts';
import { buildIslandLeap } from '../src/race-stunts.ts';

const dir = resolve(import.meta.dirname, '../../../fixtures/race/island-leap');
const json = (f: string) => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
function fixture() {
  const png = decodePng(readFileSync(resolve(dir, 'texture.png')));
  return {
    input: {
      capture: json('capture.json'),
      image: { ...png, data: new Uint8ClampedArray(png.data) },
      sliceIndex: 0,
      seed: 24,
      difficulty: 'normal' as const,
    },
    author: json('authoring.json'),
  };
}
describe('Island Leap authored HTML course', () => {
  it('extracts all owned HTML islands, validates the safe connector graph and reproduces the frozen course', () => {
    const { input, author } = fixture();
    const c = buildIslandLeap(input, author);
    expect(validateStage(c.stage).ok).toBe(true);
    expect(c).toEqual(json('course.json'));
    expect(c.stage.islands).toHaveLength(8);
    expect(c.stage.bridges.find((b) => b.from === 0 && b.to === 1)?.levelB).toBeGreaterThan(
      c.stage.islands[0].level,
    );
    expect(c.gates).toHaveLength(3);
    expect(c.stunts.launchPads[0].landingIslandIds).toEqual([2, 3]);
    expect(c.stunts.launchPads[1].landingIslandIds).toEqual([5]);
    const secondRamp = c.stage.bridges.find((b) => b.from === 2 && b.to === 6);
    expect(secondRamp?.type).toBe('ramp');
    expect(secondRamp?.levelB).toBeGreaterThan(secondRamp?.levelA ?? Infinity);
    expect(c.stage.islands[7].level).toBeLessThan(c.stage.islands[0].level);
    expect(c.stage.bridges.some((b) => b.from === 7 && b.to === 4)).toBe(true);
    expect(c.gates[1].normal).toEqual([0, 1]);
    expect(c.gates[2].center[2] - c.gates[1].center[2]).toBeGreaterThan(10);
    expect(c.stage.goal.islandId).toBe(5);
  });
  it('includes texture provenance in identity and rejects missing captured provenance', () => {
    const { input, author } = fixture();
    const a = buildIslandLeap(input, author);
    expect(buildIslandLeap(input, { ...author, textureHash: 'other' }).courseId).not.toBe(a.courseId);
    author.sections[0].elementIds = [];
    expect(() => buildIslandLeap(input, author)).toThrow('DOM provenance');
  });
});
