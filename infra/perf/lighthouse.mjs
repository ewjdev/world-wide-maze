#!/usr/bin/env node
/**
 * Lighthouse (lab Core Web Vitals) for the production build (Phase 12). Uses `npx lighthouse@12` (npm cache, no
 * global install) with Playwright's Chromium.
 *
 *   node infra/perf/lighthouse.mjs http://localhost:8899 [--out docs/launch/evidence/lighthouse.json]
 *
 * Mobile = Lighthouse's default (Moto G Power emulation, simulated slow 4G, 4× CPU slowdown); desktop = its
 * desktop preset. Lab numbers: no field data (CrUX) exists for an undeployed site; INP needs interaction, so TBT
 * is reported as its lab proxy.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv.find((a) => /^https?:/.test(a)) ?? 'http://localhost:8899').replace(/\/$/, '');
const i = process.argv.indexOf('--out');
const out = i > 0 ? process.argv[i + 1] : '/tmp/wwm-lighthouse.json';
const pw = join(homedir(), 'Library/Caches/ms-playwright');
const chromiumDir = readdirSync(pw)
  .filter((d) => /^chromium-\d+$/.test(d))
  .sort()
  .at(-1);
const chrome = join(
  pw,
  chromiumDir,
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const pages = ['/', '/about', '/c/123456', '/log'];
const rows = [];
for (const preset of ['mobile', 'desktop']) {
  for (const p of pages) {
    const file = `/tmp/lh-${preset}${p.replaceAll('/', '_')}.json`;
    try {
      execFileSync(
        'npx',
        [
          '-y',
          'lighthouse@12',
          `${base}${p}`,
          ...(preset === 'desktop' ? ['--preset=desktop'] : []),
          '--only-categories=performance,accessibility,best-practices',
          '--output=json',
          `--output-path=${file}`,
          '--chrome-flags=--headless=new --enable-gpu --use-angle=metal --enable-unsafe-webgpu',
          '--quiet',
        ],
        { env: { ...process.env, CHROME_PATH: chrome }, stdio: 'ignore', timeout: 240_000 },
      );
    } catch (e) {
      console.log(`${preset} ${p}: lighthouse exited ${e.status ?? e.message}`);
    }
    try {
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const a = r.audits;
      const v = (k) => a[k]?.numericValue;
      const row = {
        preset,
        path: p,
        perf: Math.round((r.categories.performance?.score ?? 0) * 100),
        a11y: Math.round((r.categories.accessibility?.score ?? 0) * 100),
        bestPractices: Math.round((r.categories['best-practices']?.score ?? 0) * 100),
        fcpMs: Math.round(v('first-contentful-paint')),
        lcpMs: Math.round(v('largest-contentful-paint')),
        tbtMs: Math.round(v('total-blocking-time')),
        cls: Math.round(v('cumulative-layout-shift') * 1000) / 1000,
        siMs: Math.round(v('speed-index')),
        transferKiB: Math.round(v('total-byte-weight') / 1024),
        lighthouse: r.lighthouseVersion,
        runtimeError: r.runtimeError?.code,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    } catch {
      rows.push({ preset, path: p, error: 'no report' });
    }
  }
}
writeFileSync(out, JSON.stringify({ base, when: new Date().toISOString(), rows }, null, 2));
console.log(`wrote ${out}`);
