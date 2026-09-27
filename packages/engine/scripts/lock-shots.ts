/**
 * Phase 22 evidence: runtime locks on the handmade fixture in the /dev/engine sandbox (manual clock, 1280 × 720).
 *
 *   pnpm --filter @wwm/web exec vite --port 5391 --strictPort     # in another shell
 *   pnpm --filter @wwm/engine lock-shots [baseUrl] [outDir] [--only name,name] [--backend webgl] [--reduced-motion]
 *
 * Locks: bridge 1 at island 0 ("Pip gate 1"), the ramp (bridge 3) at island 1 ("4 gems", gem icon), the lift at
 * island 2 ("Pip gate 2") and the goal ("Pip gate 3"). Shots: each closed lock in the chase view, the map, a hit
 * (pulse), the opening animation, everything open, the beacon, and the draw-call cost with and without locks.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]?.startsWith('--')));
const base = positional[0] ?? 'http://localhost:5391';
const out = resolve(positional[1] ?? '/tmp/wwm-locks');
const only = flag('--only')?.split(',');
const backend = flag('--backend');
const width = Number(flag('--width') ?? 1280);
const height = Number(flag('--height') ?? 720);
const color = flag('--color') ?? '#4f9fd6';
mkdirSync(out, { recursive: true });

const LOCKS = JSON.stringify([
  { lock: { id: 1, kind: 'bridge', targetId: 1, islandId: 0 }, label: 'Pip gate 1', color, icon: 'pip' },
  { lock: { id: 2, kind: 'bridge', targetId: 3, islandId: 1 }, label: '4 gems', color, icon: 'gem' },
  { lock: { id: 3, kind: 'elevator', targetId: 0, islandId: 2 }, label: 'Pip gate 2', color, icon: 'pip' },
  { lock: { id: 4, kind: 'goal', targetId: 0, islandId: 3 }, label: 'Pip gate 3', color, icon: 'pip' },
]);

const adv = (p: Page, sec: number) =>
  p.evaluate((s) => (window as never as { wwm: { advance(s: number): void } }).wwm.advance(s), sec);
const call = (p: Page, js: string) => p.evaluate(js);
/** Rest the ball at (x, y) px and point the chase camera at (fx, fy). */
const standAt = async (p: Page, x: number, y: number, fx: number, fy: number) => {
  await call(
    p,
    `wwm.placeAt(${x}, ${y}); void wwm.engine().spawnBall([${x}, ${y}], { durationSec: 0.05, faceTo: [${fx}, ${fy}] })`,
  );
  await adv(p, 1.6);
};
const setLocks = (p: Page) => call(p, `wwm.engine().setLocks(${LOCKS})`);
const openAll = (p: Page, state: 'open' | 'opening') =>
  call(p, `for (const id of [1, 2, 3, 4]) wwm.engine().setLockState(id, "${state}")`);

type Shot = { name: string; run: (p: Page) => Promise<void> };
const shots: Shot[] = [
  {
    name: '01-closed-bridge',
    run: async (p) => {
      await setLocks(p);
      await standAt(p, 170, 176, 330, 170);
    },
  },
  {
    name: '02-closed-ramp-gems',
    run: async (p) => {
      await setLocks(p);
      await standAt(p, 470, 190, 480, 380);
    },
  },
  {
    name: '03-closed-elevator',
    run: async (p) => {
      await setLocks(p);
      await standAt(p, 520, 548, 350, 540);
    },
  },
  {
    name: '04-closed-goal',
    run: async (p) => {
      await setLocks(p);
      await standAt(p, 110, 560, 190, 690);
    },
  },
  {
    name: '05-map-closed',
    run: async (p) => {
      await setLocks(p);
      await call(p, 'wwm.setMotion("still"); wwm.engine().setView("map")');
      await adv(p, 2.5);
    },
  },
  {
    name: '06-bridge-hit-pulse',
    run: async (p) => {
      await setLocks(p);
      await standAt(p, 250, 172, 330, 170);
      await call(p, 'wwm.fire({ type: "locked", lockId: 1 })');
      await adv(p, 0.08);
    },
  },
  {
    name: '07-bridge-opening',
    run: async (p) => {
      await setLocks(p);
      await standAt(p, 170, 176, 330, 170);
      await call(p, 'wwm.engine().setLockState(1, "opening")');
      await adv(p, 0.55);
    },
  },
  {
    name: '08-bridge-opened',
    run: async (p) => {
      await setLocks(p);
      await standAt(p, 170, 176, 330, 170);
      await call(p, 'wwm.engine().setLockState(1, "opening")');
      await adv(p, 2);
    },
  },
  {
    name: '09-elevator-opened',
    run: async (p) => {
      await setLocks(p);
      await openAll(p, 'opening');
      await standAt(p, 520, 548, 350, 540);
      await adv(p, 1);
    },
  },
  {
    name: '10-goal-opened',
    run: async (p) => {
      await setLocks(p);
      await openAll(p, 'open');
      await standAt(p, 110, 560, 190, 690);
    },
  },
  {
    name: '11-map-opened',
    run: async (p) => {
      await setLocks(p);
      await openAll(p, 'open');
      await call(p, 'wwm.setMotion("still"); wwm.engine().setView("map")');
      await adv(p, 2.5);
    },
  },
  {
    name: '12-beacon-chase',
    run: async (p) => {
      await setLocks(p);
      await standAt(p, 170, 176, 330, 170);
      await call(p, 'wwm.engine().setBeacon([240, 110])');
      await adv(p, 0.8);
    },
  },
  {
    name: '13-beacon-map',
    run: async (p) => {
      await setLocks(p);
      await call(p, 'wwm.engine().setBeacon([130, 90]); wwm.setMotion("still"); wwm.engine().setView("map")');
      await adv(p, 2.5);
    },
  },
  {
    name: '14-no-locks-baseline',
    run: async (p) => {
      await standAt(p, 170, 176, 330, 170);
    },
  },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const metrics: Record<string, unknown> = {};
for (const shot of shots) {
  if (only && !only.includes(shot.name)) continue;
  const page = await browser.newPage({
    viewport: { width, height },
    reducedMotion: args.includes('--reduced-motion') ? 'reduce' : 'no-preference',
  });
  const logs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  const q = new URLSearchParams({ clock: 'manual', ui: '0', quality: 'high', stage: 'handmade-simple' });
  if (backend) q.set('backend', backend);
  await page.goto(`${base}/dev/engine?${q}`);
  try {
    await page.waitForFunction(
      () => (window as never as { wwm?: { engine(): unknown } }).wwm?.engine?.(),
      null,
      {
        timeout: 30000,
      },
    );
    await page.waitForFunction(
      () => (window as never as { __stageReady?: boolean }).__stageReady === true,
      null,
      {
        timeout: 60000,
      },
    );
    await shot.run(page);
    await page.screenshot({ path: `${out}/${shot.name}.png` });
    metrics[shot.name] = await page.evaluate('wwm.engine().stats()');
    const m = metrics[shot.name] as { drawCalls: number; sceneDrawCalls: number; backend: string };
    console.log(shot.name, `draws ${m.drawCalls} (scene ${m.sceneDrawCalls}) ${m.backend}`);
  } catch (e) {
    console.error(shot.name, 'FAILED', e);
  }
  if (logs.length) console.log(`  console (${logs.length}):`, logs.slice(0, 8).join('\n  '));
  await page.close();
}
writeFileSync(`${out}/metrics.json`, JSON.stringify(metrics, null, 2));
await browser.close();
