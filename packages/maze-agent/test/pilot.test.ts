import { describe, expect, it } from 'vitest';
import { baseline, digest, Exploration, FIXTURES, MazePilot, modelPayload } from '../src/index.ts';

describe('maze exploration', () => {
  it('does not leak hidden goal or topology into the model payload', () => {
    const f = structuredClone(FIXTURES[0]);
    const a = new Exploration(f);
    f.stage.goal.islandId = 4;
    f.stage.stageId = 'unrelated';
    f.stage.seed = 999;
    const b = new Exploration(f);
    expect(
      modelPayload({
        id: 'a',
        tick: 0,
        digest: 'a',
        observation: a.observation(),
        candidates: a.candidates(),
      }),
    ).toEqual(
      modelPayload({
        id: 'b',
        tick: 0,
        digest: 'b',
        observation: b.observation(),
        candidates: b.candidates(),
      }),
    );
  });
  for (const f of FIXTURES)
    it(`physically completes ${f.id} and reproduces all inputs`, async () => {
      const p = await new MazePilot(f).init();
      const inputs = [];
      let done = false;
      try {
        for (let n = 0; n < 64 && !done; n++) {
          const frame = { observation: p.exploration.observation(), candidates: p.exploration.candidates() };
          p.choose(baseline(frame));
          let outcome = null;
          while (!outcome) {
            const r = p.step();
            inputs.push(r.input);
            outcome = r.outcome;
          }
          expect(
            ['arrived', 'goal'],
            `${f.id} action ${n} tick ${p.tick} at ${JSON.stringify(p.ball.pos)} outcome ${outcome}`,
          ).toContain(outcome);
          done = outcome === 'goal';
        }
        expect(done).toBe(true);
        const expected = await digest(p.ball);
        await p.sim.load(f.stage);
        let result: import('@wwm/schema').SimStepResult | undefined;
        for (const i of inputs) result = p.sim.step(i);
        expect(await digest(result!.ball)).toBe(expected);
      } finally {
        p.dispose();
      }
    }, 30000);
});
