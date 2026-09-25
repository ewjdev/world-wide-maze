/**
 * Step 10c (Phase 13, N): link portals (contracts §10.1). Links on the page become portals to the linked site's
 * maze. Up to `MAX_PORTALS` per stage, chosen from the slice's link elements that carry an `href`:
 *
 * - **Eligible:** http(s) target, not the page itself, not a file download, a readable label (≥ 3 characters,
 *   not a citation mark, a counter or chrome such as "login", "hide", "12 comments", "3 hours ago").
 * - **Preferred:** off-site targets (a new site is the point of a journey), then longer, well-labelled links,
 *   then bigger type. Distinct targets only; a second link to an already chosen host scores lower, so one page
 *   offers several destinations. A small seeded jitter breaks ties, so the choice is deterministic per seed.
 * - **Placed** on the island built from the link (the island covering most of its rect), as close to the
 *   link's centre as possible: on ground the ball can roll to (the 03b walkable raster after the reachability
 *   audit), clear of the island edge (≥ a ball radius, preferably most of the portal radius), ≥ 4 D from the
 *   start and the goal, ≥ 2 D from bridge and lift mouths and large items, and ≥ 6 D from other portals.
 *
 * Small items inside a portal's ring are removed by the caller (they would sit inside the gate).
 */
import {
  BALL_RADIUS_PX,
  distanceToPolygonEdge,
  MAX_PORTALS,
  PORTAL_LABEL_MAX,
  PORTAL_RADIUS_M,
  type Portal,
  PX_PER_METER,
  pointInPolygon,
  type Rng,
  type Vec2,
} from '@wwm/schema';
import type { IslandShape } from './bridges.ts';
import { D } from './params.ts';
import type { SliceElement } from './slice-elements.ts';

export const PORTAL_RADIUS_PX = PORTAL_RADIUS_M * PX_PER_METER;

/** Labels that are page chrome or counters, not destinations (en + a few ja). */
const JUNK_LABEL =
  /^(log ?in|log ?out|sign ?(in|up|out)|register|subscribe|privacy( policy)?|cookies?( settings| policy)?|terms( of (use|service))?|donate|hide|edit( source)?|reply|flag|more|next|prev(ious)?|back|skip to .*|menu|home|contact( us)?|help|faq|rss|share|print|top|back to top|discuss|past|new|submit|comments?|web|jump to .*|create (an )?account|translate( this page)?|read more|see more|view all|ログイン|ホーム|もっと見る|次へ|前へ)$/i;
const COUNTER_LABEL =
  /^(\[?\d+\]?|\[[a-z]\]|\d+\s*(comments?|points?|replies|hours?|minutes?|days?|mins?|hrs?)(\s+ago)?|\d+\s+\w+\s+ago|↑|↓|▲|▼|#)$/i;
/** Wiki-style meta pages (help, policy, special, templates, files, categories, user pages). */
const META_PATH =
  /\/(?:wiki\/)?(?:Help|Wikipedia|Commons|Special|Template|Template_talk|Talk|File|Category|Portal|User|User_talk|MediaWiki|Module|Draft):/i;
/** Labels that still work as destinations but are rarely where a player wants to go. */
const DULL_LABEL =
  /\b(sign in|log ?in|privacy|cookies?|licen[cs]e|copyright|©|report (a|an)? ?(problem|issue)|feedback|terms)\b/i;
const FILE_HREF =
  /\.(pdf|zip|gz|tgz|bz2|7z|rar|png|jpe?g|gif|webp|svg|mp[34]|mov|avi|exe|dmg|pkg|msi|apk|iso|csv|xlsx?|docx?|pptx?)(\?|$)/i;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** A link label as shown on the portal: whitespace collapsed, ≤ PORTAL_LABEL_MAX characters. */
export function portalLabel(text: string | undefined): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > PORTAL_LABEL_MAX ? `${t.slice(0, PORTAL_LABEL_MAX - 1).trimEnd()}…` : t;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** http(s), no credentials, ≤ 2048 chars (contracts §10.1 URL policy shape). */
export function portalHrefOk(href: string, pageUrl: string): boolean {
  if (href.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return false;
  if (FILE_HREF.test(u.pathname)) return false;
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // malformed escapes: test the raw path
  }
  if (META_PATH.test(path)) return false;
  try {
    const p = new URL(pageUrl);
    p.hash = '';
    u.hash = '';
    if (p.toString() === u.toString()) return false;
  } catch {
    // unparsable page url: nothing to compare
  }
  return true;
}

export interface PortalCandidate {
  element: SliceElement;
  href: string;
  label: string;
  host: string;
  offsite: boolean;
  score: number;
}

/** Eligible link elements of the slice, best first (before placement). */
export function rankPortalCandidates(
  elements: readonly SliceElement[],
  pageUrl: string,
  rng: Rng,
): PortalCandidate[] {
  const pageHost = hostOf(pageUrl);
  const seen = new Set<string>();
  const out: PortalCandidate[] = [];
  for (const e of elements) {
    if ((e.kind !== 'link' && e.kind !== 'button') || !e.href) continue;
    if (!portalHrefOk(e.href, pageUrl)) continue;
    const label = portalLabel(e.text);
    if (label.replace(/[^\p{L}\p{N}]/gu, '').length < 3) continue;
    if (JUNK_LABEL.test(label) || COUNTER_LABEL.test(label)) continue;
    const host = hostOf(e.href);
    const offsite = host !== '' && host !== pageHost && !host.endsWith(`.${pageHost}`);
    const words = label.split(' ').length;
    // off-site first; then label quality (words, up to 6) and type size; tiny seeded jitter for ties
    const score =
      (offsite ? 3 : 0) +
      Math.min(words, 6) / 6 +
      Math.min(label.length, 40) / 80 +
      Math.min(e.fontSize ?? 14, 24) / 48 -
      (DULL_LABEL.test(label) ? 1 : 0) +
      rng.next() * 0.05;
    out.push({ element: e, href: e.href, label, host, offsite, score });
  }
  out.sort((a, b) => b.score - a.score || a.element.id - b.element.id);
  // one candidate per href and per label (the best-scored element keeps it)
  return out.filter((c) => {
    const k = c.label.toLowerCase();
    if (seen.has(c.href) || seen.has(k)) return false;
    seen.add(c.href);
    seen.add(k);
    return true;
  });
}

export interface PortalPlacementContext {
  /** Cell labels (1-based raster island label; 0 = none) on the builder grid. */
  labels: Int32Array;
  cols: number;
  rows: number;
  cell: number;
  /** raster label − 1 → final island id (−1 = dropped). */
  newId: readonly number[];
  shapes: readonly IslandShape[];
  /** Ground the ball can roll to on raster island `i` (0-based). */
  reachable(island: number, p: Vec2): boolean;
  start: Vec2;
  goal: Vec2;
  /** Points to keep ≥ 2 D away from (large items). */
  avoid: readonly Vec2[];
  /** Bridge / lift mouth boxes (stage px). */
  mouths: readonly { x0: number; y0: number; x1: number; y1: number }[];
}

const KEEP_START = 4 * D;
const KEEP_MOUTH = 2 * D;
const KEEP_AVOID = 2 * D;
const PORTAL_SPACING = 6 * D;
const SEARCH_RADIUS = 3.5 * D;
const STEP = 1.5;
/** Preferred clearance: most of the portal ring on the island. */
const GOOD_CLEARANCE = PORTAL_RADIUS_PX * 0.85;
const MIN_CLEARANCE = BALL_RADIUS_PX + 1;

function boxDist(p: Vec2, b: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = Math.max(b.x0 - p[0], 0, p[0] - b.x1);
  const dy = Math.max(b.y0 - p[1], 0, p[1] - b.y1);
  return Math.hypot(dx, dy);
}

/** Raster island (0-based) covering most of the rect's cells, or −1. */
function islandUnder(ctx: PortalPlacementContext, e: SliceElement): number {
  const { labels, cols, rows, cell } = ctx;
  const c0 = Math.max(0, Math.floor(e.rect.x / cell));
  const c1 = Math.min(cols, Math.ceil((e.rect.x + e.rect.w) / cell));
  const r0 = Math.max(0, Math.floor(e.rect.y / cell));
  const r1 = Math.min(rows, Math.ceil((e.rect.y + e.rect.h) / cell));
  const count = new Map<number, number>();
  for (let r = r0; r < r1; r++)
    for (let c = c0; c < c1; c++) {
      const l = labels[r * cols + c] as number;
      if (l > 0 && (ctx.newId[l - 1] ?? -1) >= 0) count.set(l - 1, (count.get(l - 1) ?? 0) + 1);
    }
  let best = -1;
  let n = 0;
  for (const [k, v] of [...count.entries()].sort((a, b) => a[0] - b[0]))
    if (v > n) {
      n = v;
      best = k;
    }
  return best;
}

/** Choose and place the stage's portals (≤ MAX_PORTALS), ids in placement order. */
export function placePortals(
  candidates: readonly PortalCandidate[],
  ctx: PortalPlacementContext,
): { portals: Portal[]; notes: string[] } {
  const portals: Portal[] = [];
  const placed: Vec2[] = [];
  const hostsUsed = new Map<string, number>();
  const notes: string[] = [];
  // re-rank lazily: a host already used once costs 1.5 (still allowed when nothing else fits)
  const pool = candidates.slice();
  let unplaceable = 0;
  while (portals.length < MAX_PORTALS && pool.length > 0) {
    pool.sort(
      (a, b) =>
        b.score - (hostsUsed.get(b.host) ?? 0) * 1.5 - (a.score - (hostsUsed.get(a.host) ?? 0) * 1.5) ||
        a.element.id - b.element.id,
    );
    const c = pool.shift() as PortalCandidate;
    const island = islandUnder(ctx, c.element);
    if (island < 0) continue;
    const pos = findSpot(ctx, island, c.element, placed);
    if (!pos) {
      unplaceable++;
      continue;
    }
    placed.push(pos);
    hostsUsed.set(c.host, (hostsUsed.get(c.host) ?? 0) + 1);
    portals.push({
      id: portals.length,
      islandId: ctx.newId[island] as number,
      pos,
      href: c.href,
      label: c.label,
      sourceElementId: c.element.id,
    });
  }
  if (portals.length > 0)
    notes.push(
      `portals: ${portals.length} link(s) → ${portals.map((p) => hostOf(p.href)).join(', ')}` +
        (unplaceable > 0 ? ` (${unplaceable} link(s) had no clear spot)` : ''),
    );
  return { portals, notes };
}

function findSpot(
  ctx: PortalPlacementContext,
  island: number,
  e: SliceElement,
  placed: readonly Vec2[],
): Vec2 | null {
  const shape = ctx.shapes[island] as IslandShape;
  if (!shape || shape.contour.length < 3) return null;
  const cx = e.rect.x + e.rect.w / 2;
  const cy = e.rect.y + e.rect.h / 2;
  const reach = Math.max(SEARCH_RADIUS, Math.min(e.rect.w, 8 * D) / 2);
  const pts: [number, number, number][] = [];
  for (let dy = -reach; dy <= reach + 1e-9; dy += STEP)
    for (let dx = -reach; dx <= reach + 1e-9; dx += STEP) {
      // wide links: search along the whole text, but only a few ball diameters off its line
      if (Math.abs(dy) > SEARCH_RADIUS) continue;
      const d = Math.hypot(dx / Math.max(1, reach / SEARCH_RADIUS), dy);
      pts.push([cx + dx, cy + dy, d]);
    }
  pts.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  const cheapOk = (p: Vec2) => {
    if (Math.hypot(p[0] - ctx.start[0], p[1] - ctx.start[1]) < KEEP_START) return false;
    if (Math.hypot(p[0] - ctx.goal[0], p[1] - ctx.goal[1]) < KEEP_START) return false;
    for (const q of placed) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < PORTAL_SPACING) return false;
    for (const q of ctx.avoid) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < KEEP_AVOID) return false;
    for (const b of ctx.mouths) if (boxDist(p, b) < KEEP_MOUTH) return false;
    return ctx.reachable(island, p);
  };
  let fallback: Vec2 | null = null;
  let checked = 0;
  for (const [x, y] of pts) {
    const p: Vec2 = [round2(x), round2(y)];
    if (!cheapOk(p)) continue;
    if (!pointInPolygon(p, shape.contour, shape.holes)) continue;
    const clear = distanceToPolygonEdge(p, shape.contour, shape.holes);
    if (clear >= GOOD_CLEARANCE) return p;
    if (!fallback && clear >= MIN_CLEARANCE) fallback = p;
    if (++checked > 400) break;
  }
  return fallback;
}
