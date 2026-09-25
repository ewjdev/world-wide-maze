/**
 * Pure helpers for the Cloudflare infra scripts (Phase 17): JSONC parsing with value spans (so ids can be written
 * back without losing comments), infra/cloudflare.config.json validation, wrangler output parsers, the provisioning
 * plan, the wrangler.jsonc patch set, and the deploy-config checks. No I/O here; unit-tested in
 * apps/worker/test/infra-provision.test.ts with canned command output.
 */

// ── JSONC ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Parses JSONC (comments + trailing commas) and records the source span of every value, keyed by
 * `JSON.stringify(path)` where path is the list of object keys / array indices from the root.
 * @param {string} text
 * @returns {{ value: unknown, spans: Map<string, [number, number]> }}
 */
export function parseJsoncWithSpans(text) {
  let i = 0;
  /** @type {Map<string, [number, number]>} */
  const spans = new Map();
  const fail = (msg) => {
    const line = text.slice(0, i).split('\n').length;
    throw new Error(`JSONC parse error at line ${line}: ${msg}`);
  };
  const skip = () => {
    for (;;) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
      else if (c === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++;
      } else if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        if (end < 0) fail('unterminated comment');
        i = end + 2;
      } else return;
    }
  };
  const str = () => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) fail('unterminated string');
    i++;
    return JSON.parse(text.slice(start, i));
  };
  /** @param {(string|number)[]} path */
  const value = (path) => {
    skip();
    const start = i;
    let v;
    const c = text[i];
    if (c === '{') {
      i++;
      v = {};
      for (;;) {
        skip();
        if (text[i] === '}') {
          i++;
          break;
        }
        if (text[i] !== '"') fail('expected a key');
        const k = str();
        skip();
        if (text[i] !== ':') fail('expected ":"');
        i++;
        v[k] = value([...path, k]);
        skip();
        if (text[i] === ',') i++;
        else if (text[i] !== '}') fail('expected "," or "}"');
      }
    } else if (c === '[') {
      i++;
      v = [];
      for (;;) {
        skip();
        if (text[i] === ']') {
          i++;
          break;
        }
        v.push(value([...path, v.length]));
        skip();
        if (text[i] === ',') i++;
        else if (text[i] !== ']') fail('expected "," or "]"');
      }
    } else if (c === '"') v = str();
    else {
      const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
      if (!m) fail(`unexpected ${JSON.stringify(c)}`);
      i += m[0].length;
      v = JSON.parse(m[0]);
    }
    spans.set(JSON.stringify(path), [start, i]);
    return v;
  };
  const root = value([]);
  skip();
  if (i < text.length) fail('trailing content');
  return { value: root, spans };
}

/** @param {string} text */
export const parseJsonc = (text) => parseJsoncWithSpans(text).value;

/** Compact one-line JSON in the repo's Biome style: `{ "a": 1 }`, `[{ "a": 1 }]`, `[]`. */
export function inlineJson(v) {
  if (Array.isArray(v)) return `[${v.map(inlineJson).join(', ')}]`;
  if (v && typeof v === 'object') {
    const e = Object.entries(v);
    return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inlineJson(x)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

/**
 * Replaces existing values in JSONC text, keeping comments and layout. Every path must exist.
 * @param {string} text
 * @param {{ path: (string|number)[], value: unknown }[]} patches
 * @returns {{ text: string, changed: { path: string, from: unknown, to: unknown }[] }}
 */
export function patchJsonc(text, patches) {
  const { spans } = parseJsoncWithSpans(text);
  const edits = [];
  const changed = [];
  for (const p of patches) {
    const span = spans.get(JSON.stringify(p.path));
    if (!span) throw new Error(`patchJsonc: no value at ${p.path.join('.')}`);
    const before = text.slice(span[0], span[1]);
    const after = inlineJson(p.value);
    if (JSON.stringify(parseJsonc(before)) === JSON.stringify(p.value)) continue;
    edits.push({ span, after });
    changed.push({ path: p.path.join('.'), from: parseJsonc(before), to: p.value });
  }
  edits.sort((a, b) => b.span[0] - a.span[0]);
  let out = text;
  for (const e of edits) out = out.slice(0, e.span[0]) + e.after + out.slice(e.span[1]);
  return { text: out, changed };
}

// ── infra/cloudflare.config.json ────────────────────────────────────────────────────────────────────────────

export const RATE_LIMITERS = ['READ_LIMITER', 'ROOM_CREATE_LIMITER', 'ROOM_WS_LIMITER'];
export const DOMAIN_PLACEHOLDER = '{{DOMAIN}}';

/**
 * Validates infra/cloudflare.config.json and returns it normalised.
 * @param {any} raw
 */
export function loadInfraConfig(raw) {
  const problems = [];
  const name = (v, where) => {
    if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(v))
      problems.push(`${where}: expected a lowercase resource name, got ${JSON.stringify(v)}`);
    return v;
  };
  const target = (t, key) => {
    if (!t || typeof t !== 'object') {
      problems.push(`${key}: missing`);
      return {};
    }
    const ids = t.rateLimitNamespaceIds ?? {};
    for (const r of RATE_LIMITERS)
      if (!/^\d+$/.test(String(ids[r] ?? '')))
        problems.push(`${key}.rateLimitNamespaceIds.${r}: expected digits`);
    return {
      d1: name(t.d1, `${key}.d1`),
      r2: name(t.r2, `${key}.r2`),
      kv: name(t.kv, `${key}.kv`),
      aiGateway: name(t.aiGateway, `${key}.aiGateway`),
      rateLimitNamespaceIds: Object.fromEntries(RATE_LIMITERS.map((r) => [r, String(ids[r])])),
    };
  };
  const cfg = {
    worker: name(raw?.worker, 'worker'),
    wranglerEnv: name(raw?.wranglerEnv, 'wranglerEnv'),
    domain: typeof raw?.domain === 'string' ? raw.domain : DOMAIN_PLACEHOLDER,
    production: target(raw?.production, 'production'),
    previews: {
      ...target(raw?.previews, 'previews'),
      namePrefix: String(raw?.previews?.namePrefix ?? 'pr-'),
    },
    secrets: Array.isArray(raw?.secrets) ? raw.secrets.map(String) : [],
  };
  if (cfg.domain !== DOMAIN_PLACEHOLDER && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cfg.domain))
    problems.push(`domain: not a hostname: ${cfg.domain}`);
  for (const k of ['d1', 'r2', 'kv', 'aiGateway'])
    if (cfg.production[k] && cfg.production[k] === cfg.previews[k])
      problems.push(`previews.${k} must differ from production.${k} (Previews would share production data)`);
  const p = Object.values(cfg.production.rateLimitNamespaceIds ?? {});
  const q = Object.values(cfg.previews.rateLimitNamespaceIds ?? {});
  if (new Set([...p, ...q]).size !== p.length + q.length)
    problems.push('rateLimitNamespaceIds must be unique across production and previews');
  if (problems.length) throw new Error(`infra/cloudflare.config.json:\n - ${problems.join('\n - ')}`);
  return cfg;
}

export const hasDomain = (cfg) => cfg.domain !== DOMAIN_PLACEHOLDER;

// ── wrangler output parsers (tolerant of banner lines around the payload) ─────────────────────────────────

/** Extracts the first JSON array/object from mixed CLI output. */
export function extractJson(stdout) {
  const s = String(stdout);
  for (let k = 0; k < s.length; k++) {
    if (s[k] !== '[' && s[k] !== '{') continue;
    for (
      let end = s.lastIndexOf(s[k] === '[' ? ']' : '}');
      end > k;
      end = s.lastIndexOf(s[k] === '[' ? ']' : '}', end - 1)
    ) {
      try {
        return JSON.parse(s.slice(k, end + 1));
      } catch {}
    }
  }
  throw new Error(`no JSON in command output: ${s.slice(0, 200)}`);
}

/** `wrangler d1 list --json` → Map name → uuid. */
export const parseD1List = (stdout) =>
  new Map(extractJson(stdout).map((d) => [String(d.name), String(d.uuid ?? d.id)]));

/** `wrangler kv namespace list` (JSON array of { id, title }) → Map title → id. */
export const parseKvList = (stdout) =>
  new Map(extractJson(stdout).map((n) => [String(n.title), String(n.id)]));

/** `wrangler r2 bucket list` (labelled text blocks, `name:  <bucket>`) → Set of bucket names. */
export const parseR2List = (stdout) =>
  new Set([...String(stdout).matchAll(/^name:\s+(\S+)\s*$/gm)].map((m) => m[1]));

/** Cloudflare API `GET /accounts/:id/ai-gateway/gateways` body → Set of gateway ids. */
export const parseGatewayList = (body) => new Set((body?.result ?? []).map((g) => String(g.id)));

/** `wrangler secret list --format json` / `wrangler preview base-config secret list --json` → secret names. */
export function parseSecretNames(stdout) {
  let j;
  try {
    j = extractJson(stdout);
  } catch {
    return new Set();
  }
  const arr = Array.isArray(j) ? j : (j.secrets ?? j.result ?? []);
  return new Set(arr.map((s) => String(typeof s === 'string' ? s : s.name)));
}

/** `wrangler whoami --json` → account ids. */
export function parseWhoamiAccounts(stdout) {
  const j = extractJson(stdout);
  return (j.accounts ?? []).map((a) => ({ id: String(a.id), name: String(a.name ?? '') }));
}

// ── plan ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** @typedef {'d1'|'r2'|'kv'|'aiGateway'} Kind */
/** @typedef {'production'|'previews'} Target */

/** @returns {{ kind: Kind, target: Target, name: string }[]} */
export function desiredResources(cfg) {
  const out = [];
  for (const target of /** @type {Target[]} */ (['production', 'previews']))
    for (const kind of /** @type {Kind[]} */ (['d1', 'r2', 'kv', 'aiGateway']))
      out.push({ kind, target, name: cfg[target][kind] });
  return out;
}

/**
 * Diffs the desired resources against what exists. `existing.aiGateway` is null when it couldn't be listed
 * (no API token): those items get action "manual".
 * @param {ReturnType<typeof desiredResources>} desired
 * @param {{ d1: Map<string,string>, kv: Map<string,string>, r2: Set<string>, aiGateway: Set<string> | null }} existing
 */
export function planResources(desired, existing) {
  return desired.map((r) => {
    if (r.kind === 'aiGateway') {
      if (!existing.aiGateway) return { ...r, action: 'manual', id: null };
      return { ...r, action: existing.aiGateway.has(r.name) ? 'exists' : 'create', id: r.name };
    }
    if (r.kind === 'r2') return { ...r, action: existing.r2.has(r.name) ? 'exists' : 'create', id: r.name };
    const id = existing[r.kind].get(r.name) ?? null;
    return { ...r, action: id ? 'exists' : 'create', id };
  });
}

/** Human-readable plan lines. */
export function formatPlan(plan) {
  const label = { d1: 'D1', r2: 'R2', kv: 'KV', aiGateway: 'AI Gateway' };
  return plan.map(
    (p) =>
      `${p.action === 'exists' ? '  ok    ' : p.action === 'create' ? '+ create' : '! manual'}  ${p.target.padEnd(10)} ${label[p.kind].padEnd(10)} ${p.name}${p.id && p.kind !== 'r2' && p.kind !== 'aiGateway' ? `  (${p.id})` : ''}`,
  );
}

// ── wrangler.jsonc patching ─────────────────────────────────────────────────────────────────────────────────

const indexBy = (arr, key, value, where) => {
  const i = (arr ?? []).findIndex((x) => x?.[key] === value);
  if (i < 0) throw new Error(`wrangler.jsonc: ${where} has no entry with ${key} = ${value}`);
  return i;
};

/**
 * Patches for apps/worker/wrangler.jsonc (env.<wranglerEnv> + its previews block) and
 * wrangler.preview-migrations.jsonc from the infra config and the resolved ids. Unknown ids (null) are skipped.
 * @param {any} wrangler parsed wrangler.jsonc
 * @param {any} migrations parsed wrangler.preview-migrations.jsonc
 * @param {ReturnType<typeof loadInfraConfig>} cfg
 * @param {{ production: { d1: string|null, kv: string|null }, previews: { d1: string|null, kv: string|null }, accountId: string|null }} ids
 */
export function buildPatches(wrangler, migrations, cfg, ids) {
  const envKey = cfg.wranglerEnv;
  const env = wrangler?.env?.[envKey];
  if (!env) throw new Error(`wrangler.jsonc: no env.${envKey}`);
  if (!env.previews) throw new Error(`wrangler.jsonc: no env.${envKey}.previews block`);
  const main = [];
  const targets = [
    { t: 'production', base: ['env', envKey], obj: env },
    { t: 'previews', base: ['env', envKey, 'previews'], obj: env.previews },
  ];
  main.push({ path: ['env', envKey, 'name'], value: cfg.worker });
  for (const { t, base, obj } of targets) {
    const c = cfg[t];
    const d = indexBy(obj.d1_databases, 'binding', 'DB', `${base.join('.')}.d1_databases`);
    main.push({ path: [...base, 'd1_databases', d, 'database_name'], value: c.d1 });
    if (ids[t].d1) main.push({ path: [...base, 'd1_databases', d, 'database_id'], value: ids[t].d1 });
    const r = indexBy(obj.r2_buckets, 'binding', 'STAGES', `${base.join('.')}.r2_buckets`);
    main.push({ path: [...base, 'r2_buckets', r, 'bucket_name'], value: c.r2 });
    const k = indexBy(obj.kv_namespaces, 'binding', 'CACHE', `${base.join('.')}.kv_namespaces`);
    if (ids[t].kv) main.push({ path: [...base, 'kv_namespaces', k, 'id'], value: ids[t].kv });
    for (const rl of RATE_LIMITERS) {
      const x = indexBy(obj.ratelimits, 'name', rl, `${base.join('.')}.ratelimits`);
      main.push({ path: [...base, 'ratelimits', x, 'namespace_id'], value: c.rateLimitNamespaceIds[rl] });
    }
    main.push({ path: [...base, 'vars', 'AI_GATEWAY_ID'], value: c.aiGateway });
    if (ids.accountId) main.push({ path: [...base, 'vars', 'AI_GATEWAY_ACCOUNT_ID'], value: ids.accountId });
  }
  if (hasDomain(cfg))
    main.push({ path: ['env', envKey, 'routes'], value: [{ pattern: cfg.domain, custom_domain: true }] });
  const m = indexBy(
    migrations?.d1_databases,
    'binding',
    'PREVIEW_DB',
    'wrangler.preview-migrations.jsonc d1_databases',
  );
  const mig = [{ path: ['d1_databases', m, 'database_name'], value: cfg.previews.d1 }];
  if (ids.previews.d1) mig.push({ path: ['d1_databases', m, 'database_id'], value: ids.previews.d1 });
  return { wrangler: main, migrations: mig };
}

// ── deploy-config checks ────────────────────────────────────────────────────────────────────────────────────

export const isPlaceholderId = (id) => /^0+[0-9]?$/.test(String(id ?? '').replaceAll('-', ''));

/**
 * Checks one deploy target. Returns hard problems (deploy must not proceed) and warnings.
 * @param {'production'|'previews'} target
 * @param {any} wrangler parsed wrangler.jsonc
 * @param {any} migrations parsed wrangler.preview-migrations.jsonc
 * @param {ReturnType<typeof loadInfraConfig>} cfg
 */
export function checkDeployConfig(target, wrangler, migrations, cfg) {
  const problems = [];
  const warnings = [];
  const env = wrangler?.env?.[cfg.wranglerEnv];
  if (!env) return { problems: [`no env.${cfg.wranglerEnv} in wrangler.jsonc`], warnings };
  if (env.name !== cfg.worker)
    problems.push(`env.${cfg.wranglerEnv}.name is ${env.name}, config says ${cfg.worker}`);
  const obj = target === 'production' ? env : env.previews;
  const where = target === 'production' ? `env.${cfg.wranglerEnv}` : `env.${cfg.wranglerEnv}.previews`;
  if (!obj) return { problems: [...problems, `${where}: missing`], warnings };
  const c = cfg[target];
  const vars = obj.vars ?? {};

  // every var the code reads is declared (vars are not inherited by envs or Previews)
  const missingVars = Object.keys(wrangler.vars ?? {}).filter((k) => !(k in vars));
  if (missingVars.length) problems.push(`${where}.vars missing ${missingVars.join(', ')} (not inherited)`);
  const wantEnv = target === 'production' ? 'production' : 'preview';
  if (vars.WWM_ENV !== wantEnv) problems.push(`${where}.vars.WWM_ENV must be "${wantEnv}"`);
  if (vars.ROOM_STATS !== '0') problems.push(`${where}.vars.ROOM_STATS must be "0" (dev-only relay stats)`);
  if (vars.DEV_ALLOWED_HOSTS) problems.push(`${where}.vars.DEV_ALLOWED_HOSTS must be empty`);
  if (vars.CAPTURE_BACKEND !== 'browser-run')
    problems.push(`${where}.vars.CAPTURE_BACKEND must be browser-run`);
  if (target === 'previews' && vars.TELEMETRY_INGEST !== '0')
    problems.push(`${where}.vars.TELEMETRY_INGEST must be "0"`);
  if (vars.AI_GATEWAY_ID !== c.aiGateway)
    problems.push(`${where}.vars.AI_GATEWAY_ID is ${vars.AI_GATEWAY_ID}, config says ${c.aiGateway}`);
  if (!vars.AI_GATEWAY_ACCOUNT_ID)
    warnings.push(
      `${where}.vars.AI_GATEWAY_ACCOUNT_ID is empty: the docent runs its mock provider (provision --apply fills it)`,
    );

  // bindings the code reads from env (not inherited)
  const db = (obj.d1_databases ?? []).find((d) => d.binding === 'DB');
  if (!db) problems.push(`${where}: no D1 binding DB`);
  else {
    if (db.database_name !== c.d1)
      problems.push(`${where}: D1 DB is ${db.database_name}, config says ${c.d1}`);
    if (isPlaceholderId(db.database_id)) problems.push(`${where}: D1 DB has a placeholder database_id`);
  }
  const kv = (obj.kv_namespaces ?? []).find((k) => k.binding === 'CACHE');
  if (!kv) problems.push(`${where}: no KV binding CACHE`);
  else if (isPlaceholderId(kv.id)) problems.push(`${where}: KV CACHE has a placeholder id`);
  const r2 = (obj.r2_buckets ?? []).find((b) => b.binding === 'STAGES');
  if (!r2) problems.push(`${where}: no R2 binding STAGES`);
  else if (r2.bucket_name !== c.r2)
    problems.push(`${where}: R2 STAGES is ${r2.bucket_name}, config says ${c.r2}`);
  if (obj.browser?.binding !== 'BROWSER') problems.push(`${where}: no browser binding BROWSER`);
  const doNames = (obj.durable_objects?.bindings ?? []).map((b) => b.name).sort();
  if (doNames.join() !== 'BUILD_JOB,LIMITER,ROOM')
    problems.push(`${where}: DO bindings must be ROOM, BUILD_JOB, LIMITER`);
  for (const rl of RATE_LIMITERS) {
    const b = (obj.ratelimits ?? []).find((x) => x.name === rl);
    if (!b) problems.push(`${where}: no rate limit binding ${rl}`);
    else if (String(b.namespace_id) !== c.rateLimitNamespaceIds[rl])
      problems.push(
        `${where}: ${rl} namespace_id ${b.namespace_id}, config says ${c.rateLimitNamespaceIds[rl]}`,
      );
  }

  if (target === 'production') {
    if (!env.assets?.directory) problems.push(`${where}: no static assets directory`);
    if (!env.assets?.run_worker_first?.includes('/api/*'))
      problems.push(`${where}: assets.run_worker_first lacks /api/*`);
    if (!env.routes?.length)
      problems.push(
        `${where}: no custom domain route (set "domain" in infra/cloudflare.config.json, re-run provision)`,
      );
    if (env.preview_urls !== true)
      warnings.push(`${where}.preview_urls is not true: Preview URLs on workers.dev stay off`);
  } else {
    // Previews must never touch production data.
    const prod = env;
    const pdb = (prod.d1_databases ?? []).find((d) => d.binding === 'DB');
    const pkv = (prod.kv_namespaces ?? []).find((k) => k.binding === 'CACHE');
    const pr2 = (prod.r2_buckets ?? []).find((b) => b.binding === 'STAGES');
    if (db && pdb && db.database_id === pdb.database_id)
      problems.push(`${where}: D1 DB shares production's database_id`);
    if (kv && pkv && kv.id === pkv.id) problems.push(`${where}: KV CACHE shares production's id`);
    if (r2 && pr2 && r2.bucket_name === pr2.bucket_name)
      problems.push(`${where}: R2 STAGES shares production's bucket`);
    for (const k of ['triggers', 'routes', 'assets', 'migrations'])
      if (k in obj) problems.push(`${where}.${k}: not allowed in previews (keep it at the env level)`);
    const mdb = (migrations?.d1_databases ?? []).find((d) => d.binding === 'PREVIEW_DB');
    if (!mdb) problems.push('wrangler.preview-migrations.jsonc: no d1_databases binding PREVIEW_DB');
    else if (db && (mdb.database_id !== db.database_id || mdb.database_name !== db.database_name))
      problems.push(
        'wrangler.preview-migrations.jsonc must point at the same database as the previews DB binding',
      );
  }
  return { problems, warnings };
}

// ── secrets ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The exact commands (run in apps/worker) that set each missing secret. Never includes values. */
export function secretCommands(cfg, missing) {
  const e = `--env ${cfg.wranglerEnv}`;
  return [
    ...(missing.production ?? []).map((s) => `pnpm exec wrangler secret put ${s} ${e}   # production`),
    ...(missing.previews ?? []).map(
      (s) => `pnpm exec wrangler preview base-config secret put ${s} ${e}   # new Previews`,
    ),
  ];
}
