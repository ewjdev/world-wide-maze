#!/usr/bin/env node
/**
 * Bundle report for the web app (Phase 12). Builds `apps/web` with source maps into a temp dir, then prints
 * every JS chunk with its raw / gzip / brotli size and the biggest contributors (by original source size,
 * grouped per npm package or workspace package).
 *
 *   node infra/scripts/bundle-report.mjs [--no-build] [--dir /tmp/wwm-dist-sm] [--json out.json]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const dir = opt('--dir', '/tmp/wwm-dist-sm');
if (!args.includes('--no-build')) {
  execFileSync('pnpm', ['exec', 'vite', 'build', '--sourcemap', '--outDir', dir, '--emptyOutDir'], {
    cwd: join(root, 'apps/web'),
    stdio: 'ignore',
  });
}

const group = (s) =>
  s
    .replace(/.*node_modules\/\.pnpm\/[^/]+\/node_modules\//, 'npm:')
    .replace(/^(npm:(@[^/]+\/)?[^/]+).*/, '$1')
    .replace(/.*packages\/([^/]+)\/.*/, '@wwm/$1')
    .replace(/.*apps\/web\/src\/([^/]+).*/, 'web/$1')
    .replace(/.*fixtures\/.*/, 'fixtures');

const assets = join(dir, 'assets');
const rows = [];
for (const f of readdirSync(assets)) {
  if (!f.endsWith('.js')) continue;
  const buf = readFileSync(join(assets, f));
  const row = {
    file: f,
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf).length,
    top: [],
  };
  try {
    const map = JSON.parse(readFileSync(join(assets, `${f}.map`), 'utf8'));
    const agg = new Map();
    map.sources.forEach((s, i) => {
      const k = group(s);
      agg.set(k, (agg.get(k) ?? 0) + (map.sourcesContent?.[i]?.length ?? 0));
    });
    row.top = [...agg].sort((a, b) => b[1] - a[1]).slice(0, 6);
  } catch {
    // no map (workers inline their deps)
  }
  rows.push(row);
}
rows.sort((a, b) => b.raw - a.raw);
const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
let total = 0;
for (const f of readdirSync(assets)) total += statSync(join(assets, f)).size;
console.log(`dist ${dir}: ${readdirSync(assets).length} asset files, ${kb(total)} total`);
for (const r of rows.filter((r) => r.raw > 20_000)) {
  const top = r.top.map(([k, v]) => `${k} ${kb(v)}`).join(', ');
  console.log(
    `${r.file.padEnd(34)} ${kb(r.raw).padStart(12)} gz ${kb(r.gzip).padStart(11)} br ${kb(r.brotli).padStart(11)}  ${top}`,
  );
}
const json = opt('--json');
if (json) writeFileSync(json, JSON.stringify(rows, null, 2));
