/**
 * `pnpm docent:index`: rebuild apps/worker/src/docent/corpus.json from the repo's research and build record.
 * `--check` exits 1 when the committed index is stale instead of writing it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, INDEX_OUT } from '../build.ts';
import { approxTokens } from '../chunk.ts';
import type { CorpusIndex } from '../types.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const out = join(root, INDEX_OUT);
const index = buildIndex(root);

if (process.argv.includes('--check')) {
  let current: CorpusIndex | null = null;
  try {
    current = JSON.parse(readFileSync(out, 'utf8')) as CorpusIndex;
  } catch {
    // missing
  }
  if (current?.hash !== index.hash) {
    console.error(
      `docent index is stale (${current?.hash ?? 'missing'} → ${index.hash}); run pnpm docent:index`,
    );
    process.exit(1);
  }
  console.log(`docent index up to date (${index.hash})`);
  process.exit(0);
}

writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`);
// keep the committed file in Biome's format so `pnpm lint` stays green
execFileSync('pnpm', ['exec', 'biome', 'format', '--write', out], { cwd: root, stdio: 'ignore' });

const sizes = index.chunks.map((c) => approxTokens(c.text)).sort((a, b) => a - b);
const pct = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor(p * sizes.length))];
console.log(
  `docent index ${index.hash}: ${index.files.length} files → ${index.chunks.length} chunks; ` +
    `≈tokens p10 ${pct(0.1)}, median ${pct(0.5)}, p90 ${pct(0.9)}, max ${sizes.at(-1)} → ${INDEX_OUT}`,
);
