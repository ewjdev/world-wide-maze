/**
 * Phase 13: portals are optional exits (contracts §10.1). The solver ignores them: a portal on the route changes
 * nothing about the solve, and the fixture stages that now carry portals still solve.
 */
import { readFileSync } from 'node:fs';
import { type StageData, sliceCount } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { loadCapture } from '@wwm/stage-builder/node';
import { describe, expect, test } from 'vitest';
import { solveStage } from '../src/index.ts';

const handmade = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;

describe('portals and the solver', () => {
  test('a portal on the start island changes nothing about the solve', async () => {
    const plain = await solveStage(handmade);
    const start = handmade.start.pos;
    const withPortal: StageData = {
      ...handmade,
      portals: [
        {
          id: 0,
          islandId: handmade.start.islandId,
          pos: [start[0] + 60, start[1]],
          href: 'https://example.com/',
          label: 'Example',
          sourceElementId: 0,
        },
      ],
    };
    const r = await solveStage(withPortal);
    expect(r.success).toBe(plain.success);
    expect(r.timeSec).toBe(plain.timeSec);
    expect(r.inputs).toEqual(plain.inputs);
  }, 60_000);

  test.each([
    'hn-front',
    'wikipedia-article',
    'bbc-news-grid',
    'govuk-card-grid',
    'mdn-dark-docs',
    'example-sparse',
    'image-gallery',
  ])(
    '%s: every slice (with its portals) still solves',
    async (slug) => {
      const { capture, image } = loadCapture(slug);
      let portals = 0;
      for (let sliceIndex = 0; sliceIndex < sliceCount(capture); sliceIndex++) {
        const { stage } = buildStage({ capture, image, sliceIndex, seed: 1, difficulty: 'normal' });
        portals += stage.portals?.length ?? 0;
        const r = await solveStage(stage);
        expect(r.success, `${slug} slice ${sliceIndex}: ${r.failure?.kind}`).toBe(true);
      }
      expect(portals).toBeGreaterThan(0);
    },
    300_000,
  );
});
