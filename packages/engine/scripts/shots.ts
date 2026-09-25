/**
 * Screenshot + measurement harness for the /dev/engine sandbox (Phase 04 evidence).
 *
 *   pnpm --filter web exec vite --port 5174      # in another shell
 *   pnpm --filter @wwm/engine shots [baseUrl] [outDir] [--only name,name] [--backend webgl]
 *
 * Uses the sandbox's manual clock (`?clock=manual`) so every frame is deterministic.
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
const base = positional[0] ?? 'http://localhost:5174';
const out = resolve(positional[1] ?? 'shots');
const only = flag('--only')?.split(',');
const backend = flag('--backend');
const width = Number(flag('--width') ?? 1600);
const height = Number(flag('--height') ?? 900);
mkdirSync(out, { recursive: true });

type Shot = { name: string; stage: string; run: (p: Page) => Promise<void> };

const adv = (p: Page, sec: number) =>
  p.evaluate((s) => (window as never as { wwm: { advance(s: number): void } }).wwm.advance(s), sec);
const call = (p: Page, js: string) => p.evaluate(js);

const shots: Shot[] = [
  {
    name: 'chase-start',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(p, 'wwm.setMotion("still")');
      await adv(p, 1.5);
    },
  },
  {
    name: 'chase-route',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(p, 'wwm.placeOnRoute(0.18)');
      await adv(p, 2.2);
    },
  },
  {
    name: 'chase-ramp',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(p, 'wwm.placeOnRoute(0.42)');
      await adv(p, 2.0);
    },
  },
  {
    name: 'map',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(p, 'wwm.setMotion("still"); wwm.engine().setView("map")');
      await adv(p, 2.5);
    },
  },
  ...[0.4, 2.5, 4.2, 5.6, 7.0, 8.4, 10.5, 12.8, 14.8].map(
    (t): Shot => ({
      name: `intro-${String(t).replace('.', '_')}s`,
      stage: 'handmade-simple',
      run: async (p) => {
        await call(p, 'wwm.setMotion("still"); void wwm.engine().playIntro({ mode: "full" })');
        await adv(p, t);
      },
    }),
  ),
  {
    name: 'goal-fireworks',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(p, 'wwm.placeOnRoute(0.97)');
      await adv(p, 1.5);
      await call(p, 'wwm.freeze(true); void wwm.engine().playGoal(7)');
      await adv(p, 3.1);
    },
  },
  {
    name: 'items-pop',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(p, 'wwm.placeOnRoute(0.16); wwm.setMotion("still")');
      await adv(p, 1.5);
      await call(p, 'wwm.collectNext("small"); wwm.collectNext("small"); wwm.collectNext("large")');
      await adv(p, 0.12);
    },
  },
  {
    name: 'elevator',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(p, 'wwm.placeOnRoute(0.7)');
      await adv(p, 1.2);
      await call(p, 'wwm.placeOnRoute(0.782); wwm.freeze(true)');
      await adv(p, 0.05);
      await call(p, 'wwm.freeze(false); wwm.advance(0.02); wwm.freeze(true)');
      await adv(p, 0.6);
    },
  },
  {
    name: 'fall-ripple',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(
        p,
        'wwm.placeOnRoute(0.3); wwm.freeze(true); wwm.advance(0.1); wwm.fire({ type: "lost" }); wwm.engine().setView("map")',
      );
      await adv(p, 2.2);
    },
  },
  {
    name: 'intro-skip',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(p, 'wwm.setMotion("still"); void wwm.engine().playIntro({ mode: "full" })');
      await adv(p, 3);
      await call(p, 'wwm.engine().skipIntro()');
      await adv(p, 0.3);
    },
  },
  {
    name: 'intro-fast-3s',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(p, 'wwm.setMotion("still"); void wwm.engine().playIntro({ mode: "fast" })');
      await adv(p, 3);
    },
  },
  {
    name: 'spawn-cage',
    stage: 'handmade-simple',
    run: async (p) => {
      await call(p, 'wwm.setMotion("still"); void wwm.engine().spawnBall()');
      await adv(p, 1.7);
    },
  },
  {
    name: 'aid-chase',
    stage: 'reference:aid-dcc',
    run: async (p) => {
      await call(p, 'wwm.placeOnRoute(0.05)');
      await adv(p, 2.5);
    },
  },
  {
    name: 'aid-chase-2',
    stage: 'reference:aid-dcc',
    run: async (p) => {
      await call(p, 'wwm.placeOnRoute(0.5)');
      await adv(p, 2.5);
    },
  },
  {
    name: 'aid-map',
    stage: 'reference:aid-dcc',
    run: async (p) => {
      await call(p, 'wwm.setMotion("still"); wwm.engine().setView("map")');
      await adv(p, 3);
    },
  },
  ...[0.4, 3.0, 5.4, 7.2, 9.4, 11.5].map(
    (t): Shot => ({
      name: `aid-intro-${String(t).replace('.', '_')}s`,
      stage: 'reference:aid-dcc',
      run: async (p) => {
        await call(p, 'wwm.setMotion("still"); void wwm.engine().playIntro({ mode: "full" })');
        await adv(p, t);
      },
    }),
  ),
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const metrics: Record<string, unknown> = {};
for (const shot of shots) {
  if (only && !only.includes(shot.name)) continue;
  const page = await browser.newPage({ viewport: { width, height } });
  const logs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  const q = new URLSearchParams({ clock: 'manual', ui: '0', quality: 'high', stage: shot.stage });
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
      { timeout: 60000 },
    );
    await shot.run(page);
    await page.screenshot({ path: `${out}/${shot.name}.png` });
    metrics[shot.name] = await page.evaluate('wwm.engine().stats()');
    console.log(shot.name, JSON.stringify(metrics[shot.name]));
  } catch (e) {
    console.error(shot.name, 'FAILED', e);
  }
  if (logs.length) console.log(`  console (${logs.length}):`, logs.slice(0, 8).join('\n  '));
  await page.close();
}
writeFileSync(`${out}/metrics.json`, JSON.stringify(metrics, null, 2));
await browser.close();
