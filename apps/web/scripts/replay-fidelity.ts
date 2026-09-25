/**
 * Phase 08b measurement: does the replay the game records re-simulate to the same run?
 *
 * Plays the practice stage in Chromium with the Phase 05 fixture replay injected as the input, once per physics
 * driver, and re-simulates what the game recorded with the headless @wwm/physics `replay()`:
 *   - lockstep (main thread, fixed step): the recording should be the injected stream itself.
 *   - worker (Phase 05's free-running worker): the game only knows the input per rendered frame, so the recording
 *     is that input repeated for the frame's ticks.
 *
 *   node --experimental-strip-types scripts/replay-fidelity.ts [runsPerDriver=3]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { replay } from '@wwm/physics';
import type { InputSample, StageData } from '@wwm/schema';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const runs = Number(process.argv[2] ?? 3);
const root = fileURLToPath(new URL('../', import.meta.url));
const stage = JSON.parse(
  readFileSync(new URL('../../../fixtures/stages/handmade-simple.json', import.meta.url), 'utf8'),
) as StageData;
const REPLAY = JSON.parse(
  readFileSync(new URL('../../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
) as InputSample[];

const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error' });
await server.listen();
const base = (server.resolvedUrls?.local[0] ?? 'http://localhost:5173/').replace(/\/$/, '');
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'],
});

const node = await replay(stage, REPLAY, { stopAtGoal: true });
const items = (r: Awaited<ReturnType<typeof replay>>) =>
  r.events.filter((e) => e.event.type === 'item').length;
console.log(`reference (Node, injected stream): goal tick ${node.goalTick}, ${items(node)} items`);

for (const driver of ['lockstep', 'worker'] as const) {
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(
      ([r, worker]) => {
        localStorage.setItem('wwm.howtoSeen', '1');
        localStorage.setItem('wwm.tutorialDone', '1');
        (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = {
          replay: r,
          forceWorker: worker,
          noAutoPause: true,
          skipIntro: true,
        };
      },
      [REPLAY, driver === 'worker'] as const,
    );
    const page = await ctx.newPage();
    await page.goto(`${base}/play/practice`);
    await page.waitForFunction(() => ['goal', 'result'].includes(document.body.dataset.phase ?? ''), null, {
      timeout: 120_000,
    });
    const live = await page.evaluate(() => {
      const g = window.__wwmGame;
      const d = g?.debugState();
      return {
        rec: g?.debugRecording() ?? [],
        ball: d?.ball,
        small: d?.small,
        large: d?.large,
        driver: d?.driver,
      };
    });
    const sim = await replay(stage, live.rec, { stopAtGoal: true });
    const [x = 0, , z = 0] = live.ball ?? [];
    const [fx, , fz] = sim.final.pos;
    console.log(
      `${driver} #${i + 1}: live goal with ${Number(live.small) + Number(live.large)} items after ${live.rec.length} recorded ticks · ` +
        `re-simulated: ${sim.goalTick > 0 ? `goal at tick ${sim.goalTick}` : 'NO goal'}, ${items(sim)} items, ` +
        `end ${Math.hypot(fx - x, fz - z).toFixed(2)} m from the live ball`,
    );
    await ctx.close();
  }
}
await browser.close();
await server.close();
