/**
 * Markdown → retrieval chunks of about 300–600 tokens (≈ 4 characters per token), one heading section at a time:
 * small neighbouring sections are merged, long ones are split at blank lines (tables and lists stay whole where
 * they fit). Every chunk keeps its document title, heading trail, path, GitHub-style anchor and provenance `kind`;
 * sections of different kinds are never merged.
 */
import { sourceKind } from './kinds.ts';
import type { CorpusChunk, SourceKind } from './types.ts';

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
  /** Enclosing headings, outermost first (the document title excluded). */
  parents: string[];
  body: string;
}

function sections(md: string): { docTitle: string; list: Section[] } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const list: Section[] = [];
  const seen = new Map<string, number>();
  let cur: Section = { level: 0, heading: '', anchor: '', parents: [], body: '' };
  let docTitle = '';
  let fence = false;
  const stack: { level: number; heading: string }[] = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      list.push(cur);
      const heading = (h[2] ?? '').replace(/`/g, '');
      const level = (h[1] ?? '#').length;
      const base = slugify(heading);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      while (stack.length && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
      const isDocTitle = level === 1 && !docTitle;
      cur = {
        level,
        heading,
        anchor: n ? `${base}-${n}` : base,
        parents: stack.map((s) => s.heading),
        body: '',
      };
      if (isDocTitle) docTitle = heading;
      else stack.push({ level, heading });
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
  /** Provenance of a section from its heading trail; default `sourceKind(path, trail)`. */
  kindOf?: (trail: string[]) => SourceKind;
}

/** A line that is only bold text (`**Stage builder algorithm (the heart of it)**`): a heading in all but name. */
const PSEUDO_HEADING = /^\*\*([^*\n]{2,90})\*\*:?[ \t]*$/gm;

export function chunkMarkdown(md: string, opts: ChunkOptions): CorpusChunk[] {
  const { docTitle, list } = sections(md);
  const doc = docTitle || opts.fallbackTitle || opts.path;
  const kindOf = opts.kindOf ?? ((trail: string[]) => sourceKind(opts.path, trail));
  const out: CorpusChunk[] = [];
  const ids = new Set<string>();
  const isDoc = (s: Section) => s.level === 0 || (s.level === 1 && s.heading === docTitle);
  const trail = (s: Section) => (isDoc(s) ? [] : [...s.parents, s.heading]);
  const mk = (
    s: Section,
    merged: string[],
    kind: SourceKind,
    text: string,
    part: number,
    split: boolean,
  ): CorpusChunk => {
    // "Document › Part › Section", plus the headings of small sections merged into it
    let label = [doc, ...trail(s)].join(' › ');
    if (merged.length) label += ` · ${merged.join(' · ')}`;
    // a split piece names the bold pseudo-headings it contains ("Stage builder algorithm"), which splitting hides
    const pseudo = split ? [...text.matchAll(PSEUDO_HEADING)].map((m) => (m[1] ?? '').trim()) : [];
    const startsWithPseudo = split && /^\*\*[^*\n]+\*\*:?[ \t]*(\n|$)/.test(text);
    if (pseudo.length) label += ` › ${pseudo.join(' · ')}`;
    const anchor = isDoc(s) ? undefined : s.anchor;
    let id = `${opts.path}${anchor ? `#${anchor}` : ''}${part ? `~${part + 1}` : ''}`;
    for (let k = 2; ids.has(id); k++) id = `${opts.path}${anchor ? `#${anchor}` : ''}~${part + k}`;
    ids.add(id);
    return {
      id,
      title: part && !startsWithPseudo ? `${label} (continued)` : label,
      path: opts.path,
      ...(anchor ? { anchor } : {}),
      ...(opts.url ? { url: opts.url } : {}),
      kind,
      text,
    };
  };

  let i = 0;
  while (i < list.length) {
    const first = list[i] as Section;
    const kind = kindOf(trail(first));
    const head = (s: Section) => (s.level > 1 ? `${'#'.repeat(s.level)} ${s.heading}\n` : '');
    let text = `${head(first)}${first.body.trim()}`.trim();
    const merged: string[] = [];
    i++;
    // merge small following sections that sit at the same or a deeper level and have the same provenance
    while (i < list.length && approxTokens(text) < MIN_TOKENS) {
      const next = list[i] as Section;
      const nextText = `${head(next)}${next.body.trim()}`.trim();
      if (next.level < first.level && first.level > 1) break;
      if (kindOf(trail(next)) !== kind) break;
      if (approxTokens(`${text}\n\n${nextText}`) > MAX_TOKENS) break;
      text = `${text}\n\n${nextText}`;
      if (!isDoc(next)) merged.push(next.heading);
      i++;
    }
    if (!text) continue;
    if (approxTokens(text) <= MAX_TOKENS) {
      out.push(mk(first, merged, kind, text, 0, false));
      continue;
    }
    splitText(text).forEach((piece, p) => {
      out.push(mk(first, merged, kind, piece, p, true));
    });
  }
  return out;
}
