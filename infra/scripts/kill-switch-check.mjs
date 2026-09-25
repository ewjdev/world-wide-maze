#!/usr/bin/env node
/**
 * Kill-switch check (Phase 12): with KV `kill:capture` set (or CAPTURE_ENABLED=0), a cached URL still returns its
 * run, a new URL is refused with RATE_LIMITED, and the curated list is still served.
 *   node infra/scripts/kill-switch-check.mjs <base> <cached-url> <new-url>
 */
const [
  base = 'http://localhost:8898',
  cached = 'https://www.python.org/',
  fresh = 'https://www.haskell.org/',
] = process.argv.slice(2);
const post = async (url) => {
  const r = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return `HTTP ${r.status} retry-after=${r.headers.get('retry-after')} ${JSON.stringify(await r.json())}`;
};
console.log(`# kill switch check against ${base} at ${new Date().toISOString()}`);
console.log(`cached URL ${cached}: ${await post(cached)}`);
console.log(`new URL ${fresh}: ${await post(fresh)}`);
const c = await fetch(`${base}/api/curated`);
console.log(`GET /api/curated: HTTP ${c.status} ${JSON.stringify(await c.json())}`);
