#!/usr/bin/env node
/**
 * Pre-deploy guard (Phase 12, reworked for Worker Previews in Phase 17). Refuses a deploy whose wrangler config
 * still has placeholder ids, dev-only switches on, names that disagree with infra/cloudflare.config.json,
 * missing (non-inherited) vars/bindings, or Previews bound to production data. Used by .github/workflows/ci.yml;
 * safe to run locally (reads files only).
 *
 *   node infra/scripts/check-deploy-config.mjs production|previews|all
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkDeployConfig, loadInfraConfig, parseJsonc } from './lib/cloudflare-infra.mjs';

const arg = process.argv[2];
if (!['production', 'previews', 'all'].includes(arg)) {
  console.error('usage: check-deploy-config.mjs production|previews|all');
  process.exit(2);
}
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const cfg = loadInfraConfig(JSON.parse(read('../cloudflare.config.json')));
const wrangler = parseJsonc(read('../../apps/worker/wrangler.jsonc'));
const migrations = parseJsonc(read('../../apps/worker/wrangler.preview-migrations.jsonc'));

let failed = false;
for (const target of arg === 'all' ? ['production', 'previews'] : [arg]) {
  const { problems, warnings } = checkDeployConfig(target, wrangler, migrations, cfg);
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (problems.length) {
    failed = true;
    console.error(`${target} is not ready to deploy:\n - ${problems.join('\n - ')}`);
  } else console.log(`${target}: ok`);
}
process.exit(failed ? 1 : 0);
