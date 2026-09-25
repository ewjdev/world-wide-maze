#!/usr/bin/env node
/**
 * Build tests (Phase 12, tasks 1 and 4). Plain Node ≥ 22.
 *
 * Mode `burst` (task 4): N concurrent `POST /api/stages` for N distinct URLs, then follow every job's SSE stream.
 * The URLs point at a local fixture site this script serves on 127.0.0.1, so the burst doesn't hammer anyone's
 * website; start the Worker with that host allowed (the only way past the SSRF loopback rule):
 *
 *   (cd apps/worker && npx wrangler dev --port 8898 --var DEV_ALLOWED_HOSTS:127.0.0.1:8897)
 *   node tests/load/builds.mjs burst http://localhost:8898 --n 50 --site-port 8897
 *
 * With the default limits you should see 10 accepted jobs and 40 × 429 RATE_LIMITED (10 builds / hour / IP).
 * Add `--var BUILD_LIMIT_PER_HOUR:1000` to the Worker to exercise the browser semaphore instead
 * (BROWSER_MAX_CONCURRENCY slots, 45 s wait, then RATE_LIMITED over SSE).
 *
 * Mode `latency` (task 1): cold and warm build latency for real public URLs, one at a time:
 *   (cd apps/worker && npx wrangler dev --port 8898 --var BUILD_LIMIT_PER_HOUR:1000)
 *   node tests/load/builds.mjs latency http://localhost:8898 [--urls file.txt]
 * cold = POST → SSE `done` (slice 0 stored) on an empty cache; warm = the same POST again (KV cache hit).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [mode = 'burst', ...rest] = process.argv.slice(2);
const opt = (n, d) => {
  const i = rest.indexOf(n);
  return i >= 0 ? rest[i + 1] : d;
};
const base = (rest.find((a) => /^https?:/.test(a)) ?? 'http://localhost:8898').replace(/\/$/, '');
const out = opt('--out', null);

const DEFAULT_URLS = [
  'https://example.com/',
  'https://news.ycombinator.com/',
  'https://en.wikipedia.org/wiki/Labyrinth',
  'https://en.wikipedia.org/wiki/Maze',
  'https://en.wikipedia.org/wiki/Marble_(toy)',
  'https://www.gov.uk/',
  'https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects',
  'https://developer.mozilla.org/en-US/docs/Web/CSS/grid',
  'https://commons.wikimedia.org/wiki/Commons:Picture_of_the_day',
  'https://www.python.org/',
  'https://www.rust-lang.org/',
  'https://www.w3.org/',
  'https://www.iana.org/',
  'https://www.ietf.org/',
  'https://www.debian.org/',
  'https://www.gnu.org/',
  'https://www.kernel.org/',
  'https://nodejs.org/en',
  'https://www.mozilla.org/en-US/',
  'https://www.wikipedia.org/',
  'https://lobste.rs/',
  'https://www.nasa.gov/',
  'https://www.bbc.co.uk/news',
  'https://www.chromeexperiments.com/',
];

function percentile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]) : null;
}

/** Follow `GET /api/jobs/:id` until `done` or `error`. */
async function follow(jobId, timeoutMs = 120_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/jobs/${jobId}`, { signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const steps = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { outcome: 'stream-ended', steps };
      buf += dec.decode(value, { stream: true });
      let i = buf.indexOf('\n\n');
      while (i >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        const type = block
          .split('\n')
          .find((l) => l.startsWith('event:'))
          ?.slice(6)
          .trim();
        if (data) {
          const e = { type, ...JSON.parse(data) };
          if (e.type === 'progress') steps.push(e.step);
          if (e.type === 'done') return { outcome: 'done', steps, stageIds: e.stageIds };
          if (e.type === 'error') return { outcome: `error:${e.code}`, steps, message: e.message };
        }
        i = buf.indexOf('\n\n');
      }
    }
  } catch (e) {
    return { outcome: ctrl.signal.aborted ? 'timeout' : `fetch-error:${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function post(url, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ url }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, ms: performance.now() - t0, t0 };
}

async function burst() {
  const n = Number(opt('--n', '50'));
  const port = Number(opt('--site-port', '8897'));
  const server = createServer((req, res) => {
    const v = new URL(req.url, 'http://x').searchParams.get('v') ?? '0';
    const blocks = Array.from(
      { length: 12 },
      (_, i) =>
        `<section style="margin:24px;padding:24px;background:hsl(${(Number(v) * 37 + i * 29) % 360} 60% 85%)"><h2>Block ${i}</h2><p>${'Lorem ipsum dolor sit amet. '.repeat(8)}</p></section>`,
    ).join('');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<!doctype html><title>Burst page ${v}</title><body style="margin:0;font:16px sans-serif"><h1>Page ${v}</h1>${blocks}</body>`,
    );
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  console.log(`fixture site on 127.0.0.1:${port}; ${n} concurrent POSTs to ${base}`);
  const t0 = performance.now();
  const posts = await Promise.all(
    Array.from({ length: n }, (_, i) => post(`http://127.0.0.1:${port}/?v=${Date.now()}-${i}`)),
  );
  const statuses = {};
  for (const p of posts) statuses[p.status] = (statuses[p.status] ?? 0) + 1;
  console.log('POST statuses', statuses, 'retry-after sample', posts.find((p) => p.status === 429)?.body);
  const jobs = posts.filter((p) => p.status === 202);
  const results = await Promise.all(
    jobs.map(async (p) => {
      const r = await follow(p.body.jobId, 180_000);
      return { ...r, ms: performance.now() - p.t0 };
    }),
  );
  server.close();
  const outcomes = {};
  for (const r of results) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const doneMs = results.filter((r) => r.outcome === 'done').map((r) => r.ms);
  const result = {
    mode: 'burst',
    base,
    when: new Date().toISOString(),
    n,
    wallMs: Math.round(performance.now() - t0),
    postStatuses: statuses,
    postMs: {
      p50: percentile(
        posts.map((p) => p.ms),
        0.5,
      ),
      p95: percentile(
        posts.map((p) => p.ms),
        0.95,
      ),
    },
    jobOutcomes: outcomes,
    doneMs: { p50: percentile(doneMs, 0.5), p95: percentile(doneMs, 0.95), max: percentile(doneMs, 1) },
    errorSamples: results.filter((r) => r.outcome !== 'done').slice(0, 3),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function latency() {
  const file = opt('--urls', null);
  const urls = file
    ? readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : DEFAULT_URLS;
  const rows = [];
  for (const url of urls) {
    const p = await post(url);
    let cold;
    if (p.status === 202) {
      const r = await follow(p.body.jobId, 120_000);
      cold = { outcome: r.outcome, ms: Math.round(performance.now() - p.t0), message: r.message };
    } else if (p.status === 200) cold = { outcome: 'already-cached', ms: Math.round(p.ms) };
    else
      cold = {
        outcome: `http-${p.status}:${p.body.code ?? ''}`,
        ms: Math.round(p.ms),
        message: p.body.message,
      };
    const w = await post(url);
    const warm = { status: w.status, ms: Math.round(w.ms * 10) / 10 };
    rows.push({ url, cold, warm });
    console.log(
      `${cold.outcome.padEnd(22)} cold ${String(cold.ms).padStart(6)} ms  warm ${w.status} ${warm.ms} ms  ${url}`,
    );
  }
  const ok = rows.filter((r) => r.cold.outcome === 'done');
  const warmOk = rows.filter((r) => r.warm.status === 200);
  const result = {
    mode: 'latency',
    base,
    when: new Date().toISOString(),
    urls: rows.length,
    coldDone: ok.length,
    coldMs: {
      p50: percentile(
        ok.map((r) => r.cold.ms),
        0.5,
      ),
      p95: percentile(
        ok.map((r) => r.cold.ms),
        0.95,
      ),
      max: percentile(
        ok.map((r) => r.cold.ms),
        1,
      ),
    },
    warmHits: warmOk.length,
    warmMs: {
      p50: percentile(
        warmOk.map((r) => r.warm.ms),
        0.5,
      ),
      p95: percentile(
        warmOk.map((r) => r.warm.ms),
        0.95,
      ),
    },
    failures: rows.filter((r) => r.cold.outcome !== 'done'),
    rows,
  };
  console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
  return result;
}

const result = mode === 'latency' ? await latency() : await burst();
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
