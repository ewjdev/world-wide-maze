#!/usr/bin/env node
/**
 * Idempotent Cloudflare provisioning for World Wide Maze (Phase 17). DRY-RUN BY DEFAULT.
 *
 *   node infra/scripts/provision.mjs              # read-only: list what exists, print the plan and the id patch
 *   node infra/scripts/provision.mjs --apply      # create what's missing, write ids, apply D1 migrations
 *   node infra/scripts/provision.mjs --offline    # no Cloudflare calls at all: plan as if nothing exists
 *
 * Options: --skip-migrations (with --apply), --help.
 *
 * Reads resource names from infra/cloudflare.config.json. Talks to Cloudflare only through the project's wrangler
 * (apps/worker/node_modules/.bin/wrangler), authenticated by your `wrangler login` session or by
 * CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID) in the environment. The AI Gateways are created through the
 * Cloudflare API only when CLOUDFLARE_API_TOKEN is set (needs "AI Gateway: Edit"); otherwise it prints the
 * dashboard steps. Never prints secret values: it only lists which secrets are missing and how to set them.
 *
 * What --apply does, in order:
 *  1. D1 `wwm` + `wwm-preview`, R2 `wwm-stages` + `wwm-stages-preview`, KV `wwm-cache` + `wwm-cache-preview`,
 *     AI Gateways `wwm` + `wwm-preview` (names from the config) — only the missing ones.
 *  2. Writes the ids / names / account id / domain route into apps/worker/wrangler.jsonc (env.production and
 *     env.production.previews) and apps/worker/wrangler.preview-migrations.jsonc, keeping comments.
 *  3. Applies D1 migrations to the production and the preview database (wrangler asks to confirm).
 *  4. Lists missing Worker secrets (production) and Preview base-config secrets, with the exact commands.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildPatches,
  desiredResources,
  formatPlan,
  hasDomain,
  loadInfraConfig,
  parseD1List,
  parseGatewayList,
  parseJsonc,
  parseKvList,
  parseR2List,
  parseSecretNames,
  parseWhoamiAccounts,
  patchJsonc,
  planResources,
  secretCommands,
} from './lib/cloudflare-infra.mjs';

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('*/')[0]
      .replace(/^#!.*\n\/\*\*?/, ''),
  );
  process.exit(0);
}
const unknown = [...args].filter((a) => !['--apply', '--offline', '--skip-migrations'].includes(a));
if (unknown.length) {
  console.error(`unknown option(s): ${unknown.join(' ')} (see --help)`);
  process.exit(2);
}
const APPLY = args.has('--apply');
const OFFLINE = args.has('--offline');
if (APPLY && OFFLINE) {
  console.error('--apply needs Cloudflare access; drop --offline');
  process.exit(2);
}

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const WORKER_DIR = path('../../apps/worker');
const WRANGLER_BIN = path('../../apps/worker/node_modules/.bin/wrangler');
const FILES = {
  config: path('../cloudflare.config.json'),
  wrangler: path('../../apps/worker/wrangler.jsonc'),
  migrations: path('../../apps/worker/wrangler.preview-migrations.jsonc'),
};
const cfg = loadInfraConfig(JSON.parse(readFileSync(FILES.config, 'utf8')));
const ENV = ['--env', cfg.wranglerEnv];

const say = (s = '') => console.log(s);
const head = (s) => say(`\n── ${s}`);

/** Runs the project's wrangler; captures output unless `inherit`. Never logs env values. */
function wrangler(argv, { inherit = false, allowFail = false } = {}) {
  if (!existsSync(WRANGLER_BIN))
    throw new Error('wrangler not installed: run `pnpm i` at the repo root first');
  const r = spawnSync(WRANGLER_BIN, argv, {
    cwd: WORKER_DIR,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', FORCE_COLOR: '0' },
  });
  if (r.status !== 0 && !allowFail) {
    const out = inherit ? '' : `\n${(r.stderr || r.stdout || '').trim().slice(-1500)}`;
    throw new Error(`wrangler ${argv.join(' ')} failed (exit ${r.status})${out}`);
  }
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

async function cfApi(method, apiPath, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false)
    throw new Error(
      `${method} ${apiPath}: HTTP ${res.status} ${JSON.stringify(json.errors ?? json).slice(0, 300)}`,
    );
  return json;
}

/** One gateway per target: logs on, a modest request rate limit; authentication off (the Worker sends the
 *  provider key; see infra/README.md "AI Gateway" to switch to an authenticated gateway). */
const GATEWAY_SETTINGS = {
  cache_invalidate_on_update: true,
  cache_ttl: 0,
  collect_logs: true,
  rate_limiting_interval: 60,
  rate_limiting_limit: 60,
  rate_limiting_technique: 'sliding',
};

// ── 1. who / where ──────────────────────────────────────────────────────────────────────────────────────────
say(
  `World Wide Maze provisioning — ${APPLY ? 'APPLY' : OFFLINE ? 'offline dry-run' : 'dry-run (read-only)'}`,
);
say(
  `Worker ${cfg.worker} (wrangler --env ${cfg.wranglerEnv}), domain ${hasDomain(cfg) ? cfg.domain : '(not set)'}`,
);

let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || null;
const apiToken = Boolean(process.env.CLOUDFLARE_API_TOKEN);
if (!OFFLINE) {
  const who = wrangler(['whoami', '--json'], { allowFail: true });
  if (!who.ok) {
    console.error(
      '\nNot authenticated. Run `pnpm --filter @wwm/worker exec wrangler login` (account owner), or export\n' +
        'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, then re-run. (Use --offline to see the plan without an account.)',
    );
    process.exit(1);
  }
  const accounts = parseWhoamiAccounts(who.stdout);
  if (!accountId) {
    if (accounts.length !== 1) {
      console.error(
        `\n${accounts.length} accounts visible: ${accounts.map((a) => `${a.name} (${a.id})`).join(', ')}.\n` +
          'Export CLOUDFLARE_ACCOUNT_ID=<id> to pick one, then re-run.',
      );
      process.exit(1);
    }
    accountId = accounts[0].id;
  }
  process.env.CLOUDFLARE_ACCOUNT_ID = accountId; // pin every wrangler call below to this account
  say(`Account ${accountId}${apiToken ? ' (API token)' : ' (wrangler login session)'}`);
}

// ── 2. what exists ──────────────────────────────────────────────────────────────────────────────────────────
async function listExisting() {
  if (OFFLINE) return { d1: new Map(), kv: new Map(), r2: new Set(), aiGateway: null };
  const d1 = parseD1List(wrangler(['d1', 'list', '--json']).stdout);
  const kv = parseKvList(wrangler(['kv', 'namespace', 'list']).stdout);
  const r2 = parseR2List(wrangler(['r2', 'bucket', 'list']).stdout);
  let aiGateway = null;
  if (apiToken) {
    try {
      aiGateway = parseGatewayList(
        await cfApi('GET', `/accounts/${accountId}/ai-gateway/gateways?per_page=50`),
      );
    } catch (e) {
      say(`(could not list AI Gateways with the API token: ${e.message}; treating them as manual)`);
    }
  }
  return { d1, kv, r2, aiGateway };
}

let existing = await listExisting();
let plan = planResources(desiredResources(cfg), existing);
head('Resources');
for (const l of formatPlan(plan)) say(l);

// ── 3. create ───────────────────────────────────────────────────────────────────────────────────────────────
if (APPLY) {
  for (const p of plan.filter((x) => x.action === 'create')) {
    say(`creating ${p.kind} ${p.name} …`);
    if (p.kind === 'd1') wrangler(['d1', 'create', p.name]);
    else if (p.kind === 'r2') wrangler(['r2', 'bucket', 'create', p.name]);
    else if (p.kind === 'kv')
      wrangler(['kv', 'namespace', 'create', p.name]); // no --env: title = name exactly
    else if (p.kind === 'aiGateway')
      await cfApi('POST', `/accounts/${accountId}/ai-gateway/gateways`, { id: p.name, ...GATEWAY_SETTINGS });
  }
  if (plan.some((x) => x.action === 'create')) {
    existing = await listExisting(); // ids come from the listings, not from parsing create output
    plan = planResources(desiredResources(cfg), existing);
    const still = plan.filter((x) => x.action === 'create');
    if (still.length)
      throw new Error(`created but not listed yet: ${still.map((x) => x.name).join(', ')}; re-run`);
  }
}
const manualGateways = plan.filter((x) => x.kind === 'aiGateway' && x.action === 'manual');
if (manualGateways.length) {
  head('AI Gateway (manual: no CLOUDFLARE_API_TOKEN with "AI Gateway: Edit")');
  say('Dashboard → AI → AI Gateway → Create Gateway, once per name:');
  for (const g of manualGateways) say(`  • ${g.name}   (${g.target})`);
  say(
    'Settings: Collect logs on; Rate limiting 60 requests / 60 s, sliding; Authenticated Gateway off; cache off.',
  );
  say('Or export CLOUDFLARE_API_TOKEN (AI Gateway Edit) and re-run with --apply.');
}

// ── 4. write ids into the wrangler config ───────────────────────────────────────────────────────────────────
const idOf = (target, kind) => plan.find((x) => x.target === target && x.kind === kind)?.id ?? null;
const ids = {
  production: { d1: idOf('production', 'd1'), kv: idOf('production', 'kv') },
  previews: { d1: idOf('previews', 'd1'), kv: idOf('previews', 'kv') },
  accountId,
};
const wranglerText = readFileSync(FILES.wrangler, 'utf8');
const migrationsText = readFileSync(FILES.migrations, 'utf8');
const patches = buildPatches(parseJsonc(wranglerText), parseJsonc(migrationsText), cfg, ids);
const w = patchJsonc(wranglerText, patches.wrangler);
const m = patchJsonc(migrationsText, patches.migrations);
head(`Config changes (${APPLY ? 'written' : 'would write'})`);
if (!w.changed.length && !m.changed.length) say('  none: apps/worker/wrangler*.jsonc already match');
for (const c of w.changed)
  say(`  wrangler.jsonc  ${c.path}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
for (const c of m.changed)
  say(`  wrangler.preview-migrations.jsonc  ${c.path}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
if (!hasDomain(cfg))
  say('  (no custom domain yet: set "domain" in infra/cloudflare.config.json, then re-run)');
if (APPLY) {
  if (w.changed.length) writeFileSync(FILES.wrangler, w.text);
  if (m.changed.length) writeFileSync(FILES.migrations, m.text);
  if (w.changed.length) {
    say('regenerating apps/worker/worker-configuration.d.ts …');
    wrangler(['types', '--strict-vars=false']);
  }
}

// ── 5. D1 migrations ────────────────────────────────────────────────────────────────────────────────────────
head('D1 migrations');
const migrateProd = ['d1', 'migrations', 'apply', cfg.production.d1, '--remote', ...ENV];
const migratePreview = [
  'd1',
  'migrations',
  'apply',
  'PREVIEW_DB',
  '--remote',
  '--config',
  'wrangler.preview-migrations.jsonc',
];
if (APPLY && !args.has('--skip-migrations')) {
  wrangler(migrateProd, { inherit: true });
  wrangler(migratePreview, { inherit: true });
} else {
  say(`  (in apps/worker) pnpm exec wrangler ${migrateProd.join(' ')}`);
  say(`  (in apps/worker) pnpm exec wrangler ${migratePreview.join(' ')}`);
}

// ── 6. secrets (names only) ─────────────────────────────────────────────────────────────────────────────────
head('Secrets');
let missing = { production: cfg.secrets, previews: cfg.secrets };
if (!OFFLINE) {
  const prod = wrangler(['secret', 'list', ...ENV, '--format', 'json'], { allowFail: true });
  const prev = wrangler(['preview', 'base-config', 'secret', 'list', ...ENV, '--json'], { allowFail: true });
  const have = { production: parseSecretNames(prod.stdout), previews: parseSecretNames(prev.stdout) };
  if (!prod.ok)
    say(`  (production secrets not listable yet — Worker ${cfg.worker} not deployed? Set them anyway.)`);
  if (!prev.ok) say('  (Preview base-config secrets not listable — assuming none are set.)');
  missing = {
    production: cfg.secrets.filter((s) => !have.production.has(s)),
    previews: cfg.secrets.filter((s) => !have.previews.has(s)),
  };
}
const cmds = secretCommands(cfg, missing);
if (!cmds.length) say('  all set');
else {
  say(
    'Missing. Run in apps/worker; wrangler prompts for each value (use different values for production and',
  );
  say(
    'Previews; IP_HASH_SALT: `openssl rand -hex 24`; ANTHROPIC_API_KEY: a key from console.anthropic.com):',
  );
  for (const c of cmds) say(`  ${c}`);
  say(
    '  (Base-config secrets reach only Previews created afterwards; for an existing one add --name pr-<N>:',
  );
  say('   `pnpm exec wrangler preview secret put <NAME> --env production --name pr-<N>`.)');
}

head('Next');
if (!APPLY) say('Re-run with --apply to create the missing resources and write the ids.');
say(
  'Then: node infra/scripts/check-deploy-config.mjs all   (must print "production: ok" and "previews: ok")',
);
