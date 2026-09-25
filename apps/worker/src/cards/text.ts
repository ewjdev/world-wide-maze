/**
 * Share cards (Phase 18): text safety and layout. Pure.
 *
 * Every string that reaches a card goes through `cleanText` (control, bidi-override and invisible characters
 * removed, whitespace collapsed, length capped) and is escaped with `escapeXml` when written into the SVG.
 */
import type { FontMetrics } from './font.ts';

const XML_ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for SVG content and attribute values, and drops characters XML 1.0 forbids. */
export function escapeXml(s: string): string {
  return (
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: exactly the characters XML 1.0 forbids
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
      .replace(/[&<>"']/g, (ch) => XML_ESC[ch] ?? ch)
  );
}

/**
 * Normalises untrusted display text: NFC, no C0/C1 controls, no bidi overrides/isolates (U+202A–202E,
 * U+2066–2069: they can reverse what a card appears to say), no zero-width or other invisible format
 * characters, whitespace collapsed, at most `max` code points (with an ellipsis).
 */
export function cleanText(s: string, max: number): string {
  const t = s
    .normalize('NFC')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: C0/C1 controls are exactly what this removes
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cps = [...t];
  return cps.length > max
    ? `${cps
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
    : t;
}

/** Display host of a URL: lowercase, no `www.`, ASCII (punycode stays punycode). Empty when not a URL. */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .slice(0, 80);
  } catch {
    return '';
  }
}

/**
 * Text the card fonts can draw: the characters both headline faces (Unbounded Bold, Figtree ExtraBold subsets in
 * src/cards/fonts) have, i.e. most of Latin-1 and Latin Extended-A, dashes, quotes, bullets, the ellipsis and
 * arrows (test/cards.test.ts checks every one). Anything else (CJK titles, emoji) makes the card use the host.
 */
export const CARD_TEXT_RE =
  /^[\u0020-\u007E\u00A0-\u00AC\u00AE-\u00B4\u00B6-\u0113\u0116-\u0127\u012A-\u012B\u012E-\u0137\u0139-\u013E\u0141-\u0148\u014A-\u014D\u0150-\u0161\u0164-\u0165\u016A-\u017E\u2013-\u2014\u2018-\u201A\u201C-\u201E\u2020-\u2022\u2026\u2039-\u203A\u2190-\u2193]*$/;

/** Title as drawn: cleaned, capped, and '' when the card fonts can't draw it (then the host is used). */
export function cardTitle(title: string, host: string): string {
  const t = cleanText(title, 90);
  if (!t || !CARD_TEXT_RE.test(t) || t.toLowerCase() === host) return '';
  return t;
}

/** A font at a pixel size, plus the SVG attributes that select it in resvg. */
export interface Face {
  font: FontMetrics;
  weight: number;
}

export function covers(font: FontMetrics, text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp === 0x20) continue;
    if (font.advance(cp) === null) return false;
  }
  return true;
}

/** Width of `text` at `size` px (advances only; missing glyphs count as 0.6 em). */
export function measure(font: FontMetrics, text: string, size: number, tracking = 0): number {
  let w = 0;
  let n = 0;
  for (const ch of text) {
    const a = font.advance(ch.codePointAt(0) as number);
    w += a === null ? font.unitsPerEm * 0.6 : a;
    n++;
  }
  return (w * size) / font.unitsPerEm + Math.max(0, n - 1) * tracking * size;
}

/** `text` cut to fit `maxW` with a trailing ellipsis (unchanged if it fits). */
export function ellipsize(font: FontMetrics, text: string, size: number, maxW: number, tracking = 0): string {
  if (measure(font, text, size, tracking) <= maxW) return text;
  const cps = [...text];
  let lo = 0;
  let hi = cps.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const s = `${cps.slice(0, mid).join('').trimEnd()}…`;
    if (measure(font, s, size, tracking) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '…' : `${cps.slice(0, lo).join('').trimEnd()}…`;
}

/**
 * Greedy word wrap into at most `maxLines` lines of width ≤ `maxW`. Words longer than a line are broken
 * (hosts and URLs have no spaces). `overflow` is true when the text had to be truncated (last line ellipsized).
 */
export function wrap(
  font: FontMetrics,
  text: string,
  size: number,
  maxW: number,
  maxLines: number,
  tracking = 0,
): { lines: string[]; overflow: boolean } {
  const fits = (s: string) => measure(font, s, size, tracking) <= maxW;
  const words = text.split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  let i = 0;
  while (i < words.length) {
    const w = words[i] as string;
    const next = cur ? `${cur} ${w}` : w;
    if (fits(next)) {
      cur = next;
      i++;
      continue;
    }
    if (!cur) {
      // a single word wider than the line: break it by characters
      const cps = [...w];
      let k = cps.length;
      while (k > 1 && !fits(cps.slice(0, k).join(''))) k--;
      lines.push(cps.slice(0, k).join(''));
      words[i] = cps.slice(k).join('');
    } else {
      lines.push(cur);
      cur = '';
    }
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) {
    lines.push(cur);
    cur = '';
  }
  const rest = [cur, ...words.slice(i)].filter(Boolean).join(' ');
  if (!rest) return { lines, overflow: false };
  const last = lines.length ? `${lines.pop() as string} ${rest}` : rest;
  lines.push(ellipsize(font, last, size, maxW, tracking));
  return { lines, overflow: true };
}

/**
 * The largest size in `sizes` (descending) at which `text` wraps into `maxLines` without truncation. Multi-line
 * results are balanced (like CSS `text-wrap: balance`): the narrowest width that keeps the same line count, so
 * no line ends with a lone word.
 */
export function fit(
  font: FontMetrics,
  text: string,
  opts: { sizes: number[]; maxW: number; maxLines: number; tracking?: number },
): { size: number; lines: string[]; overflow: boolean } {
  let last: { size: number; lines: string[]; overflow: boolean } | null = null;
  for (const size of opts.sizes) {
    const r = wrap(font, text, size, opts.maxW, opts.maxLines, opts.tracking);
    last = { size, ...r };
    if (r.overflow) continue;
    if (r.lines.length < 2) return last;
    let lo = opts.maxW * 0.4;
    let hi = opts.maxW;
    let best = r.lines;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const t = wrap(font, text, size, mid, opts.maxLines, opts.tracking);
      // same line count, and no word broken apart
      if (!t.overflow && t.lines.length === r.lines.length && t.lines.join(' ') === r.lines.join(' ')) {
        best = t.lines;
        hi = mid;
      } else lo = mid;
    }
    return { size, lines: best, overflow: false };
  }
  return last ?? { size: 0, lines: [], overflow: true };
}

/** 1484 → "1,484" (cards are English: crawlers don't send a language). */
export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
