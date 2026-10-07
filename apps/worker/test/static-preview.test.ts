import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { validateStaticPreviewConfig } from '../../../infra/scripts/check-static-preview-config.mjs';
import preview from '../src/static-preview.ts';

const request = (path: string, init?: RequestInit) => new Request(`https://preview.example${path}`, init);

test('health identifies the exact preview commit without online bindings', async () => {
  const fetch = vi.fn();
  const response = await preview.fetch(request('/api/health'), {
    ASSETS: { fetch },
    PREVIEW_COMMIT: 'abc123',
  });
  expect(await response.json()).toEqual({
    ok: true,
    contract: 'static-preview',
    mode: 'static',
    commit: 'abc123',
  });
  expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(fetch).not.toHaveBeenCalled();
});

test('dynamic and socket routes cannot reach assets or consume request bodies', async () => {
  const fetch = vi.fn();
  for (const path of [
    '/api/rooms',
    '/api/admin/cost',
    '/api/stages',
    '/s/abc',
    '/r/abc',
    '/j/abc',
    '/admin',
    '/rooms/abc',
    '/ws',
  ]) {
    const req = request(path, { method: 'POST', body: '{}' });
    const response = await preview.fetch(req, { ASSETS: { fetch } });
    expect(response.status).toBe(429);
    expect(response.headers.get('x-wwm-mode')).toBe('static');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(req.bodyUsed).toBe(false);
  }
  expect(fetch).not.toHaveBeenCalled();
});

test('disabled telemetry returns empty success without processing data', async () => {
  const fetch = vi.fn();
  const req = request('/api/t', { method: 'POST', body: 'sensor-or-event-data' });
  const response = await preview.fetch(req, { ASSETS: { fetch } });
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(req.bodyUsed).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

test('HTML asset fallback preserves self-origin sensor and strict script headers', async () => {
  const fetch = vi.fn(
    async () =>
      new Response('<div id="root"></div>', {
        headers: { 'content-type': 'text/html', 'cache-control': 'max-age=0' },
      }),
  );
  const req = request('/play/practice?offline=1');
  const response = await preview.fetch(req, { ASSETS: { fetch } });
  expect(fetch).toHaveBeenCalledWith(req);
  expect(await response.text()).toContain('id="root"');
  expect(response.headers.get('permissions-policy')).toContain(
    'accelerometer=(self), gyroscope=(self), magnetometer=()',
  );
  expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(response.headers.get('cache-control')).toBe('max-age=0');
  expect(response.headers.get('x-robots-tag')).toBe('noindex');
});

test('static config rejects production names, routing and online-service bindings', () => {
  const config = JSON.parse(
    readFileSync(new URL('../wrangler.static-preview.json', import.meta.url), 'utf8'),
  );
  expect(() => validateStaticPreviewConfig(config)).not.toThrow();
  expect(() => validateStaticPreviewConfig({ ...config, name: 'wwm' })).toThrow();
  for (const key of [
    'routes',
    'd1_databases',
    'durable_objects',
    'secrets_store_secrets',
    'browser',
    'env',
    'vars',
  ]) {
    expect(() => validateStaticPreviewConfig({ ...config, [key]: [] })).toThrow();
  }
});
