/**
 * Node-only helpers (`@wwm/stage-builder/node`): load capture fixtures and the 2013 reference stage.
 * Not used by the pure core, so the core stays runnable in Workers and browsers.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CaptureBundle, parseCapture, parseStage, type RGBAImage, type StageData } from '@wwm/schema';
import { decodePng } from './png.ts';

export { decodePng, encodePng } from './png.ts';

/** Repo root (…/packages/stage-builder/src/node → repo). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const CAPTURES_DIR = join(REPO_ROOT, 'fixtures/captures');
export const BUILDER_FIXTURES_DIR = join(REPO_ROOT, 'fixtures/builder');
export const REFERENCE_STAGE = join(REPO_ROOT, 'reference/aid-dcc.stage.json');

export function listCaptureSlugs(): string[] {
  return readdirSync(CAPTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CAPTURES_DIR, d.name, 'capture.json')))
    .map((d) => d.name)
    .sort();
}

export function loadPng(path: string): RGBAImage {
  const img = decodePng(readFileSync(path));
  return {
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength),
  };
}

export function loadCapture(slug: string): { capture: CaptureBundle; image: RGBAImage } {
  const dir = join(CAPTURES_DIR, slug);
  const capture = parseCapture(JSON.parse(readFileSync(join(dir, 'capture.json'), 'utf8')));
  const image = loadPng(join(dir, capture.screenshot.path));
  return { capture, image };
}

/** The converted 2013 AID-DCC stage (from `pnpm ref:fetch`), or null if it hasn't been fetched. */
export function loadReferenceStage(): StageData | null {
  if (!existsSync(REFERENCE_STAGE)) return null;
  return parseStage(JSON.parse(readFileSync(REFERENCE_STAGE, 'utf8')));
}
