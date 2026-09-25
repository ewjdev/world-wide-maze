/**
 * Markdown → retrieval chunks of about 300–600 tokens (≈ 4 characters per token), one heading section at a time:
 * small neighbouring sections are merged, long ones are split at blank lines (tables and lists stay whole where
 * they fit). Every chunk keeps its document title, section heading, path and GitHub-style anchor.
 */
import type { CorpusChunk } from './types.ts';

export const MIN_TOKENS = 300;
export const MAX_TOKENS = 600;
/** Target size when a long section has to be split. */
const SPLIT_TOKENS = 480;

export const approxTokens = (s: string): number => Math.ceil(s.length / 4);

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces → hyphens. */
export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

interface Section {
  level: number;
  heading: string;
  anchor: string;
  body: string;
}

function sections(md: string): { docTitle: string; list: Section[] } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const list: Section[] = [];
  const seen = new Map<string, number>();
  let cur: Section = { level: 0, heading: '', anchor: '', body: '' };
  let docTitle = '';
  let fence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      list.push(cur);
      const heading = (h[2] ?? '').replace(/`/g, '');
      const base = slugify(heading);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      cur = { level: (h[1] ?? '#').length, heading, anchor: n ? `${base}-${n}` : base, body: '' };
      if (cur.level === 1 && !docTitle) docTitle = heading;
      continue;
    }
    cur.body += `${line}\n`;
  }
  list.push(cur);
  return { docTitle, list: list.filter((s) => s.heading || s.body.trim()) };
}

/** Split text at blank lines (then at line ends) into pieces of about `target` tokens. */
export function splitText(text: string, target = SPLIT_TOKENS): string[] {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  const pieces: string[] = [];
  let acc = '';
  const push = () => {
    if (acc.trim()) pieces.push(acc.trim());
    acc = '';
  };
  for (const block of blocks) {
    if (approxTokens(block) > MAX_TOKENS) {
      push();
      let part = '';
      for (const line of block.split('\n')) {
        if (part && approxTokens(part + line) > target) {
          pieces.push(part.trim());
          part = '';
        }
        part += `${line}\n`;
      }
      if (part.trim()) pieces.push(part.trim());
      continue;
    }
    if (acc && approxTokens(`${acc}\n\n${block}`) > target) push();
    acc = acc ? `${acc}\n\n${block}` : block;
  }
  push();
  // fold a short tail back into the previous piece when that stays within the maximum
  const last = pieces.at(-1);
  const prev = pieces.at(-2);
  if (last && prev && approxTokens(last) < MIN_TOKENS / 2 && approxTokens(`${prev}\n\n${last}`) <= MAX_TOKENS)
    pieces.splice(-2, 2, `${prev}\n\n${last}`);
  return pieces;
}

export interface ChunkOptions {
  path: string;
  /** Site link for the whole document (e.g. `/log#phase-10`), if it is rendered on the site. */
  url?: string;
  /** Title to use when the document has no `# ` heading. */
  fallbackTitle?: string;
}

export function chunkMarkdown(md: string, opts: ChunkOptions): CorpusChunk[] {
  const { docTitle, list } = sections(md);
  const doc = docTitle || opts.fallbackTitle || opts.path;
  const out: CorpusChunk[] = [];
  const ids = new Set<string>();
  const mk = (s: Section, text: string, part: number): CorpusChunk => {
    const isDoc = s.level === 0 || (s.level === 1 && s.heading === docTitle);
    const label = isDoc ? doc : `${doc} › ${s.heading}`;
    const anchor = isDoc ? undefined : s.anchor;
    let id = `${opts.path}${anchor ? `#${anchor}` : ''}${part ? `~${part + 1}` : ''}`;
    for (let k = 2; ids.has(id); k++) id = `${opts.path}${anchor ? `#${anchor}` : ''}~${part + k}`;
    ids.add(id);
    return {
      id,
      title: part ? `${label} (continued)` : label,
      path: opts.path,
      ...(anchor ? { anchor } : {}),
      ...(opts.url ? { url: opts.url } : {}),
      text,
    };
  };

  let i = 0;
  while (i < list.length) {
    const first = list[i] as Section;
    const head = (s: Section) => (s.level > 1 ? `${'#'.repeat(s.level)} ${s.heading}\n` : '');
    let text = `${head(first)}${first.body.trim()}`.trim();
    i++;
    // merge small following sections that sit at the same or a deeper level
    while (i < list.length && approxTokens(text) < MIN_TOKENS) {
      const next = list[i] as Section;
      const nextText = `${head(next)}${next.body.trim()}`.trim();
      if (next.level < first.level && first.level > 1) break;
      if (approxTokens(`${text}\n\n${nextText}`) > MAX_TOKENS) break;
      text = `${text}\n\n${nextText}`;
      i++;
    }
    if (!text) continue;
    if (approxTokens(text) <= MAX_TOKENS) {
      out.push(mk(first, text, 0));
      continue;
    }
    splitText(text).forEach((piece, p) => {
      out.push(mk(first, piece, p));
    });
  }
  return out;
}
