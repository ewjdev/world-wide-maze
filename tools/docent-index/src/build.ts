/**
 * Builds the docent corpus index (contracts §10.3): `research/**`, `RESEARCH.md`, `docs/reference/**`,
 * `docs/build-log/**`, `docs/facts/**` and the `/about` history data. Every chunk is labelled with its
 * provenance (`kind`: history, plan, build-log, status, reference; see `kinds.ts`). Nothing under `reference/` (third-party 2013 material,
 * gitignored) is ever read.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { chunkMarkdown } from './chunk.ts';
import { historyChunks } from './history-chunks.ts';
import type { CorpusChunk, CorpusIndex } from './types.ts';

/** Bump when chunking or tokenizing changes in a way that should invalidate cached answers. */
export const INDEX_FORMAT = 2;

/** Where the Worker imports the index from (committed; regenerate with `pnpm docent:index`). */
export const INDEX_OUT = 'apps/worker/src/docent/corpus.json';

/** `docs/facts` is the maintained "what exists today" summary (Phase 15c). */
const ROOTS = ['research', 'RESEARCH.md', 'docs/reference', 'docs/build-log', 'docs/facts'];

function walk(root: string, rel: string): string[] {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs, { recursive: true, encoding: 'utf8' })
    .map((f) => relative(root, join(abs, f)).split(sep).join('/'))
    .filter((f) => /\.(md|json)$/.test(f) && statSync(join(root, f)).isFile());
}

/** Corpus files, repo-relative, sorted. `reference/` is excluded by construction and by this guard. */
export function corpusFiles(root: string): string[] {
  return ROOTS.flatMap((r) => walk(root, r))
    .filter((f) => !f.startsWith('reference/') && !f.includes('/assets/'))
    .sort();
}

/** Site link for a document, where the site renders it. */
export function siteUrl(path: string): string | undefined {
  const log = /^docs\/build-log\/([^/]+)\.md$/.exec(path);
  if (log) return `/log#${log[1]}`;
  if (path === 'docs/reference/fidelity-spec.md') return '/about#fidelity';
  return undefined;
}

export function buildIndex(root: string): CorpusIndex {
  const files = corpusFiles(root);
  const chunks: CorpusChunk[] = [];
  for (const path of files) {
    const raw = readFileSync(join(root, path), 'utf8');
    const url = siteUrl(path);
    chunks.push(
      ...chunkMarkdown(raw, {
        path,
        ...(url ? { url } : {}),
        fallbackTitle: path.endsWith('.json') ? `Recovery evidence record (${path})` : path,
      }),
    );
  }
  chunks.push(...historyChunks());
  const hash = createHash('sha256')
    .update(JSON.stringify([INDEX_FORMAT, chunks.map((c) => [c.id, c.title, c.url, c.kind, c.text])]))
    .digest('hex')
    .slice(0, 16);
  return { format: INDEX_FORMAT, hash, files: [...files, 'apps/web/src/pages/about/history.ts'], chunks };
}
