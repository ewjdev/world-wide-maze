/**
 * Re-render fixtures/eval/index.html from an existing report.json (no rebuild/solve).
 *   node tools/batch-eval/src/cli/html.ts [--dir fixtures/eval]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { renderDashboard } from '../html.ts';
import { EVAL_DIR } from '../paths.ts';
import type { EvalReport } from '../report.ts';

const { values } = parseArgs({ options: { dir: { type: 'string', default: EVAL_DIR } } });
const report = JSON.parse(readFileSync(`${values.dir}/report.json`, 'utf8')) as EvalReport;
writeFileSync(`${values.dir}/index.html`, renderDashboard(report));
console.log(`wrote ${values.dir}/index.html`);
