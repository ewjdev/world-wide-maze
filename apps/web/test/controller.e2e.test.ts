/**
 * Browser end-to-end test for pairing + the phone controller, against a running dev stack:
 *
 *   pnpm dev                                   # web :5173 (+ /api proxy) and worker :8787
 *   WWM_E2E_BASE=http://localhost:5173 pnpm vitest run --project @wwm/web controller.e2e
 *
 * A desktop context opens `/dev/input` (host). An emulated iPhone context opens `/c/<code>` with iOS's
 * `DeviceOrientationEvent.requestPermission` stubbed and synthetic `deviceorientation` events at 60 Hz,
 * then walks: enable → calibrate → POWER/JUMP/MENU → tilt → lock/unlock → host disconnect. Contracts v0.2.7:
 * the phone opens the QR link (`/c/<code>#p=<pairToken>`), and a second phone that only types the code is
 * refused (4401) without disturbing the paired one.
 * Skipped unless WWM_E2E_BASE is set (and Playwright's Chromium is installed). Set WWM_E2E_SHOTS=<dir>
 * to save screenshots.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const BASE = process.env.WWM_E2E_BASE;
const SHOTS = process.env.WWM_E2E_SHOTS;

type PW = typeof import('playwright');
let pw: PW | null = null;
try {
  pw = BASE ? await import('playwright') : null;
} catch {
  pw = null;
}

const run = BASE && pw ? describe : describe.skip;

run('controller e2e (simulated phone)', () => {
  // biome-ignore lint/suspicious/noExplicitAny: Playwright types are loaded dynamically.
  let browser: any;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  let host: any;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  let phone: any;
  let code = '';
  let pairLink = '';
  const errors: string[] = [];

  const shot = async (page: { screenshot(o: { path: string }): Promise<unknown> }, name: string) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  };
  const stat = async (id: string) => (await host.getByTestId(`stat-${id}`).textContent()) as string;

  beforeAll(async () => {
    if (!pw) return;
    browser = await pw.chromium.launch();
    const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    host = await desk.newPage();
    host.on('pageerror', (e: Error) => errors.push(`host: ${e.message}`));
    await host.goto(`${BASE}/dev/input`);
    await host.getByTestId('pair-code').waitFor();
    code = ((await host.getByTestId('pair-code').textContent()) as string).replace(/\s/g, '');

    const iphone = { ...pw.devices['iPhone 15 Pro'] };
    const ctx = await browser.newContext({ ...iphone, defaultBrowserType: undefined });
    await ctx.addInitScript(() => {
      // Emulate iOS: a permission prompt that resolves 'granted', and a 60 Hz sensor we can steer.
      const w = window as unknown as Record<string, unknown>;
      const DOE = (w.DeviceOrientationEvent ?? function DeviceOrientationEvent() {}) as Record<
        string,
        unknown
      >;
      DOE.requestPermission = () => Promise.resolve((w.__permission as string) ?? 'granted');
      w.__pose = { beta: 45, gamma: 0 };
      setInterval(() => {
        const p = w.__pose as { beta: number; gamma: number; jitter?: number } | null;
        if (!p) return;
        const j = p.jitter ?? 0.2;
        const ev = new Event('deviceorientation') as Event & Record<string, number>;
        Object.assign(ev, {
          alpha: 0,
          beta: p.beta + (Math.random() - 0.5) * j,
          gamma: p.gamma + (Math.random() - 0.5) * j,
        });
        window.dispatchEvent(ev);
      }, 16);
    });
    phone = await ctx.newPage();
    phone.on('pageerror', (e: Error) => errors.push(`phone: ${e.message}`));
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  test('pairing panel shows a QR for /c/<code>#p=<pairToken>', async () => {
    expect(code).toMatch(/^\d{6}$/);
    pairLink = ((await host.getByTestId('pair-qr').getAttribute('data-text')) as string) ?? '';
    expect(pairLink).toMatch(new RegExp(`^${BASE}/c/${code}#p=[A-Za-z0-9_-]{22}$`));
    await shot(host, '01-host-pairing');
  });

  test('phone connects with the QR link; host sees it; the token leaves the address bar', async () => {
    await phone.goto(pairLink);
    await phone.getByTestId('enable-tilt').waitFor();
    await host.getByText('Connected!').waitFor();
    expect(phone.url()).toBe(`${BASE}/c/${code}`);
    const stored = await phone.evaluate((c: string) => sessionStorage.getItem(`wwm.pair.${c}`), code);
    expect(pairLink.endsWith(`#p=${stored}`)).toBe(true);
    await shot(phone, '02-phone-enable');
  });

  test('enable tilt → calibrate by holding steady → play; host receives calibrated', async () => {
    await phone.getByTestId('enable-tilt').tap();
    await phone.locator('[data-screen="play"]').waitFor({ timeout: 5000 });
    await expect.poll(() => stat('calibrated'), { timeout: 10_000 }).toBe('1');
    await shot(phone, '03-phone-play');
  });

  test('60 Hz input stream with RTT; POWER / JUMP / MENU arrive', async () => {
    await expect
      .poll(async () => Number.parseInt(await stat('rate'), 10), { timeout: 5000 })
      .toBeGreaterThan(40);
    await expect.poll(() => stat('rtt'), { timeout: 5000 }).toMatch(/^\d/);
    const press = async (name: string, holdMs: number) => {
      const b = phone.getByTestId(`btn-${name}`);
      await b.dispatchEvent('pointerdown', { pointerId: 7, isPrimary: true, pointerType: 'touch' });
      await phone.waitForTimeout(holdMs);
      await b.dispatchEvent('pointerup', { pointerId: 7, isPrimary: true, pointerType: 'touch' });
    };
    await press('power', 300);
    await press('jump', 60);
    await press('menu', 60);
    await expect.poll(() => stat('presses'), { timeout: 10_000 }).toBe('1 / 1 / 1');
    const log = (await host.getByTestId('event-log').textContent()) as string;
    expect(log).toContain('phone: MENU');
  });

  test('ATTACK: a second phone typing the code is refused; the paired phone keeps control', async () => {
    const drops = async () =>
      ((await host.getByTestId('event-log').textContent()) as string).split('phone: disconnected').length;
    const dropsBefore = await drops(); // dev StrictMode may have logged one at pairing (known, polish backlog)
    const ctx = await browser.newContext({ ...pw?.devices['iPhone 15 Pro'] });
    const intruder = await ctx.newPage();
    intruder.on('pageerror', (e: Error) => errors.push(`intruder: ${e.message}`));
    // Typed code: no token.
    await intruder.goto(`${BASE}/c/${code}`);
    await intruder.getByTestId('unauthorized').waitFor({ timeout: 5000 });
    await shot(intruder, '02b-intruder-refused');
    // A made-up token.
    await intruder.goto(`${BASE}/c/${code}#p=${'A'.repeat(22)}`);
    await intruder.getByTestId('unauthorized').waitFor({ timeout: 5000 });
    await ctx.close();
    // The paired phone was never replaced and its stream never stopped.
    expect(await phone.locator('[data-screen="play"]').count()).toBe(1);
    await expect
      .poll(async () => Number.parseInt(await stat('rate'), 10), { timeout: 3000 })
      .toBeGreaterThan(40);
    expect(await drops()).toBe(dropsBefore);
  });

  test('tilt maps to calibrated, clamped radians; "Too tilted!" beyond the limit', async () => {
    // 10° forward (top edge away) and 8° right.
    await phone.evaluate(() => {
      (window as unknown as { __pose: unknown }).__pose = { beta: 35, gamma: 8, jitter: 0 };
    });
    await expect
      .poll(async () => (await stat('raw')).replace(/\s/g, ''), { timeout: 3000 })
      .toMatch(/^[78]\.\d°,(9\.\d|10\.\d)°$/);
    await phone.evaluate(() => {
      (window as unknown as { __pose: unknown }).__pose = { beta: 45, gamma: 35, jitter: 0 };
    });
    await phone.getByText('Too tilted!').waitFor({ timeout: 3000 });
    await expect.poll(() => stat('raw'), { timeout: 10_000 }).toMatch(/^20\.0°/);
    await shot(phone, '04-phone-too-tilted');
    await phone.evaluate(() => {
      (window as unknown as { __pose: unknown }).__pose = { beta: 45, gamma: 0, jitter: 0.2 };
    });
  });

  test('lock/unlock: stream stops (host goes stale) and resumes on visible', async () => {
    const cdp = await phone.context().newCDPSession(phone);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    // Simulate the page being hidden (phone locked): Playwright can't lock, so fake visibility.
    await phone.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => stat('stale'), { timeout: 3000 }).toMatch(/yes/);
    // Silence (not just a socket close) counts as a disconnect, so the game can auto-pause.
    await expect
      .poll(async () => (await host.getByTestId('event-log').textContent()) as string, { timeout: 4000 })
      .toContain('phone: disconnected');
    await phone.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => stat('stale'), { timeout: 3000 }).toBe('no');
  });

  test('phone reload keeps calibration (first game only) and re-pairs', async () => {
    await phone.reload();
    await phone.getByTestId('enable-tilt').tap();
    await phone.locator('[data-screen="play"]').waitFor({ timeout: 5000 });
    await expect.poll(() => stat('calibrated'), { timeout: 10_000 }).toBe('2');
  });

  test('host disconnect shows a clear waiting state on the phone', async () => {
    const hostCtx = host.context();
    // v0.2.7: the host needs its token to rejoin. A new tab has no sessionStorage, so pass it in the fragment.
    const saved = JSON.parse(
      (await host.evaluate((c: string) => sessionStorage.getItem(`wwm.room.${c}`), code)) as string,
    ) as { hostToken: string; pairToken: string };
    await host.close();
    await phone.getByTestId('host-waiting').waitFor({ timeout: 5000 });
    await shot(phone, '05-phone-host-left');
    host = await hostCtx.newPage();
    await host.goto(`${BASE}/dev/input?code=${code}#h=${saved.hostToken}&p=${saved.pairToken}`);
    await expect.poll(async () => phone.getByTestId('host-waiting').count(), { timeout: 5000 }).toBe(0);
  });

  test('denied permission and unknown code show fallback states', async () => {
    const ctx = await browser.newContext({ ...pw?.devices['iPhone 15 Pro'] });
    await ctx.addInitScript(() => {
      const DOE = (window as unknown as Record<string, Record<string, unknown>>).DeviceOrientationEvent;
      if (DOE) DOE.requestPermission = () => Promise.resolve('denied');
    });
    const p = await ctx.newPage();
    await p.goto(pairLink); // with the pair token (replaces the first phone, which is done by now)
    await p.getByTestId('enable-tilt').tap();
    await p.getByTestId('fallback').waitFor();
    expect(await p.getByTestId('fallback').textContent()).toContain('keyboard');
    await shot(p, '06-phone-denied');
    await p.goto(`${BASE}/c/100000`);
    await p.getByTestId('code-entry').waitFor();
    await shot(p, '07-phone-unknown-code');
    await ctx.close();
  });

  test('no page errors', () => {
    expect(errors.join('\n')).toBe('');
  });
});
