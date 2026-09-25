/**
 * Phase 17: the pure parts of infra/scripts/provision.mjs and check-deploy-config.mjs — JSONC parse/patch, config
 * validation, wrangler output parsers (canned output, no Cloudflare calls), plan diffing, id patching and the
 * production/previews deploy checks — run against the real repo files.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  buildPatches,
  checkDeployConfig,
  desiredResources,
  formatPlan,
  type InfraConfig,
  inlineJson,
  isPlaceholderId,
  loadInfraConfig,
  parseD1List,
  parseGatewayList,
  parseJsonc,
  parseJsoncWithSpans,
  parseKvList,
  parseR2List,
  parseSecretNames,
  parseWhoamiAccounts,
  patchJsonc,
  planResources,
  secretCommands,
} from '../../../infra/scripts/lib/cloudflare-infra.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');
const WRANGLER = read('../wrangler.jsonc');
const MIGRATIONS = read('../wrangler.preview-migrations.jsonc');
const RAW_CONFIG = JSON.parse(read('../../../infra/cloudflare.config.json'));
const cfg = loadInfraConfig(RAW_CONFIG);

const IDS = {
  production: { d1: '11111111-2222-4333-8444-555555555555', kv: 'a'.repeat(32) },
  previews: { d1: '66666666-7777-4888-9999-000000000000', kv: 'b'.repeat(32) },
  accountId: 'c'.repeat(32),
};
/** The repo config after a successful `provision --apply` with a domain set. */
function provisioned(domain = 'maze.example.com') {
  const c: InfraConfig = { ...cfg, domain };
  const p = buildPatches(parseJsonc(WRANGLER), parseJsonc(MIGRATIONS), c, IDS);
  return { c, w: patchJsonc(WRANGLER, p.wrangler), m: patchJsonc(MIGRATIONS, p.migrations) };
}

describe('JSONC', () => {
  test('comments, trailing commas and "//" inside strings', () => {
    const text = `{
      // line comment
      "url": "https://example.com/a", /* block */ "n": [1, 2,],
      "o": { "k": true, },
    }`;
    expect(parseJsonc(text)).toEqual({ url: 'https://example.com/a', n: [1, 2], o: { k: true } });
    const { spans } = parseJsoncWithSpans(text);
    const [s, e] = spans.get(JSON.stringify(['n', 1])) ?? [0, 0];
    expect(text.slice(s, e)).toBe('2');
  });
  test('the repo wrangler configs parse', () => {
    const w = parseJsonc(WRANGLER) as { env: { production: { previews: object } } };
    expect(w.env.production.previews).toBeDefined();
    expect(parseJsonc(MIGRATIONS)).toHaveProperty('d1_databases');
  });
  test('patching keeps comments and layout, skips no-ops, rejects unknown paths', () => {
    const text = '{\n  // keep me\n  "a": "x", // and me\n  "b": [],\n}\n';
    const r = patchJsonc(text, [
      { path: ['a'], value: 'y' },
      { path: ['b'], value: [{ pattern: 'd.example', custom_domain: true }] },
    ]);
    expect(r.text).toBe(
      '{\n  // keep me\n  "a": "y", // and me\n  "b": [{ "pattern": "d.example", "custom_domain": true }],\n}\n',
    );
    expect(r.changed.map((c) => c.path)).toEqual(['a', 'b']);
    expect(patchJsonc(r.text, [{ path: ['a'], value: 'y' }]).changed).toEqual([]);
    expect(() => patchJsonc(text, [{ path: ['nope'], value: 1 }])).toThrow(/no value at nope/);
  });
  test('inlineJson matches the Biome one-line style', () => {
    expect(inlineJson({ a: [1, { b: 'c' }], d: {} })).toBe('{ "a": [1, { "b": "c" }], "d": {} }');
  });
});

describe('infra/cloudflare.config.json', () => {
  test('the repo config is valid and separates Previews from production', () => {
    expect(cfg.worker).toBe('wwm');
    expect(cfg.wranglerEnv).toBe('production');
    expect(cfg.previews.d1).not.toBe(cfg.production.d1);
    expect(cfg.secrets).toEqual(['IP_HASH_SALT', 'ANTHROPIC_API_KEY']);
  });
  test('rejects shared resources, duplicate rate-limit ids and bad names', () => {
    const bad = structuredClone(RAW_CONFIG);
    bad.previews.kv = bad.production.kv;
    bad.previews.rateLimitNamespaceIds.READ_LIMITER = bad.production.rateLimitNamespaceIds.READ_LIMITER;
    bad.production.r2 = 'Bad_Name';
    expect(() => loadInfraConfig(bad)).toThrow(
      /production.r2: expected[\s\S]*previews.kv must differ[\s\S]*unique/,
    );
  });
});

describe('wrangler output parsers (canned output)', () => {
  test('d1 list --json, with a banner line before the JSON', () => {
    const out =
      ' ⛅️ wrangler 4.140.0\n───\n[{"uuid":"u-1","name":"wwm","created_at":"x"},{"uuid":"u-2","name":"other"}]\n';
    expect(parseD1List(out)).toEqual(
      new Map([
        ['wwm', 'u-1'],
        ['other', 'u-2'],
      ]),
    );
  });
  test('kv namespace list', () => {
    const out =
      '[\n  {\n    "id": "abc",\n    "title": "wwm-cache",\n    "supports_url_encoding": true\n  }\n]';
    expect(parseKvList(out).get('wwm-cache')).toBe('abc');
  });
  test('r2 bucket list (labelled text)', () => {
    const out =
      'Listing buckets...\nname:           wwm-stages\ncreation_date:  2026-09-25T00:00:00.000Z\n\nname:           x\ncreation_date:  y\n';
    expect(parseR2List(out)).toEqual(new Set(['wwm-stages', 'x']));
  });
  test('AI Gateway list, whoami, secrets', () => {
    expect(parseGatewayList({ success: true, result: [{ id: 'wwm' }] })).toEqual(new Set(['wwm']));
    expect(parseWhoamiAccounts('{"loggedIn":true,"accounts":[{"id":"acc","name":"Me"}]}')).toEqual([
      { id: 'acc', name: 'Me' },
    ]);
    expect(parseSecretNames('[{"name":"IP_HASH_SALT","type":"secret_text"}]')).toEqual(
      new Set(['IP_HASH_SALT']),
    );
    expect(parseSecretNames('{"secrets":[{"name":"A"}]}')).toEqual(new Set(['A']));
    expect(parseSecretNames('✘ [ERROR] This Worker does not exist')).toEqual(new Set());
  });
});

describe('plan', () => {
  test('diffs desired against existing; gateways are manual without an API token', () => {
    const plan = planResources(desiredResources(cfg), {
      d1: new Map([['wwm', 'prod-uuid']]),
      kv: new Map([['wwm-cache-preview', 'kvp']]),
      r2: new Set(['wwm-stages']),
      aiGateway: null,
    });
    const row = (t: string, k: string) => plan.find((p) => p.target === t && p.kind === k);
    expect(row('production', 'd1')).toMatchObject({ action: 'exists', id: 'prod-uuid' });
    expect(row('previews', 'd1')).toMatchObject({ action: 'create', id: null, name: 'wwm-preview' });
    expect(row('production', 'r2')?.action).toBe('exists');
    expect(row('previews', 'r2')?.action).toBe('create');
    expect(row('previews', 'kv')).toMatchObject({ action: 'exists', id: 'kvp' });
    expect(row('production', 'aiGateway')?.action).toBe('manual');
    expect(plan).toHaveLength(7); // 3 data stores × 2 targets + 1 shared AI Gateway
    expect(formatPlan(plan)[0]).toMatch(/ok .*production D1 +wwm {2}\(prod-uuid\)/);
  });
  test('with an API token, gateways are diffed too; a shared gateway is planned once', () => {
    const gw = (existing: Set<string>) =>
      planResources(desiredResources(cfg), {
        d1: new Map(),
        kv: new Map(),
        r2: new Set(),
        aiGateway: existing,
      })
        .filter((p) => p.kind === 'aiGateway')
        .map((p) => p.action);
    // cfg shares one gateway (`wwm`) between production and Previews (owner decision 2026-09-25)
    expect(gw(new Set(['wwm']))).toEqual(['exists']);
    expect(gw(new Set())).toEqual(['create']);
  });
});

describe('id patching + deploy checks', () => {
  test('the committed config is provisioned (2026-09-25): both targets pass the deploy checks', () => {
    const w = parseJsonc(WRANGLER);
    const m = parseJsonc(MIGRATIONS);
    expect(checkDeployConfig('production', w, m, cfg).problems).toEqual([]);
    expect(checkDeployConfig('previews', w, m, cfg).problems).toEqual([]);
  });
  test('after provisioning both targets pass, and comments survive', () => {
    const { c, w, m } = provisioned();
    const wc = parseJsonc(w.text);
    const mc = parseJsonc(m.text);
    expect(checkDeployConfig('production', wc, mc, c)).toEqual({ problems: [], warnings: [] });
    expect(checkDeployConfig('previews', wc, mc, c)).toEqual({ problems: [], warnings: [] });
    const comments = (t: string) => t.split('\n').filter((l) => l.trim().startsWith('//')).length;
    expect(comments(w.text)).toBe(comments(WRANGLER));
    // the top-level (local dev/test) config is untouched
    const top = (t: string) => JSON.stringify({ ...(parseJsonc(t) as object), env: null });
    expect(top(w.text)).toBe(top(WRANGLER));
    expect(w.changed.map((x) => x.path)).toContain('env.production.previews.d1_databases.0.database_id');
    expect(m.changed.map((x) => x.path)).toEqual(['d1_databases.0.database_id']);
    // idempotent: a second run changes nothing
    const again = buildPatches(wc, mc, c, IDS);
    expect(patchJsonc(w.text, again.wrangler).changed).toEqual([]);
  });
  test('a Preview bound to production data, or a mismatched migrations file, is refused', () => {
    const { c, w, m } = provisioned();
    const wc = parseJsonc(w.text) as {
      env: { production: { previews: { kv_namespaces: { id: string }[]; triggers?: unknown } } };
    };
    wc.env.production.previews.kv_namespaces[0] = {
      ...wc.env.production.previews.kv_namespaces[0],
      id: IDS.production.kv,
    };
    wc.env.production.previews.triggers = { crons: [] };
    const mc = parseJsonc(MIGRATIONS); // still the placeholder id
    const { problems } = checkDeployConfig('previews', wc, mc, c);
    expect(problems).toEqual([
      "env.production.previews: KV CACHE shares production's id",
      'env.production.previews.triggers: not allowed in previews (keep it at the env level)',
      'wrangler.preview-migrations.jsonc must point at the same database as the previews DB binding',
    ]);
    void m;
  });
  test('placeholder detection and secret commands (names only)', () => {
    expect(isPlaceholderId('00000000-0000-0000-0000-000000000003')).toBe(true);
    expect(isPlaceholderId(IDS.production.d1)).toBe(false);
    expect(secretCommands(cfg, { production: ['IP_HASH_SALT'], previews: ['ANTHROPIC_API_KEY'] })).toEqual([
      'pnpm exec wrangler secret put IP_HASH_SALT --env production   # production',
      'pnpm exec wrangler preview base-config secret put ANTHROPIC_API_KEY --env production   # new Previews',
    ]);
  });
});
