import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, resolved from this file (tools/fixture-capture/src/paths.ts). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const FIXTURES_DIR = resolve(REPO_ROOT, 'fixtures');
export const CAPTURES_DIR = resolve(FIXTURES_DIR, 'captures');
export const STAGES_DIR = resolve(FIXTURES_DIR, 'stages');
