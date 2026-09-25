#!/usr/bin/env node
/**
 * Export an offline pack of one run: every slice's StageData plus its texture, with texture paths rewritten to
 * the local files, and a manifest. The pack plays without the capture service (the preservation goal).
 *
 *   node content/scripts/export-pack.mjs <apiBase> <runId> [outDir=content/out/packs]
 *
 * Packs contain screenshots of third-party pages: keep them out of git (content/out is ignored) and ship them
 * only under the page's licence / permission recorded in content/curated.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [api, runId, outRoot = 'content/out/packs'] = process.argv.slice(2);
if (!api || !/^[0-9a-f]{64}$/.test(runId ?? '')) {
  console.error('usage: export-pack.mjs <apiBase> <runId> [outDir]');
  process.exit(2);
}
const get = async (path) => {
  const r = await fetch(`${api}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r;
};
const run = await (await get(`/api/runs/${runId}`)).json();
const dir = resolve(outRoot, runId);
mkdirSync(dir, { recursive: true });
const stages = [];
for (const [i, stageId] of run.stageIds.entries()) {
  const stage = await (await get(`/api/stages/${stageId}`)).json();
  const tex = await get(`/api/stages/${stageId}/${stage.texture.path.split('/').pop()}`);
  const ext = (tex.headers.get('content-type') ?? '').includes('png') ? 'png' : 'webp';
  const texFile = `stage-${i}.${ext}`;
  writeFileSync(resolve(dir, texFile), Buffer.from(await tex.arrayBuffer()));
  writeFileSync(
    resolve(dir, `stage-${i}.json`),
    `${JSON.stringify({ ...stage, texture: { ...stage.texture, path: texFile } })}\n`,
  );
  stages.push({ stageId, file: `stage-${i}.json`, texture: texFile });
}
writeFileSync(
  resolve(dir, 'manifest.json'),
  `${JSON.stringify({ schema: 'wwm.pack/1', runId, url: run.url, title: run.title, exportedAt: new Date().toISOString(), stages }, null, 2)}\n`,
);
console.log(`${dir}: ${stages.length} stage(s)`);
