/**
 * Quality-ladder evidence: run the sandbox on its real rAF clock, throttle the CPU through CDP
 * (DevTools "CPU throttling"), and record the tier changes; then unthrottle and watch it recover.
 *
 *   node scripts/ladder.ts [baseUrl] [outDir] [rate] [stageId]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://localhost:5174', outArg = 'shots', rateArg = '60', stage = 'handmade-simple'] =
  process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${base}/dev/engine?quality=auto&stage=${stage}`);
await page.waitForFunction(
  () => (window as never as { __stageReady?: boolean }).__stageReady === true,
  null,
  {
    timeout: 60000,
  },
);
const cdp = await page.context().newCDPSession(page);
const sample = async (label: string) => {
  const s = (await page.evaluate('wwm.engine().stats()')) as {
    fps: number;
    tier: number;
    tierLog: unknown[];
  };
  console.log(label, `fps ${s.fps.toFixed(1)} tier ${s.tier}`);
  return { label, fps: s.fps, tier: s.tier, log: s.tierLog };
};
const timeline: unknown[] = [];
await page.waitForTimeout(5000);
timeline.push(await sample('unthrottled'));
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(rateArg) });
for (let i = 1; i <= 8; i++) {
  await page.waitForTimeout(2500);
  timeline.push(await sample(`throttled ×${rateArg} +${i * 2.5}s`));
}
await page.screenshot({ path: `${out}/ladder-throttled.png` });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
for (let i = 1; i <= 16; i++) {
  await page.waitForTimeout(2500);
  timeline.push(await sample(`recovered +${i * 2.5}s`));
}
await page.screenshot({ path: `${out}/ladder-recovered.png` });
writeFileSync(`${out}/ladder.json`, JSON.stringify(timeline, null, 2));
await browser.close();
