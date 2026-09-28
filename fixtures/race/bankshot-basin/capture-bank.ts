import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '../../../tools/fixture-capture/node_modules/playwright/index.mjs';

const dir = import.meta.dirname;
const read = async (f) => JSON.parse(await readFile(`${dir}/${f}`, 'utf8'));
const c = await read('course.json'),
  trace = await read('route-2-trace.json'),
  { inputs } = await read('route-2-inputs.json');
const br = c.stage.bridges.find((b) => b.bank),
  p = br.a.map((v, i) => (0.25 * v + 0.5 * br.control[i] + 0.25 * br.b[i]) / 13.5);
let best = 0,
  dist = Infinity;
trace.ticks.forEach((t, i) => {
  const d = Math.hypot(t[0] - p[0], t[2] - p[1]);
  if (d < dist) {
    dist = d;
    best = i;
  }
});
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.routeWebSocket(
    (u) => u.host === '127.0.0.1:5214',
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
  await page.goto('http://127.0.0.1:5214/race/bankshot-basin', { waitUntil: 'networkidle' });
  await page.getByTestId('race-start').click();
  await page.waitForFunction(
    (t) => {
      const s = window.__wwmRace?.debugState();
      if (s?.tick >= t) {
        window.__WWM_RACE_TEST__.timeScale = 0;
        return true;
      }
      return false;
    },
    best,
    { timeout: 180000, polling: 'raf' },
  );
  const state = await page.evaluate(() => window.__wwmRace.debugState());
  if (state.courseId !== c.courseId) throw Error('stale');
  await page.screenshot({ path: `${dir}/screenshots/route-2-bank.png`, timeout: 120000 });
  await writeFile(
    `${dir}/bank-browser-validation.json`,
    JSON.stringify(
      {
        courseId: c.courseId,
        tick: state.tick,
        screenshot: 'screenshots/route-2-bank.png',
        evidence: 'Real recorded inputs at middle of banked connector; full route verified separately.',
      },
      null,
      2,
    ),
  );
  console.log('BANK SHOT', state.tick, best, dist);
} finally {
  await browser.close();
}
