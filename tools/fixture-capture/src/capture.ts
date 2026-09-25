import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capturePage } from '@wwm/capture-script';
import {
  CAPTURE_DPR,
  type CaptureBundle,
  DEFAULT_VIEWPORT,
  type ElementKind,
  parseCapture,
} from '@wwm/schema';
import { chromium } from 'playwright';
import { formatJson } from './format.ts';

export interface CaptureToDirOptions {
  colorScheme?: 'light' | 'dark';
  timeoutMs?: number;
  /** Device scale factor (screenshot px per CSS px). Default: the `CAPTURE_DPR` env var, else CAPTURE_DPR (2). */
  dpr?: number;
}

/** The `CAPTURE_DPR` env var (a number in (0, 4]) if set, else the contract's CAPTURE_DPR. */
export function defaultDpr(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CAPTURE_DPR;
  if (raw === undefined || raw === '') return CAPTURE_DPR;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 4) throw new Error(`CAPTURE_DPR must be in (0, 4], got "${raw}"`);
  return n;
}

export interface CaptureToDirResult {
  bundle: CaptureBundle;
  pngBytes: number;
  summary: {
    url: string;
    kinds: Partial<Record<ElementKind, number>>;
    cookie: { clicked: string | null; removed: number };
    hiddenFixed: number;
  };
}

/** Capture `url` into `<dir>/capture.json` + `<dir>/screenshot.png`. The bundle is validated before writing. */
export async function captureToDir(
  url: string,
  dir: string,
  opts: CaptureToDirOptions = {},
): Promise<CaptureToDirResult> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { ...DEFAULT_VIEWPORT },
      deviceScaleFactor: opts.dpr ?? defaultDpr(),
      colorScheme: opts.colorScheme ?? 'light',
      reducedMotion: 'reduce',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const page = await context.newPage();
    const r = await capturePage(page, url, {
      screenshotPath: 'screenshot.png',
      navigationTimeoutMs: opts.timeoutMs ?? 45_000,
    });
    const bundle = parseCapture(r.bundle);
    await writeFile(resolve(dir, 'screenshot.png'), r.png);
    await writeFile(resolve(dir, 'capture.json'), formatJson(bundle));
    const kinds: Partial<Record<ElementKind, number>> = {};
    for (const e of bundle.elements) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    return {
      bundle,
      pngBytes: r.png.byteLength,
      summary: { url: bundle.url, kinds, cookie: r.prepare.cookie, hiddenFixed: r.hiddenFixed },
    };
  } finally {
    await browser.close();
  }
}
