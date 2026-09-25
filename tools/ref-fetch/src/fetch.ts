// Downloads the pinned reference artifacts into <repo>/reference/ and verifies sha256.
// Idempotent: files that already exist with the right hash are skipped.
// Usage: node src/fetch.ts [--force] [--only <id>[,<id>]] [--no-convert]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIFACTS, type Artifact } from './manifest.ts';
import { convertFiles } from './wwmmm-to-stage.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../..');
export const REFERENCE_DIR = join(REPO_ROOT, 'reference');

const sha256 = (buf: Uint8Array): string => createHash('sha256').update(buf).digest('hex');

async function download(url: string, attempts = 4): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'wwm-ref-fetch/0.1 (+tribute research)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      // Wayback is often briefly rate-limited or "temporarily offline", so back off.
      const waitMs = 2000 * 2 ** i;
      console.warn(`  attempt ${i + 1}/${attempts} failed (${String(err)}); retrying in ${waitMs / 1000}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

export type FetchStatus = 'cached' | 'downloaded' | 'failed';

export async function fetchArtifact(a: Artifact, force = false): Promise<FetchStatus> {
  const dest = join(REFERENCE_DIR, a.file);
  if (!force && existsSync(dest) && sha256(readFileSync(dest)) === a.sha256) {
    console.log(`ok     ${a.id} (cached, sha256 verified)`);
    return 'cached';
  }
  console.log(`fetch  ${a.id} <- ${a.url}`);
  const buf = await download(a.url);
  const got = sha256(buf);
  if (got !== a.sha256) {
    console.error(`FAIL   ${a.id}: sha256 mismatch\n  expected ${a.sha256}\n  got      ${got} (${buf.byteLength} bytes)`);
    return 'failed';
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(`${dest}.part`, buf);
  renameSync(`${dest}.part`, dest);
  console.log(`ok     ${a.id} (${buf.byteLength} bytes, sha256 verified)`);
  return 'downloaded';
}

async function main(argv: string[]): Promise<number> {
  const force = argv.includes('--force');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set((argv[onlyIdx + 1] ?? '').split(',')) : null;
  const convert = !argv.includes('--no-convert');
  mkdirSync(REFERENCE_DIR, { recursive: true });

  let failedRequired = 0;
  for (const a of ARTIFACTS) {
    if (only && !only.has(a.id)) continue;
    let status: FetchStatus;
    try {
      status = await fetchArtifact(a, force);
    } catch (err) {
      console.error(`FAIL   ${a.id}: ${String(err)}`);
      status = 'failed';
    }
    if (status === 'failed' && a.required) failedRequired++;
    if (status === 'failed' && !a.required) console.warn(`       (${a.id} is optional; continuing)`);
  }
  if (failedRequired) {
    console.error(`${failedRequired} required artifact(s) failed.`);
    return 1;
  }
  if (convert && (!only || only.has('wwmmm-json') || only.has('wwmmm-png'))) {
    const json = join(REFERENCE_DIR, 'wwmmm/http-aid-dcc.json');
    const png = join(REFERENCE_DIR, 'wwmmm/http-aid-dcc.png');
    if (existsSync(json) && existsSync(png)) {
      const report = convertFiles({ jsonPath: json, pngPath: png, outDir: REFERENCE_DIR, slug: 'aid-dcc' });
      console.log(`convert aid-dcc -> reference/aid-dcc.stage.json (${report.issues.length} structural issue(s); see reference/aid-dcc.check.txt)`);
    }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
