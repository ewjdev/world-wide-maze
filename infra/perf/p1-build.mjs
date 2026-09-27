/** Opt-in production audit build + source/served-asset binding. Does not alter the game bundle or deploy. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtimeFingerprint } from './p1-fingerprint.mjs';

const digest = (data) => createHash('sha256').update(data).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));
export function assetManifest(directory) {
  const visit = (relative = '') =>
    readdirSync(resolve(directory, relative), { withFileTypes: true }).flatMap((entry) => {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return visit(path);
      if (path === 'performance-build.json') return [];
      const data = readFileSync(resolve(directory, path));
      return [{ path, bytes: data.byteLength, sha256: digest(data) }];
    });
  return visit().sort((a, b) => a.path.localeCompare(b.path));
}

export async function verifyServedBuild(base, expected = runtimeFingerprint()) {
  const origin = new URL(base.endsWith('/') ? base : `${base}/`);
  const response = await fetch(new URL('performance-build.json', origin), { cache: 'no-store' });
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json'))
    throw new Error('Audit build manifest missing: run node infra/perf/p1-build.mjs and serve that dist.');
  const manifest = await response.json();
  if (
    manifest.schemaVersion !== 1 ||
    manifest.runtimeFingerprint?.sha256 !== expected.sha256 ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length === 0
  )
    throw new Error('Served build does not match current runtime source; rebuild before measuring.');
  if (
    !manifest.assets.some((asset) => asset.path === 'index.html') ||
    !manifest.assets.some((asset) => asset.path.endsWith('.js'))
  )
    throw new Error('Audit manifest lacks entry HTML or JavaScript assets.');
  // Node fetch has a separate cache from the measured browser. Verify bytes before timed windows.
  for (const asset of manifest.assets) {
    if (typeof asset.path !== 'string' || asset.path.startsWith('/') || asset.path.split('/').includes('..'))
      throw new Error('Invalid audit asset path');
    const response = await fetch(new URL(asset.path, origin), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Missing served asset: ${asset.path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== asset.bytes || digest(bytes) !== asset.sha256)
      throw new Error(`Served asset differs from measured build: ${asset.path}`);
  }
  return {
    verified: true,
    verifiedAt: new Date().toISOString(),
    manifestSHA256: digest(JSON.stringify(manifest)),
    ...manifest,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const before = runtimeFingerprint(root);
  execFileSync('pnpm', ['--filter', '@wwm/web', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_TELEMETRY_URL: '' },
  });
  const after = runtimeFingerprint(root);
  if (before.sha256 !== after.sha256)
    throw new Error('Runtime source changed during build; refusing audit manifest.');
  const dist = resolve(root, 'apps/web/dist');
  const manifest = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    runtimeFingerprint: after,
    assets: assetManifest(dist),
  };
  writeFileSync(resolve(dist, 'performance-build.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Audit build bound to runtime ${after.sha256}, ${manifest.assets.length} assets.`);
}
