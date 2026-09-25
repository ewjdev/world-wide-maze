import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StageData } from '../src/index.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** A fresh deep copy of fixtures/stages/handmade-simple.json (safe to mutate). */
export function handmade(): StageData {
  return JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'fixtures/stages/handmade-simple.json'), 'utf8'),
  ) as StageData;
}
