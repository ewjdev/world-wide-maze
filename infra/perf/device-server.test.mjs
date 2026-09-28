import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDeviceServer } from './device-server.mjs';
import { assetManifest } from './p1-build.mjs';

const runtime = 'a'.repeat(64);
function fixture(html = '<html><head></head><body>test</body></html>') {
  const dist = mkdtempSync(join(tmpdir(), 'wwm-device-test-'));
  writeFileSync(join(dist, 'index.html'), html);
  writeFileSync(join(dist, 'main.js'), 'window.test = 1');
  writeFileSync(
    join(dist, 'performance-build.json'),
    JSON.stringify({
      schemaVersion: 1,
      commit: 'test',
      builtAt: '2026-09-27T00:00:00Z',
      runtimeFingerprint: { sha256: runtime },
      assets: assetManifest(dist),
    }),
  );
  return dist;
}
test('rejects stale source, modified asset and missing injection point', () => {
  const dist = fixture();
  try {
    assert.throws(() => createDeviceServer({ dist, expectedRuntime: 'b'.repeat(64) }), /stale/);
    writeFileSync(join(dist, 'main.js'), 'modified');
    assert.throws(() => createDeviceServer({ dist, expectedRuntime: runtime }), /assets differ/);
  } finally {
    rmSync(dist, { recursive: true });
  }
  const broken = fixture('<html>no head</html>');
  try {
    assert.throws(() => createDeviceServer({ dist: broken, expectedRuntime: runtime }), /index.html/);
  } finally {
    rmSync(broken, { recursive: true });
  }
});
test('serves pinned assets and disclosed local-only instrumentation; no API by default', async () => {
  const dist = fixture();
  const { server, provenance } = createDeviceServer({ dist, expectedRuntime: runtime });
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    writeFileSync(join(dist, 'main.js'), 'changed after snapshot');
    assert.equal(await (await fetch(`${origin}/main.js`)).text(), 'window.test = 1');
    const entry = await fetch(`${origin}/play/practice`);
    const html = await entry.text();
    assert.match(html, /device-collector.mjs/);
    assert.match(html, /analytics.preference/);
    assert.equal(entry.headers.get('cache-control'), 'no-store');
    assert.equal(await (await fetch(`${origin}/index.html`)).text(), html);
    assert.equal((await fetch(`${origin}/api/health`)).status, 503);
    assert.equal((await fetch(`${origin}/assets/missing.js`)).status, 404);
    assert.deepEqual(await (await fetch(`${origin}/__device/provenance`)).json(), provenance);
    assert.notEqual(provenance.originalHtmlSHA256, provenance.instrumentedHtmlSHA256);
    assert.equal(provenance.assetsVerified, true);
    assert.match(await (await fetch(`${origin}/__device/`)).text(), /physical-self-reported/);
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dist, { recursive: true });
  }
});

test('validator rejects an optional manifest without a source binding', async () => {
  const { validateFile } = await import('./device-validate.mjs');
  const dist = fixture();
  try {
    writeFileSync(join(dist, 'report.json'), '{}');
    writeFileSync(
      join(dist, 'invalid.json'),
      JSON.stringify({ schemaVersion: 1, assets: [{ path: 'index.html' }] }),
    );
    assert.throws(
      () => validateFile(join(dist, 'report.json'), join(dist, 'invalid.json')),
      /Invalid expected build manifest/,
    );
  } finally {
    rmSync(dist, { recursive: true });
  }
});
