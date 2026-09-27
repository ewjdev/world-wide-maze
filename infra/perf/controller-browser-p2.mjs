// Real ControllerPage smoke, mocked relay/sensors; does not certify a physical phone.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const { createServer } = require('vite');
let server;
let browser;
let page;
const errors = [];
try {
  server = await createServer({
    root: fileURLToPath(new URL('../../apps/web', import.meta.url)),
    server: { port: 4323, strictPort: true },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));
  await page.addInitScript(() => {
    window.__wire = [];
    window.__sockets = [];
    const NativeWebSocket = window.WebSocket;
    class MockSocket {
      readyState = 0;
      bufferedAmount = 0;
      binaryType = 'arraybuffer';
      onopen = null;
      onmessage = null;
      onclose = null;
      constructor() {
        window.__sockets.push(this);
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.({});
          this.msg({ t: 'peer', role: 'host', connected: true });
        }, 20);
      }
      msg(data) {
        this.onmessage?.({ data: JSON.stringify(data) });
      }
      send(data) {
        if (data instanceof ArrayBuffer)
          window.__wire.push({ at: performance.now(), bytes: [...new Uint8Array(data)] });
        else {
          const m = JSON.parse(data);
          if (m.t === 'ping') this.msg({ ...m, t: 'pong' });
        }
      }
      close() {
        this.readyState = 3;
      }
      drop() {
        this.readyState = 3;
        this.onclose?.({ code: 1006, reason: 'probe' });
      }
    }
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(Target, args) {
        return String(args[0]).includes('/api/rooms/') ? new MockSocket() : Reflect.construct(Target, args);
      },
    });
    window.DeviceOrientationEvent = { requestPermission: async () => 'granted' };
    window.__pose = { beta: 45, gamma: 0 };
    setInterval(() => {
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, ...window.__pose }));
    }, 1000 / 120);
    HTMLElement.prototype.requestFullscreen = async () => {};
  });
  await page.goto('http://localhost:4323/c/123456');
  await page.getByTestId('enable-tilt').click();
  await page.waitForFunction(() => window.__wwmController?.getView().screen === 'play');
  await page.evaluate(() => {
    window.__publications = 0;
    window.__wwmController.subscribe(() => window.__publications++);
    window.__pose = { beta: 50, gamma: 8 };
  });
  await page.waitForTimeout(1100);
  const before = await page.evaluate(() => ({
    diag: window.__wwmController.diag(),
    publications: window.__publications,
  }));
  await page.getByTestId('btn-power').dispatchEvent('pointerdown', { pointerId: 1 });
  assert.equal(await page.evaluate(() => window.__wwmController.getView().buttons.power), true);
  await page.getByTestId('btn-power').dispatchEvent('pointerup', { pointerId: 1 });
  assert.equal(await page.evaluate(() => window.__wwmController.getView().buttons.power), false);
  await page.evaluate(() => {
    window.__sockets.at(-1).drop();
  });
  await page.waitForFunction(() => window.__wwmController.getView().hostConnected === false);
  await page.waitForFunction(() => window.__wwmController.getView().hostConnected === true);
  await page.evaluate(() => {
    window.__wwmController.setButton('power', true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await page.evaluate(() => ({
    buttons: window.__wwmController.getView().buttons,
    sends: window.__wire.length,
  }));
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__wire.length), hidden.sends);
  assert.equal(hidden.buttons.power, false);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100);
  assert(await page.evaluate((n) => window.__wire.length > n, hidden.sends));
  assert.deepEqual(errors, []);
  const out = process.env.AUDIT_OUT ?? 'docs/launch/evidence/controller-p2';
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: `${out}/controller.png` });
  await writeFile(
    `${out}/browser.json`,
    `${JSON.stringify({ date: new Date().toISOString(), browser: browser.version(), method: 'Headless Chromium real React ControllerPage; mock relay, synthetic120Hz orientation. Real page rAF cadence is browser-dependent. No physical phone latency/thermal evidence.', before, hidden, errors, checks: ['auto calibration', 'power edges', 'disconnect/reconnect', 'hidden releases and suspends sends', 'visible resumes sends'] }, null, 2)}\n`,
  );
  console.log('ControllerPage smoke passed');
} catch (error) {
  console.error(
    JSON.stringify({
      errors,
      body: await page
        ?.locator('body')
        .innerText()
        .catch(() => ''),
    }),
  );
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
