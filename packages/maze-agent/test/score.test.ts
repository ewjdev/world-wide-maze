import { sliceCount } from '@wwm/schema';
import { expect, it } from 'vitest';
import { buildStage } from '../../stage-builder/src/index.ts';
import { loadCapture } from '../../stage-builder/src/node/index.ts';
import { baseline, FrameSchema, MazePilot, mazeFromStage, scoreAt } from '../src/index.ts';

it.each([
  'hn-front',
  'wikipedia-article',
  'govuk-card-grid',
  'mdn-dark-docs',
  'image-gallery',
  'example-sparse',
])(
  'score controller completes %s with actual gem sensors',
  async (slug) => {
    const { capture, image } = loadCapture(slug);
    for (let sliceIndex = 0; sliceIndex < sliceCount(capture); sliceIndex++) {
      const { stage } = buildStage({ capture, image, sliceIndex, seed: 1, difficulty: 'normal' });
      const p = await new MazePilot(mazeFromStage(stage), 0, true).init();
      try {
        let outcome: string | null = null;
        let n = 0;
        for (; n < 64 && outcome !== 'goal'; n++) {
          const f = {
            id: `d${n}`,
            tick: p.tick,
            digest: 'a'.repeat(64),
            observation: p.exploration.observation(),
            candidates: p.exploration.candidates(),
          };
          FrameSchema.parse(f);
          p.choose(baseline(f));
          do {
            outcome = p.step().outcome;
          } while (!outcome);
          if (outcome !== 'arrived' && outcome !== 'goal')
            console.log(
              'FAILED TARGET',
              p.target,
              'leg',
              p.leg,
              p.route?.legs.length,
              p.tracking,
              p.route?.legs[p.leg],
            );
          expect(
            ['arrived', 'goal'],
            `${slug} slice ${sliceIndex} decision ${n} tick ${p.tick} ${JSON.stringify(p.ball.pos)} ${outcome}`,
          ).toContain(outcome);
        }
        console.log(slug, stage.islands.length, stage.items.length, n, p.tick, p.score);
        expect(outcome).toBe('goal');
        expect(p.score.gems).toBeGreaterThan(0);
      } finally {
        p.dispose();
      }
    }
  },
  60000,
);
it('only awards a time bonus at the goal, and gem sensors are deduplicated', () => {
  const { capture, image } = loadCapture('hn-front');
  const { stage } = buildStage({ capture, image, sliceIndex: 0, seed: 1, difficulty: 'normal' });
  const ids = new Set(stage.items.map((i) => i.id));
  const live = scoreAt(stage, ids, 120);
  const final = scoreAt(stage, ids, 120, true);
  expect(live.bonus).toBe(0);
  expect(final.score - live.score).toBe((stage.timeLimitSec - 1) * 5);
});
