#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateStaticPreviewConfig(config) {
  const allowed = new Set([
    '$schema',
    'name',
    'main',
    'compatibility_date',
    'workers_dev',
    'preview_urls',
    'limits',
    'assets',
  ]);
  for (const key of Object.keys(config)) assert(allowed.has(key), `Static preview forbids ${key}`);
  assert.match(config.name, /^wwm-preview-[a-z0-9-]+$/);
  assert.equal(config.main, 'src/static-preview.ts');
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.limits, { cpu_ms: 10 });
  assert.deepEqual(config.assets, {
    directory: '../web/dist',
    binding: 'ASSETS',
    not_found_handling: 'single-page-application',
    run_worker_first: true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateStaticPreviewConfig(
    JSON.parse(
      readFileSync(new URL('../../apps/worker/wrangler.static-preview.json', import.meta.url), 'utf8'),
    ),
  );
  console.log('static preview: assets only, all dynamic paths blocked, no production bindings');
}
