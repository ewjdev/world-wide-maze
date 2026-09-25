/**
 * `pnpm --filter @wwm/worker bench [slug…]` — cold capture+build timings on the fixture URLs
 * (fixtures/captures/<slug>/capture.json `url`) through the real pipeline: local Chromium (DPR 2), real
 * DoH SSRF checks, PNG decode, the injected builder (STUB until Phase 03 merges), validateStage, and an
 * in-memory store. "Cold" = nothing cached; one browser process is reused across URLs, as Browser Run
 * session reuse does in production (the first row includes the browser launch).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultStageBuilder } from '../src/builder.ts';
import { defaultSeed, runCacheKey } from '../src/ids.ts';
import { silentLogger } from '../src/log.ts';
import { runBuildJob } from '../src/pipeline.ts';
import { createDohResolver } from '../src/policy/dns.ts';
import { checkUrl } from '../src/policy/url-policy.ts';
import { LocalChromiumCapturer } from './local-chromium.ts';
import { MemoryStore } from './memory-store.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/captures');
const only = process.argv.slice(2);
const slugs = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (only.length === 0 || only.includes(d.name)))
  .map((d) => d.name)
  .sort();

const resolver = createDohResolver();
const capturer = new LocalChromiumCapturer({ guard: { resolver } });
const builder = defaultStageBuilder();
const rows: Record<string, unknown>[] = [];

for (const slug of slugs) {
  const { url } = JSON.parse(readFileSync(join(root, slug, 'capture.json'), 'utf8')) as { url: string };
  const t0 = Date.now();
  const policy = await checkUrl(url, { resolver });
  const tPolicy = Date.now() - t0;
  if (!policy.ok) {
    rows.push({ slug, url, error: `URL_FORBIDDEN ${policy.reason}` });
    continue;
  }
  const store = new MemoryStore();
  const events: string[] = [];
  let slice0At = 0;
  const res = await runBuildJob(
    {
      jobId: slug,
      url: policy.url,
      difficulty: 'normal',
      seed: defaultSeed(policy.url),
      cacheKey: runCacheKey(policy.url, 'normal', builder.version),
    },
    { capturer, builder, moderate: async () => 'ok', store, log: silentLogger },
    (e) => {
      if (e.type === 'done') slice0At = Date.now();
      events.push(
        e.type === 'progress' ? e.step : e.type === 'error' ? `error:${e.code}:${e.message}` : 'done',
      );
    },
  );
  const t = res?.timingsMs ?? {};
  rows.push({
    slug,
    url,
    slices: res?.stageIds.length ?? 0,
    policyMs: tPolicy,
    slice0Ms: slice0At ? slice0At - t0 : null,
    totalMs: Date.now() - t0,
    captureMs: t.capture,
    navigateMs: t['capture.navigate'],
    prepExtractShotMs: t['capture.prepareExtractScreenshot'],
    texturesMs: t['capture.textures'],
    decodeMs: t.decode,
    build0Ms: t['build.0'],
    error: res ? undefined : events.at(-1),
  });
  console.error(`${slug}: ${JSON.stringify(rows.at(-1))}`);
}
await capturer.close();

const ok = rows
  .filter((r) => typeof r.slice0Ms === 'number')
  .map((r) => r.slice0Ms as number)
  .sort((a, b) => a - b);
const p50 = ok.length ? ok[Math.floor((ok.length - 1) / 2)] : null;
console.log(
  JSON.stringify({ at: new Date().toISOString(), builder: builder.version, p50Slice0Ms: p50, rows }, null, 2),
);
