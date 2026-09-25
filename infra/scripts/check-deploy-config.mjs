#!/usr/bin/env node
/**
 * Pre-deploy guard (Phase 12): refuses to deploy an environment whose wrangler config still has placeholder
 * resource ids or dev-only switches on. Used by .github/workflows/deploy.yml; safe to run locally.
 *
 *   node infra/scripts/check-deploy-config.mjs staging|production
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envName = process.argv[2];
if (envName !== 'staging' && envName !== 'production') {
  console.error('usage: check-deploy-config.mjs staging|production');
  process.exit(2);
}
const path = fileURLToPath(new URL('../../apps/worker/wrangler.jsonc', import.meta.url));
const cfg = JSON.parse(
  readFileSync(path, 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1'),
);
const env = cfg.env?.[envName];
const problems = [];
if (!env) problems.push(`no env.${envName} in wrangler.jsonc`);
else {
  const placeholder = (id) => /^0+[0-9]?$/.test(String(id).replaceAll('-', ''));
  for (const d of env.d1_databases ?? [])
    if (placeholder(d.database_id)) problems.push(`D1 ${d.binding}: placeholder database_id`);
  for (const k of env.kv_namespaces ?? [])
    if (placeholder(k.id)) problems.push(`KV ${k.binding}: placeholder id`);
  if (env.vars?.ROOM_STATS !== '0') problems.push('ROOM_STATS must be "0" (dev-only relay stats)');
  if (env.vars?.DEV_ALLOWED_HOSTS) problems.push('DEV_ALLOWED_HOSTS must be empty');
  if (env.vars?.CAPTURE_BACKEND !== 'browser-run') problems.push('CAPTURE_BACKEND must be browser-run');
  if (!env.assets?.directory) problems.push('no static assets directory');
  if (envName === 'production' && !env.routes?.length)
    problems.push('production has no custom domain route (HTTPS on your own domain; see infra/README.md)');
}
if (problems.length) {
  console.error(`env.${envName} is not ready to deploy:\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`env.${envName}: ok`);
