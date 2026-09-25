/**
 * Share pages (Phase 10, Phase 18): link-preview HTML and parameter helpers. Pure: no Worker types, so they are
 * unit-testable in Node. Routes: src/routes/share.ts.
 *
 * Two shapes:
 * - `sharePage()`: a tiny crawler-readable page (Open Graph + Twitter tags) that sends people on with a meta
 *   refresh (`/s/…`, `/r/…`).
 * - `injectMeta()`: the web app's own `index.html` with its preview tags replaced, for SPA routes that have their
 *   own card (`/`, `/log`, `/j/…`): crawlers read the tags, people get the app.
 */
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ESC[ch] ?? ch);

export const SITE_NAME = 'World Wide Maze (tribute)';

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute canonical URL of the page (also og:url). */
  canonical: string;
  image: { url: string; alt: string; width: number; height: number };
}

/** Parse `beat`/`by` defensively: they end up in the play URL (never on a card). */
export function shareParams(q: URLSearchParams): { beat: number | null; by: string | null } {
  const b = Number(q.get('beat'));
  const beat = q.has('beat') && Number.isInteger(b) && b >= 0 && b < 1e9 ? b : null;
  const by = q.get('by');
  return { beat, by: by && /^[a-z0-9_]{1,32}$/.test(by) ? by : null };
}

export function playPath(m: { stageId: string; beat: number | null; by: string | null }): string {
  const q = new URLSearchParams();
  if (m.beat !== null) q.set('beat', String(m.beat));
  if (m.by) q.set('by', m.by);
  const qs = q.toString();
  return `/play/${m.stageId}${qs ? `?${qs}` : ''}`;
}

/** The `<title>`, description, canonical, Open Graph and Twitter tags for a page. */
export function metaTags(m: PageMeta): string {
  const e = escapeHtml;
  return [
    `<title>${e(m.title)}</title>`,
    `<meta name="description" content="${e(m.description)}">`,
    `<link rel="canonical" href="${e(m.canonical)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${e(SITE_NAME)}">`,
    `<meta property="og:title" content="${e(m.title)}">`,
    `<meta property="og:description" content="${e(m.description)}">`,
    `<meta property="og:url" content="${e(m.canonical)}">`,
    `<meta property="og:image" content="${e(m.image.url)}">`,
    '<meta property="og:image:type" content="image/png">',
    `<meta property="og:image:width" content="${m.image.width}">`,
    `<meta property="og:image:height" content="${m.image.height}">`,
    `<meta property="og:image:alt" content="${e(m.image.alt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${e(m.title)}">`,
    `<meta name="twitter:description" content="${e(m.description)}">`,
    `<meta name="twitter:image" content="${e(m.image.url)}">`,
    `<meta name="twitter:image:alt" content="${e(m.image.alt)}">`,
  ].join('\n');
}

/**
 * A crawler-readable page that forwards people to `next` (same origin path) with a meta refresh; `next = null`
 * forwards nowhere (local dev without the web app's assets). No scripts (the share-page CSP allows none).
 */
export function sharePage(m: PageMeta, next: string | null, linkText: string): string {
  const e = escapeHtml;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${metaTags(m)}
${next ? `<meta http-equiv="refresh" content="0; url=${e(next)}">` : ''}
<style>body{font:16px/1.5 system-ui,sans-serif;margin:3rem auto;max-width:36rem;padding:0 1rem;color:#16181d;background:#f8f8f8}a{color:#0b6f79}</style>
</head><body>
<h1>${e(m.title)}</h1>
<p>${e(m.description)}</p>
${next ? `<p><a href="${e(next)}">${e(linkText)}</a></p>` : ''}
</body></html>`;
}

/**
 * The SPA shell with this page's preview tags: drops the shell's own title, description, canonical, og:* and
 * twitter:* tags and puts `metaTags(m)` before `</head>`. Everything else (scripts, styles) is untouched.
 */
export function injectMeta(indexHtml: string, m: PageMeta): string {
  const stripped = indexHtml
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(?:property="og:[^"]*"|name="(?:twitter:[^"]*|description)")[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '');
  const at = stripped.search(/<\/head>/i);
  if (at < 0) return stripped;
  return `${stripped.slice(0, at)}${metaTags(m)}\n${stripped.slice(at)}`;
}
