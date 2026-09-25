/**
 * Phase 13 evidence: screenshots of the link portals in the real game (a Vite dev server of apps/web, with or
 * without the Worker behind `/api`).
 *
 *   node packages/engine/scripts/portal-shots.ts <baseUrl> <outDir> [--stage fixture-hn-front] [--portal 0]
 *        [--travel] [--width 1600 --height 900]
 *
 * Shots: the portal close-up in chase view, the map view with the portal beams, the prompt after rolling in,
 * and with `--travel` the iris, the building screen with the trail and the next site's HUD trail.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]?.startsWith('--')));
const base = positional[0] ?? 'http://localhost:5391';
const out = resolve(positional[1] ?? 'portal-shots');
const stage = flag('--stage') ?? 'fixture-hn-front';
const portal = Number(flag('--portal') ?? 0);
const width = Number(flag('--width') ?? 1600);
const height = Number(flag('--height') ?? 900);
const travel = args.includes('--travel');
const extra = flag('--query') ?? '';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const ctx = await browser.newContext({ viewport: { width, height } });
await ctx.addInitScript(() => {
  localStorage.setItem('wwm.howtoSeen', '1');
  localStorage.setItem('wwm.tutorialDone', '1');
  (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = { skipIntro: true, noAutoPause: true };
});
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

const phase = (p: Page) => p.evaluate(() => document.body.dataset.phase ?? '');
const waitPhase = (p: Page, want: string, timeout = 90_000) =>
  p.waitForFunction((w) => document.body.dataset.phase === w, want, { timeout });
const shot = async (name: string) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name, await phase(page));
};
const game = <T>(fn: string) => page.evaluate(`window.__wwmGame.${fn}`) as Promise<T>;

await page.goto(`${base}/play/${stage}${extra}`);
await waitPhase(page, 'play');
await page.waitForTimeout(1500);
const ok = await game<boolean>(`debugRollIntoPortal(${portal}, 5.5)`);
console.log('roll', ok);
// the approach: a moment before the ball reaches the gate
await page.waitForTimeout(650);
await shot('portal-approach');
console.log(
  'stats',
  JSON.stringify(
    await page.evaluate(() => {
      const e = (
        window as unknown as { __wwmGame: { debugState(): { engine: Record<string, unknown> } } }
      ).__wwmGame.debugState().engine;
      return {
        drawCalls: e.drawCalls,
        scene: e.sceneDrawCalls,
        env: e.envDrawCalls,
        post: e.postDrawCalls,
        tier: e.tier,
        fps: e.fps,
      };
    }),
  ),
);
await page.waitForFunction(() => !!window.__wwmGame?.getView().portal, null, { timeout: 10_000 });
await page.waitForTimeout(700);
await shot('portal-prompt');
if (travel) {
  await page.click('[data-testid="portal-travel"]');
  await page.waitForTimeout(700);
  await shot('travel-gate');
  await page.waitForTimeout(700);
  await shot('travel-iris');
  await waitPhase(page, 'building', 20_000);
  await page.waitForTimeout(900);
  await shot('travel-building');
  await waitPhase(page, 'play', 120_000);
  await page.waitForTimeout(1800);
  await shot('journey-hud');
  // finish the journey's second stop: roll into its goal → result → ranking → the share page
  console.log('goal', await game<boolean>('debugRollIntoGoal(5)'));
  await waitPhase(page, 'result', 60_000);
  await page.waitForTimeout(4500);
  await shot('journey-result');
  await page.click('[data-testid="res-finish"]');
  await waitPhase(page, 'ranking', 20_000);
  await page.waitForTimeout(1500);
  await shot('journey-ranking');
  const href = await page.getAttribute('[data-testid="journey-link"]', 'href');
  console.log('share', href);
  if (href) {
    const card = await ctx.newPage();
    await card.goto(href);
    await card.waitForSelector('[data-testid="journey-page"]');
    await card.waitForTimeout(900);
    await card.screenshot({ path: `${out}/journey-share-card.png`, fullPage: true });
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await phone.goto(href);
    await phone.waitForSelector('[data-testid="journey-page"]');
    await phone.waitForTimeout(900);
    await phone.screenshot({ path: `${out}/journey-share-card-phone.png`, fullPage: true });
  }
} else {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(2600);
  await shot('portal-map');
}
await browser.close();

declare global {
  interface Window {
    __wwmGame?: { getView(): { portal: unknown } };
  }
}
