/**
 * `pnpm --filter @wwm/worker smoke <baseUrl> [url…]` — drive a running Worker (wrangler dev or deployed):
 * POST /api/stages → follow SSE → wait for every slice in /api/runs → validate each stage → fetch textures,
 * then POST again to time the cache hit. Defaults to the fixture URLs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RunResponse, validateStage } from '@wwm/schema';
import { webpSize } from '../src/image/webp.ts';
import { parseSse } from '../src/job-events.ts';

const [base = 'http://localhost:8787', ...urlsArg] = process.argv.slice(2);
const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/captures');
const urls = urlsArg.length
  ? urlsArg
  : readdirSync(fixtures)
      .filter((d) => !d.includes('.'))
      .sort()
      .map(
        (d) => (JSON.parse(readFileSync(join(fixtures, d, 'capture.json'), 'utf8')) as { url: string }).url,
      );

const post = (url: string) =>
  fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });

const rows: Record<string, unknown>[] = [];
for (const url of urls) {
  const t0 = Date.now();
  const r = await post(url);
  const body = (await r.json()) as { jobId?: string; runId?: string; code?: string; message?: string };
  if (!body.jobId) {
    rows.push({ url, status: r.status, ...body });
    continue;
  }
  const events = parseSse(await (await fetch(`${base}/api/jobs/${body.jobId}`)).text());
  const last = events.at(-1);
  const slice0Ms = Date.now() - t0;
  if (last?.type !== 'done') {
    rows.push({ url, slice0Ms, error: last });
    continue;
  }
  let run: RunResponse | undefined;
  let count = 1;
  for (let i = 0; i < 300; i++) {
    run = (await (await fetch(`${base}/api/runs/${last.runId}`)).json()) as RunResponse;
    const s0 = (await (await fetch(`${base}/api/stages/${run.stageIds[0]}`)).json()) as {
      source: { slice: { count: number } };
    };
    count = s0.source.slice.count;
    if (run.stageIds.length >= count) break;
    await new Promise((res) => setTimeout(res, 200));
  }
  const allMs = Date.now() - t0;
  let valid = 0;
  let textures = 0;
  for (const id of run?.stageIds ?? []) {
    const stage = await (await fetch(`${base}/api/stages/${id}`)).json();
    if (validateStage(stage).ok) valid++;
    const tex = new Uint8Array(await (await fetch(`${base}/api/stages/${id}/texture`)).arrayBuffer());
    const size = webpSize(tex);
    const t = (stage as { texture: { width: number; height: number } }).texture;
    if (size && size.width === t.width && size.height === t.height) textures++;
  }
  const tHit = performance.now();
  const hit = await post(url);
  const hitMs = Math.round((performance.now() - tHit) * 10) / 10;
  rows.push({
    url,
    slices: count,
    stored: run?.stageIds.length,
    valid,
    textures,
    slice0Ms,
    allMs,
    cacheHitStatus: hit.status,
    cacheHitMs: hitMs,
  });
  console.error(JSON.stringify(rows.at(-1)));
}
const ok = rows
  .flatMap((r) => (typeof r.slice0Ms === 'number' && r.valid ? [r.slice0Ms as number] : []))
  .sort((a, b) => a - b);
console.log(
  JSON.stringify({ base, p50Slice0Ms: ok[Math.floor((ok.length - 1) / 2)] ?? null, rows }, null, 2),
);
