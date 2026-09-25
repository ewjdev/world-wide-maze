/**
 * Share cards (Phase 18): the `/j/<trail>` payload (Phase 13, apps/web/src/game/journey.ts `encodeJourney`),
 * decoded and distrusted for a card. Pure.
 *
 * The payload is written by the sharer's browser, so nothing in it is trusted:
 * - only hosts are drawn (never the free-text titles), each checked for shape and the name profanity filter;
 * - the name must pass the leaderboard name rules, else the card has no name;
 * - the total is shown only when it is plausible (≤ PER_SITE_MAX per stop) and is never labelled verified.
 * The loader replaces the host of every stop whose ref is a server stage with the stage's real host.
 */
import { checkName, isProfane } from '../routes/scores-rules.ts';

export const MAX_STOPS = 12;
/** Stops drawn on a card: the first DRAWN − 1 and the last. */
export const DRAWN_STOPS = 5;
/**
 * Generous ceiling for one site's points in a journey: a site is ≤ a handful of slices, each worth at most its
 * items plus 5 × 300 s of time bonus (contracts §1). Totals above stops × this are not drawn.
 */
export const PER_SITE_MAX = 20_000;

const HOST_RE =
  /^(?=.{1,80}$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/;
const HEX64 = /^[0-9a-f]{64}$/;

export interface TrailStop {
  host: string;
  /** Server stage id when the stop was a server-built stage. */
  stageId: string | null;
}

export interface Trail {
  stops: TrailStop[];
  total: number | null;
  name: string | null;
}

function b64urlDecode(s: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,4000}$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** A host fit to print, or null. */
export function safeHost(h: string): string | null {
  const host = h.toLowerCase().replace(/^www\./, '');
  if (!HOST_RE.test(host)) return null;
  if (isProfane(host.replace(/[.-]/g, '_'))) return null;
  return host;
}

export function decodeTrail(trail: string): Trail | null {
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
  if (o.v !== 1 || !Array.isArray(o.s) || o.s.length < 1 || o.s.length > MAX_STOPS) return null;
  const stops: TrailStop[] = [];
  for (const row of o.s) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') return null;
    const host = safeHost(row[0]) ?? 'another site';
    const ref = typeof row[2] === 'string' && HEX64.test(row[2]) ? row[2] : null;
    stops.push({ host, stageId: ref });
  }
  const p = o.p;
  const total =
    typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= stops.length * PER_SITE_MAX ? p : null;
  const name = typeof o.n === 'string' && checkName(o.n).ok ? o.n : null;
  return { stops, total, name };
}

/** The hosts a card draws (first DRAWN − 1 and the last) and how many are left out. */
export function drawnHosts(hosts: string[]): { hosts: string[]; more: number } {
  if (hosts.length <= DRAWN_STOPS) return { hosts, more: 0 };
  return {
    hosts: [...hosts.slice(0, DRAWN_STOPS - 1), hosts[hosts.length - 1] as string],
    more: hosts.length - DRAWN_STOPS,
  };
}

/**
 * The portal colour of a host (same pick as `portalColor` in @wwm/engine and `hostColor` in the web app's
 * journey.ts, duplicated here so the Worker doesn't import the web app).
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

/** The monogram shown in place of a favicon (no third-party requests), as on the portal gates. */
export function monogram(host: string): string {
  return (host.replace(/^(en|ja|de|fr|m|mobile|blog|news|www\d?)\./, '')[0] ?? '?').toUpperCase();
}
