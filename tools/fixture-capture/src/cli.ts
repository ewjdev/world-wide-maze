/**
 * pnpm fixture:capture <url> <slug> [--dark] [--dpr <n>] [--out <dir>] [--timeout <ms>]
 *
 * Captures <url> with local Playwright Chromium (1280×800 viewport, DPR = --dpr, else the CAPTURE_DPR env
 * var, else CAPTURE_DPR = 2) through the shared @wwm/capture-script sequence and writes:
 *   fixtures/captures/<slug>/capture.json   (CaptureBundle, validated with parseCapture; screenshot.scale = DPR)
 *   fixtures/captures/<slug>/screenshot.png (1280 × DPR wide, full page, CSS height ≤ MAX_PAGE_HEIGHT_PX)
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { captureToDir } from './capture.ts';
import { CAPTURES_DIR } from './paths.ts';

const USAGE = 'usage: pnpm fixture:capture <url> <slug> [--dark] [--dpr <n>] [--out <dir>] [--timeout <ms>]';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dark: { type: 'boolean', default: false },
      dpr: { type: 'string' },
      out: { type: 'string' },
      timeout: { type: 'string', default: '45000' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [url, slug] = positionals;
  if (values.help || !url || !slug) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 2);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`slug must be kebab-case: ${slug}`);
  const dir = resolve(values.out ?? CAPTURES_DIR, slug);
  await mkdir(dir, { recursive: true });
  const t0 = performance.now();
  const r = await captureToDir(url, dir, {
    colorScheme: values.dark ? 'dark' : 'light',
    timeoutMs: Number(values.timeout),
    ...(values.dpr ? { dpr: Number(values.dpr) } : {}),
  });
  const ms = Math.round(performance.now() - t0);
  console.log(
    `✔ ${slug}: ${r.bundle.url}\n  "${r.bundle.title}"\n  page ${r.bundle.page.width}×${r.bundle.page.height}, ` +
      `screenshot ${r.bundle.screenshot.width}×${r.bundle.screenshot.height} @${r.bundle.screenshot.scale}x (${(r.pngBytes / 1024).toFixed(0)} KiB), ` +
      `${r.bundle.elements.length} elements, ${ms} ms\n  kinds: ${JSON.stringify(r.summary.kinds)}\n  cookie: ${JSON.stringify(r.summary.cookie)}, hidden fixed: ${r.summary.hiddenFixed}`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
