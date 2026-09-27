import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '../../../tools/fixture-capture/node_modules/playwright/index.mjs';

const dir = import.meta.dirname;
const inputs = JSON.parse(await readFile(`${dir}/route-0-inputs.json`, 'utf8')).inputs;
const layer = JSON.parse(await readFile(`${dir}/layer-validation.json`, 'utf8'));
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.routeWebSocket(
    (url) => url.host === '127.0.0.1:5214',
    () => {},
  );
  await page.addInitScript(
    ({ inputs }) => {
      window.__WWM_RACE_TEST__ = {
        inputs,
        countdownSec: 0.01,
        noAutoPause: true,
        quality: 'high',
        timeScale: 3,
      };
    },
    { inputs },
  );
  await page.goto('http://127.0.0.1:5214/race/sky-weave', { waitUntil: 'networkidle' });
  await page.getByTestId('race-start').click();
  const captures = [
    { name: 'upper-crossing', tick: layer.upperNearest.tick },
    { name: 'underpass-approach', tick: layer.lowerNearest.tick - 90 },
    { name: 'underpass', tick: layer.lowerNearest.tick },
    { name: 'underpass-exit', tick: layer.lowerNearest.tick + 90 },
  ];
  const results = [];
  for (const c of captures) {
    await page.waitForFunction(
      (t) => {
        if (window.__wwmRace?.debugState().tick >= t) {
          window.__WWM_RACE_TEST__.timeScale = 0;
          return true;
        }
        return false;
      },
      c.tick,
      { timeout: 300000, polling: 'raf' },
    );
    await page.screenshot({ path: `${dir}/screenshots/route-0-${c.name}.png`, timeout: 120000 });
    const state = await page.evaluate(() => window.__wwmRace.debugState());
    if (state.courseId !== layer.courseId) throw Error('Stalecourse');
    results.push({ capture: c.name, tick: state.tick, ball: state.ball, phase: state.phase });
    await page.evaluate(() => (window.__WWM_RACE_TEST__.timeScale = 3));
  }
  await writeFile(
    `${dir}/layer-browser-validation.json`,
    `${JSON.stringify({ courseId: layer.courseId, captures: results }, null, 2)}\n`,
  );
  await context.close();
} finally {
  await browser.close();
}
