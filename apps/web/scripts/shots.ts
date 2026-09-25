/**
 * Walk every game screen with a simulated phone and save screenshots (Phase 08 evidence).
 *
 *   node apps/web/scripts/shots.ts <baseUrl> <outDir> [--only name,name]
 *
 * Needs a running web dev server whose /api reaches a worker (rooms). Uses the real GPU (Metal ANGLE).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, chromium, devices, type Page } from 'playwright';

const [base = 'http://localhost:5173', out = 'docs/build-log/assets/phase-08'] = process.argv.slice(2);
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? new Set((process.argv[onlyArg + 1] ?? '').split(',')) : null;
mkdirSync(out, { recursive: true });

const GPU = ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'];
const errors: string[] = [];

async function shot(page: Page, name: string) {
  if (only && !only.has(name)) return;
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 84 });
  console.log(`  ${name}.jpg`);
}

function watch(page: Page, who: string) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${who} [${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${who} [pageerror] ${e.message}`));
}

const phase = (page: Page) => page.evaluate(() => document.body.dataset.phase ?? 'title');
async function waitPhase(page: Page, p: string, timeout = 60_000) {
  await page.waitForFunction((want) => document.body.dataset.phase === want, p, { timeout });
}

async function phonePage(browser: Browser, url: string): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
  await ctx.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const DOE = (w.DeviceOrientationEvent ?? function DeviceOrientationEvent() {}) as Record<string, unknown>;
    DOE.requestPermission = () => Promise.resolve('granted');
    w.__pose = { beta: 45, gamma: 0, jitter: 0.2 };
    setInterval(() => {
      const p = w.__pose as { beta: number; gamma: number; jitter: number } | null;
      if (!p) return;
      const ev = new Event('deviceorientation') as Event & Record<string, number>;
      Object.assign(ev, {
        alpha: 0,
        beta: p.beta + (Math.random() - 0.5) * p.jitter,
        gamma: p.gamma + (Math.random() - 0.5) * p.jitter,
      });
      window.dispatchEvent(ev);
    }, 16);
  });
  const page = await ctx.newPage();
  watch(page, 'phone');
  await page.goto(url);
  return page;
}

const browser = await chromium.launch({ headless: true, args: GPU });
try {
  // ── session 1: title → how-to → pairing → calibrate → select → building → intro → play → map ──
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desk.addInitScript(() => {
    (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = { noAutoPause: true };
  });
  const host = await desk.newPage();
  watch(host, 'host');
  await host.goto(`${base}/`);
  await host.getByTestId('start').waitFor();
  await host.waitForFunction(
    () => !(document.querySelector('[data-testid=start]') as HTMLButtonElement).disabled,
  );
  await host.waitForTimeout(6000);
  console.log('title');
  await shot(host, '01-title');
  await host.getByTestId('start').click();
  await waitPhase(host, 'howto');
  await host.waitForTimeout(700);
  await shot(host, '02-howto');
  await host.getByTestId('howto-go').click();
  await waitPhase(host, 'pairing');
  await host.getByTestId('pair-code').waitFor();
  await host.waitForTimeout(600);
  await shot(host, '03-pairing');
  const code = ((await host.getByTestId('pair-code').textContent()) ?? '').replace(/\s/g, '');

  // phone joins with a shaky pose so calibration waits (for the screenshot)
  const phone = await phonePage(browser, `${base}/c/${code}`);
  await phone.evaluate(() => {
    (window as unknown as { __pose: unknown }).__pose = { beta: 20, gamma: 14, jitter: 9 };
  });
  await host.getByText('Connected!').waitFor();
  await shot(host, '04-connected');
  await waitPhase(host, 'calibrate');
  await phone.getByTestId('enable-tilt').tap();
  await host.waitForTimeout(1500);
  await shot(host, '05-calibrate');
  await phone.evaluate(() => {
    (window as unknown as { __pose: unknown }).__pose = { beta: 45, gamma: 0, jitter: 0.2 };
  });
  await waitPhase(host, 'select', 20_000);
  await host.waitForTimeout(1200);
  await shot(host, '06-select');
  await phone.screenshot({ path: join(out, 'phone-01-select.jpg'), type: 'jpeg', quality: 84 });

  await host.getByTestId('site-fixture-hn-front').click();
  await waitPhase(host, 'building');
  await host.waitForTimeout(700);
  await shot(host, '07-building');
  await waitPhase(host, 'intro');
  await host.waitForTimeout(2600);
  await shot(host, '08-intro-fold');
  await host.waitForTimeout(8000);
  await shot(host, '09-intro-flyover');
  await host.getByTestId('intro-skip').click();
  await waitPhase(host, 'play', 20_000);
  await host.waitForTimeout(800);
  await shot(host, '10-play-tutorial');
  // hold POWER on the phone and tilt forward for a moment
  await phone.evaluate(() => {
    (window as unknown as { __pose: unknown }).__pose = { beta: 30, gamma: 6, jitter: 0.2 };
  });
  const power = phone.getByTestId('btn-power');
  await power.dispatchEvent('pointerdown', { pointerId: 3, isPrimary: true, pointerType: 'touch' });
  await host.waitForTimeout(1800);
  await shot(host, '11-play-power');
  await power.dispatchEvent('pointerup', { pointerId: 3, isPrimary: true, pointerType: 'touch' });
  await phone.screenshot({ path: join(out, 'phone-02-play.jpg'), type: 'jpeg', quality: 84 });
  await host.waitForTimeout(8000);
  await shot(host, '12-play-hud');

  await host.keyboard.press('KeyM');
  await waitPhase(host, 'paused');
  await host.waitForTimeout(1500);
  await shot(host, '13-map');
  await host.getByTestId('map-quit').click();
  await host.waitForTimeout(400);
  await shot(host, '14-map-confirm');
  await host.keyboard.press('Escape');
  await host.getByTestId('map-back').click();
  await waitPhase(host, 'play');

  // lock the phone: hidden page → silence → host freezes
  await phone.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await host.getByTestId('disconnect-overlay').waitFor({ timeout: 6000 });
  await host.waitForTimeout(500);
  await shot(host, '15-disconnect');
  await phone.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await host.getByTestId('disconnect-overlay').waitFor({ state: 'detached', timeout: 6000 });

  // time up → TIME IS UP sign
  await host.evaluate(() => window.__wwmGame?.debugSetTimeLeft(2));
  await waitPhase(host, 'timeup', 10_000);
  await host.waitForTimeout(900);
  await shot(host, '16-timeup');
  await waitPhase(host, 'play', 20_000);
  await host.waitForTimeout(400);
  await shot(host, '17-play-after-restart');
  await desk.close();
  await phone.context().close();

  // ── session 2: replay run on the practice stage → goal → result → ranking ──
  const replay = JSON.parse(
    readFileSync(new URL('../../../fixtures/replays/handmade-simple.keyboard.json', import.meta.url), 'utf8'),
  );
  const desk2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desk2.addInitScript((r) => {
    localStorage.setItem('wwm.howtoSeen', '1');
    localStorage.setItem('wwm.tutorialDone', '1');
    (window as unknown as { __WWM_TEST__: unknown }).__WWM_TEST__ = {
      replay: r,
      lockstep: true,
      noAutoPause: true,
      timeScale: 2,
    };
  }, replay);
  const p2 = await desk2.newPage();
  watch(p2, 'host2');
  await p2.goto(`${base}/`);
  await p2.getByTestId('start').click();
  await waitPhase(p2, 'pairing');
  await p2.getByTestId('play-keyboard').click();
  await waitPhase(p2, 'select');
  await p2.getByTestId('site-practice').click();
  await waitPhase(p2, 'intro');
  await p2.getByTestId('intro-skip').click({ force: true });
  await waitPhase(p2, 'countdown', 20_000);
  await p2.waitForTimeout(250);
  await shot(p2, '18-countdown');
  await waitPhase(p2, 'goal', 90_000);
  await p2.getByTestId('sign-goal').waitFor({ timeout: 20_000 });
  await p2.waitForTimeout(900);
  await shot(p2, '19-goal');
  await waitPhase(p2, 'result', 20_000);
  await p2.waitForTimeout(700);
  await shot(p2, '20-result-tally');
  await p2.waitForFunction(
    () => !!document.querySelector('[data-testid=res-total][data-final]:not([data-final=""])'),
  );
  await p2.waitForTimeout(500);
  await shot(p2, '21-result');
  await p2.getByTestId('res-finish').click();
  await waitPhase(p2, 'ranking');
  await p2.getByTestId('name-input').fill('party_2013');
  await p2.waitForTimeout(300);
  await shot(p2, '22-ranking');
  await p2.getByTestId('name-submit').click();
  await p2.waitForTimeout(500);
  await shot(p2, '23-ranking-submitted');

  // game over: three time-ups on a fresh run
  await p2.getByTestId('new-game').click();
  await waitPhase(p2, 'select');
  await p2.evaluate(() => {
    const w = window as unknown as { __WWM_TEST__: { replay?: unknown } };
    w.__WWM_TEST__.replay = undefined;
  });
  await p2.getByTestId('site-practice').click();
  await waitPhase(p2, 'intro');
  await p2.getByTestId('intro-skip').click({ force: true });
  for (let i = 0; i < 4; i++) {
    await waitPhase(p2, 'play', 30_000);
    await p2.evaluate(() => window.__wwmGame?.debugSetTimeLeft(1));
    await waitPhase(p2, 'timeup', 10_000);
  }
  await p2.getByTestId('sign-gameover').waitFor({ timeout: 10_000 });
  await p2.waitForTimeout(1100);
  await shot(p2, '24-gameover');
  await waitPhase(p2, 'ranking', 10_000);
  await p2.waitForTimeout(600);
  await shot(p2, '24b-ranking-after-gameover');

  // errors + language
  await p2.goto(`${base}/`);
  await p2.getByTestId('start').click();
  await waitPhase(p2, 'pairing');
  await p2.getByTestId('play-keyboard').click();
  await waitPhase(p2, 'select');
  await p2.getByTestId('url-input').fill('http://localhost/admin');
  await p2.getByTestId('url-go').click();
  await waitPhase(p2, 'error', 30_000);
  await p2.waitForTimeout(500);
  await shot(p2, '25-error');
  await p2.getByTestId('error-back').click();
  await waitPhase(p2, 'select');
  await p2.getByTestId('lang-ja').click();
  await p2.waitForTimeout(500);
  await shot(p2, '26-select-ja');
  await p2.goto(`${base}/`);
  await p2.waitForTimeout(5000);
  await shot(p2, '27-title-ja');
  await p2.getByTestId('lang-en').click();

  // narrow window
  const narrow = await browser.newContext({ viewport: { width: 820, height: 1000 } });
  const p3 = await narrow.newPage();
  watch(p3, 'narrow');
  await p3.goto(`${base}/`);
  await p3.waitForTimeout(5000);
  await shot(p3, '28-title-narrow');
  await p3.evaluate(() => localStorage.setItem('wwm.howtoSeen', '1'));
  await p3.getByTestId('start').click();
  await waitPhase(p3, 'pairing');
  await p3.getByTestId('play-keyboard').click();
  await waitPhase(p3, 'select');
  await p3.waitForTimeout(800);
  await shot(p3, '29-select-narrow');
  console.log('final phase', await phase(p3));
} finally {
  await browser.close();
  console.log(errors.length ? `console problems:\n${errors.join('\n')}` : 'no console errors or warnings');
}
