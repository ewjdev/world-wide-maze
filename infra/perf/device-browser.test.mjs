/** Opt-in browser smoke only. Requires p1-build and an exclusive host slot. Never physical acceptance. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { validateDevice } from './device-data.mjs';
import { createDeviceServer } from './device-server.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
test('portable collector exports real frame/resource data and restores hooks without longtask support', {
  timeout: 60000,
}, async () => {
  const { server, provenance } = createDeviceServer();
  let browser;
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'],
    });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'wwm.device.capture',
        JSON.stringify({
          operator: 'Automated collector smoke',
          deviceModel: 'Automation - not physical acceptance',
          osVersion: 'host',
          browserVersion: 'Playwright Chromium',
          execution: 'automated',
          role: 'desktop-game',
          scenario: 'title',
          durationSeconds: 5,
          inputProtocol: 'Title warm idle',
          powerMode: 'unknown',
          cacheState: 'warm',
          network: 'loopback',
          physicalEvidence: '',
        }),
      );
      Object.defineProperty(PerformanceObserver, 'supportedEntryTypes', { value: [] });
    });
    await page.goto(`${origin}/?offline=1`);
    await page.waitForFunction(() => window.__wwmGame?.engine?.stats().backend && window.__wwmDeviceCapture);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const task = async () =>
      (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'TaskDuration').value;
    const before = await task();
    await page.waitForTimeout(5000);
    const baselineTaskMs = ((await task()) - before) * 1000;
    const captureStart = await task();
    await page.evaluate(() => {
      window.originalFrame = window.__wwmGame.engine.frame;
      return window.__wwmDeviceCapture.start();
    });
    await page.waitForFunction(() => window.__wwmDeviceCapture.report()?.stoppedAt, {}, { timeout: 15000 });
    const report = await page.evaluate(() => window.__wwmDeviceCapture.report());
    const captureTaskMs = ((await task()) - captureStart) * 1000;
    const overhead = {
      baselineTaskMs,
      captureTaskMs,
      note: 'Single sequential five-second title windows on headless Chromium; capture includes endpoint serialization. Diagnostic only, not accepted overhead budget or GPU/physical evidence.',
    };
    assert.ok(report.engineFrames.length >= 150);
    assert.ok(report.browserFrames.length >= 90);
    assert.ok(report.snapshots.length >= 5);
    assert.equal(report.longTasks, null);
    assert.equal(report.unavailable.gpuUtilization, null);
    assert.deepEqual(report.errors, []);
    assert.equal(await page.evaluate(() => window.originalFrame === window.__wwmGame.engine.frame), true);
    const checked = validateDevice(report, {
      runtimeSHA256: provenance.runtimeSHA256,
      collectorSHA256: provenance.collectorSHA256,
      assetManifestSHA256: provenance.assetManifestSHA256,
    });
    assert.deepEqual(checked.invalid, []);
    assert.equal(checked.status, 'incomplete');
    assert.ok(checked.missing.some((x) => x.includes('Physical-device run')));
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^wwm-device-/);
    const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.deepEqual(exported.engineFrames, report.engineFrames);
    assert.deepEqual(exported.provenance, report.provenance);
    assert.equal(exported.environment.path, '/');
    if (process.env.DEVICE_SMOKE_OUT)
      writeFileSync(
        process.env.DEVICE_SMOKE_OUT,
        JSON.stringify({ report, validation: checked, overhead }, null, 2),
      );
    console.log(
      JSON.stringify({
        overhead,
        engineFrames: report.engineFrames.length / 5,
        browserFrames: report.browserFrames.length / 3,
        snapshots: report.snapshots.length,
        status: checked.status,
        runtime: provenance.runtimeSHA256,
      }),
    );
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
});
