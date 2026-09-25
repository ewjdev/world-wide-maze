#!/usr/bin/env node
/**
 * Build the APPROVED curated runs through a running Worker and write the D1 rows for them. Does not touch any
 * remote resource itself: it prints the wrangler commands for a person to run.
 *
 *   node content/scripts/curate.mjs <apiBase> [content/curated.json] [--out content/out]
 *
 * <apiBase> is e.g. http://localhost:8787 (wrangler dev) or the deployed Worker. Only entries in `approved` are
 * built; `content/curated-proposal.md` lists the candidates awaiting the owner's approval.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : 'content/out';
const [api, listPath = 'content/curated.json'] = args.filter((_, i) => i !== outIdx && i !== outIdx + 1);
if (!api) {
  console.error('usage: curate.mjs <apiBase> [curated.json] [--out dir]');
  process.exit(2);
}
const list = JSON.parse(readFileSync(listPath, 'utf8'));
const approved = list.approved ?? [];
if (approved.length === 0) {
  console.error(`${listPath} has no approved entries yet (see content/curated-proposal.md).`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (v) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;

async function buildRun(entry) {
  const res = await fetch(`${api}/api/stages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: entry.url,
      difficulty: entry.difficulty ?? 'normal',
      ...(entry.seed !== undefined ? { seed: entry.seed } : {}),
    }),
  });
  const body = await res.json();
  if (res.status === 200) return body.runId;
  if (res.status !== 202) throw new Error(`POST /api/stages ${res.status}: ${JSON.stringify(body)}`);
  const sse = await (await fetch(`${api}/api/jobs/${body.jobId}`)).text();
  const done = sse.split('\n\n').find((b) => b.includes('event: done'));
  const err = sse.split('\n\n').find((b) => b.includes('event: error'));
  if (!done) throw new Error(`build failed: ${err ?? sse.slice(-300)}`);
  return JSON.parse(
    done
      .split('\n')
      .find((l) => l.startsWith('data:'))
      .slice(5),
  ).runId;
}

/** Wait until every slice of the run is stored (later slices finish after `done`). */
async function waitComplete(runId) {
  for (let i = 0; i < 120; i++) {
    const run = await (await fetch(`${api}/api/runs/${runId}`)).json();
    const first = await (await fetch(`${api}/api/stages/${run.stageIds[0]}`)).json();
    if (run.stageIds.length >= first.source.slice.count) return run;
    await sleep(2000);
  }
  throw new Error(`run ${runId} did not complete`);
}

mkdirSync(outDir, { recursive: true });
const rows = [];
for (const [position, entry] of approved.entries()) {
  process.stdout.write(`${entry.slug}: ${entry.url} … `);
  const runId = await buildRun(entry);
  const run = await waitComplete(runId);
  console.log(`${run.stageIds.length} stage(s), run ${runId.slice(0, 12)}…`);
  rows.push({
    slug: entry.slug,
    runId,
    title: entry.title ?? run.title,
    url: run.url,
    stageIds: run.stageIds,
    thumb: `/api/share/${run.stageIds[0]}/card`,
    stars: entry.stars ?? 0, // Phase 09 fills these in from the solver
    position,
    license: entry.license ?? null,
  });
}
writeFileSync(resolve(outDir, 'curated-runs.json'), `${JSON.stringify(rows, null, 2)}\n`);
writeFileSync(
  resolve(outDir, 'curated.sql'),
  `${rows
    .map(
      (r) =>
        `INSERT INTO curated (run_id, title, url, thumb, stars, position) VALUES (${[r.runId, r.title, r.url, r.thumb, r.stars, r.position].map(sql).join(', ')})\n  ON CONFLICT (run_id) DO UPDATE SET title = excluded.title, url = excluded.url, thumb = excluded.thumb, stars = excluded.stars, position = excluded.position;`,
    )
    .join('\n')}\n`,
);
console.log(`\nWrote ${outDir}/curated-runs.json and ${outDir}/curated.sql. Next (by a person):`);
console.log(`  node content/scripts/render-cards.mjs <webBase> ${outDir}/curated-runs.json ${outDir}/cards`);
console.log('  wrangler d1 execute wwm --remote --file content/out/curated.sql   # from apps/worker');
