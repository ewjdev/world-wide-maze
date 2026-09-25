/**
 * Share page HTML and parameter helpers (Phase 10). Pure: no Worker types, so they are unit-testable in Node.
 * Routes: src/routes/share.ts.
 */
export const cardKey = (stageId: string) => `share/${stageId}.png`;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ESC[ch] ?? ch);

export interface ShareMeta {
  stageId: string;
  title: string;
  siteUrl: string;
  slice: { index: number; count: number };
  beat: number | null;
  by: string | null;
  origin: string;
}

/** Parse `beat`/`by` defensively: they end up in HTML and in the play URL. */
export function shareParams(q: URLSearchParams): { beat: number | null; by: string | null } {
  const b = Number(q.get('beat'));
  const beat = q.has('beat') && Number.isInteger(b) && b >= 0 && b < 1e9 ? b : null;
  const by = q.get('by');
  return { beat, by: by && /^[a-z0-9_]{1,32}$/.test(by) ? by : null };
}

export function playPath(m: Pick<ShareMeta, 'stageId' | 'beat' | 'by'>): string {
  const q = new URLSearchParams();
  if (m.beat !== null) q.set('beat', String(m.beat));
  if (m.by) q.set('by', m.by);
  const qs = q.toString();
  return `/play/${m.stageId}${qs ? `?${qs}` : ''}`;
}

export function shareHtml(m: ShareMeta): string {
  const host = (() => {
    try {
      return new URL(m.siteUrl).hostname;
    } catch {
      return m.siteUrl;
    }
  })();
  const part = m.slice.count > 1 ? ` (part ${m.slice.index + 1} of ${m.slice.count})` : '';
  const title =
    m.beat !== null
      ? `Beat ${m.by ?? 'my'}${m.by ? '’s' : ''} ${m.beat.toLocaleString('en-US')} points on ${m.title}${part}`
      : `${m.title}${part} as a World Wide Maze`;
  const desc = `${host} turned into a 3D island maze. Roll the ball to the goal by tilting your phone, or use the keyboard.`;
  const play = `${m.origin}${playPath(m)}`;
  const img = `${m.origin}/api/share/${m.stageId}/card`;
  const e = escapeHtml;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${e(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${e(desc)}">
<link rel="canonical" href="${e(`${m.origin}/s/${m.stageId}`)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="World Wide Maze (tribute)">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(desc)}">
<meta property="og:url" content="${e(`${m.origin}/s/${m.stageId}`)}">
<meta property="og:image" content="${e(img)}">
<meta property="og:image:alt" content="${e(`The ${host} page rebuilt as floating islands joined by bridges`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(desc)}">
<meta name="twitter:image" content="${e(img)}">
<meta http-equiv="refresh" content="0; url=${e(play)}">
<style>body{font:16px/1.5 system-ui,sans-serif;margin:3rem auto;max-width:36rem;padding:0 1rem;color:#16181d;background:#f7f6f2}a{color:#0b6f79}</style>
</head><body>
<h1>${e(title)}</h1>
<p>${e(desc)}</p>
<p><a href="${e(play)}">Play this maze</a></p>
</body></html>`;
}
