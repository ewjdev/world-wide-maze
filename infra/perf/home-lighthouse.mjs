/** Separate simulated Lighthouse benchmark; never mix with headed/CDP profiles. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareOutput, verifyHomeBuild } from './home-common.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');
const out = prepareOutput('lighthouse-summary.json');
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4318';
const servedBuild = await verifyHomeBuild(base);
const report = { at: new Date().toISOString(), servedBuild, url: base, rows: [] };
for (let repeat = 0; repeat < Number(process.env.AUDIT_REPEATS ?? 3); repeat++) {
  for (const preset of ['mobile', 'desktop']) {
    if (process.env.AUDIT_CASES && !process.env.AUDIT_CASES.split(',').includes(preset)) continue;
    const file = `${out}/lighthouse-${preset}-${repeat}.json`;
    execFileSync(
      'npx',
      [
        '-y',
        'lighthouse@13.5.0',
        base,
        ...(preset === 'desktop' ? ['--preset=desktop'] : []),
        '--only-categories=performance',
        '--output=json',
        `--output-path=${file}`,
        '--chrome-flags=--headless=new --enable-gpu --use-angle=metal --enable-unsafe-webgpu',
        '--quiet',
      ],
      {
        env: { ...process.env, CHROME_PATH: chromium.executablePath() },
        timeout: 180000,
        stdio: 'pipe',
      },
    );
    const r = JSON.parse(readFileSync(file, 'utf8'));
    const a = r.audits;
    const row = {
      repeat,
      preset,
      version: r.lighthouseVersion,
      settings: r.configSettings,
      browser: r.environment,
      score: r.categories.performance.score * 100,
      fcp: a['first-contentful-paint'].numericValue,
      lcp: a['largest-contentful-paint'].numericValue,
      tbt: a['total-blocking-time'].numericValue,
      cls: a['cumulative-layout-shift'].numericValue,
      speedIndex: a['speed-index'].numericValue,
      runtimeError: r.runtimeError,
      warnings: r.runWarnings,
    };
    report.rows.push(row);
    writeFileSync(`${out}/lighthouse-summary.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(row));
    if (r.runtimeError) throw new Error(`Lighthouse runtime error: ${JSON.stringify(r.runtimeError)}`);
  }
}
