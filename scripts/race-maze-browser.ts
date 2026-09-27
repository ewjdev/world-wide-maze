import { existsSync } from 'node:fs';
/** Browser replays only the inputs already validated in Rapier; captures playable UI evidence. */
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RaceSession, RaceTestHooks } from '../apps/web/src/race/session.ts';
import { compatible, makeCompatibility } from '../packages/race/src/index.ts';
import { chromium } from '../tools/fixture-capture/node_modules/playwright/index.mjs';
import type { MazeRoutePoints } from './race-maze-policy.ts';

declare const window: { __WWM_RACE_TEST__: RaceTestHooks; __wwmRace: RaceSession };

const root = resolve(import.meta.dirname, '..');
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const requestedSlug = arg('--slug');
const requestedRoute = arg('--route');
const baseUrl = arg('--base-url') ?? 'http://127.0.0.1:5200';
const fixtures = resolve(root, 'fixtures/race');
const slugs = requestedSlug
  ? [requestedSlug]
  : (await readdir(fixtures, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(resolve(fixtures, entry.name, 'course.json')) &&
          !['flow-sprint', 'switchback', 'longline', 'island-leap'].includes(entry.name),
      )
      .map((entry) => entry.name);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  for (const slug of slugs) {
    const dir = resolve(fixtures, slug);
    const classic = ['flow-sprint', 'switchback', 'longline'].includes(slug);
    const route =
      requestedRoute ??
      (classic
        ? 'solver'
        : slug === 'island-leap'
          ? 'safe'
          : (JSON.parse(await readFile(resolve(dir, 'route-points.json'), 'utf8')) as MazeRoutePoints)
              .defaultRoute);
    const inputData = JSON.parse(await readFile(resolve(dir, `${route}-inputs.json`), 'utf8'));
    const validation = JSON.parse(
      await readFile(
        resolve(dir, route === 'solver' ? 'race-validation.json' : `${route}-validation.json`),
        'utf8',
      ),
    );
    const course = JSON.parse(await readFile(resolve(dir, 'course.json'), 'utf8'));
    const compatibility = makeCompatibility(course.courseId, !!course.stunts, course.physicsProfile);
    if (
      course.physicsProfile &&
      (!validation.compatibility || !compatible(validation.compatibility, compatibility))
    )
      throw new Error(`${slug}/${route}: headless proof uses a stale or missing physics profile`);
    const trace = JSON.parse(await readFile(resolve(dir, `${route}-trace.json`), 'utf8'));
    const shots = resolve(dir, 'screenshots');
    await mkdir(shots, { recursive: true });
    const pendingShots = await mkdtemp(resolve(shots, `.${route}-`));
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    const errors: string[] = [];
    const page = await context.newPage();
    // Keep a replay on its initially loaded code while other course agents regenerate the catalog.
    // Race is local-only here; swallowing Vite's same-host HMR socket prevents a mid-run reload.
    await page.routeWebSocket(
      (url: URL) => url.host === new URL(baseUrl).host,
      () => {},
    );
    page.on('pageerror', (error) => errors.push(String(error)));
    const quality = arg('--quality') === 'low' ? 'low' : 'high';
    await page.addInitScript(
      ({ inputs, quality }) => {
        window.__WWM_RACE_TEST__ = {
          inputs,
          countdownSec: 0.01,
          noAutoPause: true,
          quality,
          timeScale: 3,
        };
      },
      { ...inputData, quality },
    );
    try {
      await page.goto(`${baseUrl}/race/${slug}`, { waitUntil: 'networkidle' });
      if (!(await page.locator('script[src="/@vite/client"]').count()))
        throw new Error(
          'Recorded-input browser verification requires the Vite dev server; production disables test input hooks.',
        );
      await page.getByTestId('race-start').waitFor({ timeout: 30000 });
      await page.screenshot({ timeout: 120000, path: resolve(pendingShots, `${route}-ready.png`) });
      await page.getByTestId('race-start').click();
      const featureEvent = validation.events.find(
        (event: { mechanic: string; tick: number }) => event.mechanic === 'launch',
      );
      const captures = [
        { label: 'midrun', tick: Math.floor(validation.progress.finishTick * 0.4) },
        {
          label: 'feature',
          tick: featureEvent ? featureEvent.tick + 20 : Math.floor(validation.progress.finishTick * 0.7),
        },
      ].sort((a, b) => a.tick - b.tick);
      for (const capture of captures) {
        await page.waitForFunction(
          (tick: number) => {
            const state = window.__wwmRace?.debugState();
            if (state?.phase === 'error') throw new Error(state.error);
            if (state?.tick >= tick) {
              window.__WWM_RACE_TEST__.timeScale = 0;
              return true;
            }
            return false;
          },
          capture.tick,
          { timeout: 300000, polling: 'raf' },
        );
        await page.screenshot({
          timeout: 120000,
          path: resolve(pendingShots, `${route}-${capture.label}.png`),
        });
        await page.evaluate(() => {
          window.__WWM_RACE_TEST__.timeScale = 3;
        });
      }
      await page.getByTestId('race-finished').waitFor({ timeout: 300000 });
      await page.screenshot({ timeout: 120000, path: resolve(pendingShots, `${route}-finish.png`) });
      const state = await page.evaluate(() => window.__wwmRace.debugState());
      if (state.courseId !== validation.courseId)
        throw new Error(`Browser loaded stale course: ${state.courseId}`);
      if (JSON.stringify(state.progress) !== JSON.stringify(validation.progress))
        throw new Error(`Browser progress mismatch: ${JSON.stringify(state.progress)}`);
      if (JSON.stringify(state.mechanics) !== JSON.stringify(validation.mechanics))
        throw new Error(`Browser mechanics mismatch: ${JSON.stringify(state.mechanics)}`);
      const final = trace.ticks.at(-1);
      const maxPoseError = Math.max(
        ...state.ball.pos.map((position: number, axis: number) => Math.abs(position - final[axis])),
      );
      if (maxPoseError > 0.00001) throw new Error(`Browser final pose mismatch: ${maxPoseError}`);
      if (errors.length) throw new Error(errors.join('\n'));
      for (const label of ['ready', 'midrun', 'feature', 'finish']) {
        const file = `${route}-${label}.png`;
        await rename(resolve(pendingShots, file), resolve(shots, file));
      }
      await writeFile(
        resolve(dir, `${route}-browser-validation.json`),
        JSON.stringify(
          {
            courseId: state.courseId,
            compatibility,
            route,
            renderingQuality: quality,
            url: `${baseUrl}/race/${slug}`,
            progress: state.progress,
            mechanics: state.mechanics,
            maxPoseError,
            pageErrors: errors,
            screenshots: ['ready', 'midrun', 'feature', 'finish'].map(
              (label) => `screenshots/${route}-${label}.png`,
            ),
            evidence:
              'Same recorded ordinary inputs in the playable browser; finish progress and final physics pose compared to the Node Rapier run. Screenshots are evidence of rendering, not independent human playtesting.',
          },
          null,
          2,
        ),
      );
      console.log(
        `${slug}/${route}: browser finish ${state.progress.finishTick / 120}s, pose error ${maxPoseError}, 4 screenshots`,
      );
    } finally {
      await context.close();
      await rm(pendingShots, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
