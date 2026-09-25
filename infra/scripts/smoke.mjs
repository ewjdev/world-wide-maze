#!/usr/bin/env node
/**
 * Post-deploy smoke test (Phase 12). Read-only apart from creating one pairing room (expires in 30 min).
 * Checks the web app, security headers, the API, the stats gate and the kill-switch fallback (curated list).
 *
 *   node infra/scripts/smoke.mjs https://<host> [--dev]     (--dev: local wrangler dev, where stats is on)
 */
const base = (process.argv[2] ?? '').replace(/\/$/, '');
const dev = process.argv.includes('--dev');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: smoke.mjs <base-url> [--dev]');
  process.exit(2);
}
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message ?? e) });
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

await check('GET / serves the app with a CSP', async () => {
  const r = await fetch(`${base}/`);
  const html = await r.text();
  expect(r.status === 200, `status ${r.status}`);
  expect(html.includes('<div id="root">'), 'no app root');
  const csp = r.headers.get('content-security-policy') ?? '';
  expect(csp.includes("frame-ancestors 'none'"), `CSP missing/weak: ${csp}`);
  expect(r.headers.get('x-content-type-options') === 'nosniff', 'no nosniff');
  return csp.slice(0, 60);
});
await check('SPA fallback for /play/:id and /c/:code', async () => {
  for (const p of ['/play/practice', '/c/123456', '/about']) {
    const r = await fetch(`${base}${p}`);
    expect(r.status === 200 && (await r.text()).includes('<div id="root">'), `${p}: ${r.status}`);
  }
});
await check('GET /api/health', async () => {
  const r = await fetch(`${base}/api/health`);
  const j = await r.json();
  expect(r.status === 200 && j.ok === true, `status ${r.status}`);
  expect((r.headers.get('content-security-policy') ?? '').includes("default-src 'none'"), 'API CSP missing');
  return j.contract;
});
await check('GET /api/curated (kill-switch fallback list)', async () => {
  const r = await fetch(`${base}/api/curated`);
  const j = await r.json();
  expect(r.status === 200 && Array.isArray(j.runs), `status ${r.status}`);
  return `${j.runs.length} curated runs`;
});
await check('POST /api/rooms → 6-digit code', async () => {
  const r = await fetch(`${base}/api/rooms`, { method: 'POST' });
  const j = await r.json();
  expect(r.status === 200 && /^\d{6}$/.test(j.code), `status ${r.status}`);
  const s = await fetch(`${base}/api/rooms/${j.code}/stats`);
  expect(dev ? s.status === 200 : s.status === 404, `stats gate: ${s.status} (expected ${dev ? 200 : 404})`);
  return `room ${j.code}, stats ${s.status}`;
});
await check('cross-site POST refused', async () => {
  const r = await fetch(`${base}/api/scores`, {
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' },
    body: '{}',
  });
  expect(r.status === 403, `status ${r.status}`);
});
await check('share page 404 for an unknown stage', async () => {
  const r = await fetch(`${base}/s/${'0'.repeat(64)}`);
  expect(r.status === 404, `status ${r.status}`);
});

for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
