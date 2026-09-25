/**
 * Web journeys (Phase 13, N; contracts §10.1). A journey is the chain of sites a session rolled through: every
 * stop is a site whose maze was played, and consecutive stops are joined by a link portal (or by a trip back to
 * site select). The score and spare balls carry over from stop to stop; the whole journey is one run.
 *
 * Sharing: `/j/<base64url(JSON)>`, a compact, validated list of stops with their `/play/<ref>` deep links, so a
 * friend can open the trail and start from any stop. Nothing personal goes in it unless the player adds a name.
 */
import { type CatalogEntry, FIXTURES } from './catalog.ts';

export type JourneyVia = 'start' | 'portal' | 'select';

export interface JourneyStop {
  /** Host shown in the trail (no `www.`). */
  host: string;
  /** Link text of the portal that led here, or the page title once known. */
  title: string;
  url: string;
  /** `/play/<ref>` of the stop's first stage (null until it loaded). */
  ref: string | null;
  via: JourneyVia;
}

/** What a share link carries (v1). */
export interface SharedJourney {
  stops: { host: string; title: string; ref: string | null }[];
  total: number | null;
  name: string | null;
}

export const MAX_SHARED_STOPS = 12;
const TITLE_MAX = 48;
const REF_RE = /^(?:practice|fixture-[a-z0-9-]{1,40}(?:~\d{1,2})?|[0-9a-f]{16,64})$/;
const HOST_RE = /^[a-z0-9.-]{1,80}$/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Journeys worth showing: at least one portal was taken. */
export function isJourney(stops: readonly JourneyStop[]): boolean {
  return stops.some((s) => s.via === 'portal');
}

/** Normalized comparison key (scheme-less, no trailing slash, no `www.`, no fragment). */
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url;
  }
}

/** A portal whose target is one of the offline fixture pages travels there without the capture service. */
export function fixtureFor(href: string): CatalogEntry | undefined {
  const k = urlKey(href);
  return FIXTURES.find((f) => urlKey(f.url) === k);
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,4000}$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** `/j/<trail>` payload for a journey (the last MAX_SHARED_STOPS stops). */
export function encodeJourney(
  stops: readonly JourneyStop[],
  opts: { total?: number; name?: string } = {},
): string {
  const tail = stops.slice(-MAX_SHARED_STOPS);
  const payload: { v: 1; s: [string, string, string?][]; p?: number; n?: string } = {
    v: 1,
    s: tail.map((s) => {
      const row: [string, string, string?] = [s.host, clip(s.title, TITLE_MAX)];
      if (s.ref && REF_RE.test(s.ref)) row.push(s.ref);
      return row;
    }),
  };
  if (opts.total !== undefined && Number.isFinite(opts.total))
    payload.p = Math.max(0, Math.round(opts.total));
  if (opts.name) payload.n = clip(opts.name, 32);
  return b64urlEncode(JSON.stringify(payload));
}

export function journeyUrl(
  origin: string,
  stops: readonly JourneyStop[],
  opts?: { total?: number; name?: string },
) {
  return `${origin}/j/${encodeJourney(stops, opts)}`;
}

/** Parse and validate a `/j/<trail>` payload; null if it isn't one. */
export function decodeJourney(trail: string): SharedJourney | null {
  const json = b64urlDecode(trail);
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { v?: unknown; s?: unknown; p?: unknown; n?: unknown };
  if (o.v !== 1 || !Array.isArray(o.s) || o.s.length < 1 || o.s.length > MAX_SHARED_STOPS) return null;
  const stops: SharedJourney['stops'] = [];
  for (const row of o.s) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string') return null;
    const host = row[0].toLowerCase();
    if (!HOST_RE.test(host)) return null;
    const ref = typeof row[2] === 'string' && REF_RE.test(row[2]) ? row[2] : null;
    stops.push({ host, title: clip(row[1], TITLE_MAX), ref });
  }
  const total = typeof o.p === 'number' && Number.isInteger(o.p) && o.p >= 0 && o.p < 1e9 ? o.p : null;
  const name = typeof o.n === 'string' && o.n.trim() ? clip(o.n, 32) : null;
  return { stops, total, name };
}

/**
 * The portal colour of a target host: the same pick as `portalColor` in @wwm/engine (tested), duplicated so the
 * share page doesn't load the renderer. 2013 colour roles plus a violet.
 */
export const PORTAL_COLORS = ['#4f9fd6', '#31a4ae', '#e0524f', '#e5a810', '#3f9a4c', '#8e6fd8'] as const;
export function hostColor(host: string): string {
  let h = 0x811c9dc5;
  const s = host.replace(/^www\./, '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PORTAL_COLORS[(h >>> 0) % PORTAL_COLORS.length] as string;
}

/** The monogram letter shown in place of a favicon (no third-party requests). */
export function monogram(host: string): string {
  return (host.replace(/^(en|ja|de|fr|m|mobile|blog|news|www\d?)\./, '')[0] ?? '?').toUpperCase();
}
