import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const CAPTURES_DIR = `${REPO_ROOT}/fixtures/captures`;
export const EVAL_DIR = `${REPO_ROOT}/fixtures/eval`;

export interface EvalCaptureSource {
  slug: string;
  url: string;
  lang: string;
  dark?: boolean;
  layout: string;
  license: string;
}

/** The eval-set page list (sources + licensing notes). */
export function loadEvalCaptures(): EvalCaptureSource[] {
  return JSON.parse(
    readFileSync(new URL('../eval-captures.json', import.meta.url), 'utf8'),
  ) as EvalCaptureSource[];
}
