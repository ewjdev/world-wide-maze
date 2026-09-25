/**
 * Sharing (Phase 10, Phase 18 share cards). Mounted at `/` by the router.
 *
 * Link-preview pages (Open Graph / Twitter `summary_large_image`), each with its own card image:
 *   GET /s/:stageId[?beat=&by=]     stage invite; forwards to /play/:stageId (keeping beat/by for the game's
 *                                   challenge banner). The card is the plain invite: link parameters never
 *                                   reach a card or the preview text.
 *   GET /s/:stageId/r/:scoreId      a submitted stage score (D1 row) → /play/:stageId?beat=<score>&by=<name>
 *   GET /r/:scoreId                 a run-board entry (session total) → /
 *   GET /j/:trail                   a web journey (Phase 13): the SPA page with the journey card's tags
 *   GET /  and  /log                the SPA with the default card / the build-story image
 * Images:
 *   GET /api/cards/:kind/:id.png    kind = stage | score | run | journey | site (id `default`). Rendered on
 *                                   demand from server data, cached in R2 under a content hash, served
 *                                   immutable when `?v=` matches the current hash.
 *   GET /api/share/:stageId/card    (Phase 10) the curated hero shot, else a redirect to the texture; still used
 *                                   by the curated list's thumbnails.
 * 2013 shared a `/maze/?http://site` link that rebuilt the site (E, fidelity-spec §9); ours links the built stage (N).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../app-env.ts';
import { CARD_H, CARD_W, type CardData, cardKey } from '../cards/data.ts';
import {
  type CardSource,
  heroKey,
  loadJourneyCard,
  loadRunCard,
  loadScoreCard,
  loadStageCard,
  siteCard,
} from '../cards/load.ts';
import { fmtInt } from '../cards/text.ts';
import { SPA_SECURITY_HEADERS } from '../security.ts';
import { injectMeta, type PageMeta, playPath, sharePage, shareParams } from './share-html.ts';
import { readLimit } from './stages.ts';

const HEX64 = /^[0-9a-f]{64}$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Renders (cache misses) per IP and in total. Cached cards cost nothing. */
export const CARD_RENDER_LIMIT = {
  perIp: 30,
  perIpWindowMs: 10 * 60_000,
  global: 1200,
  globalWindowMs: 3600_000,
};

export const shareRoutes = new Hono<AppEnv>();

type Kind = CardData['kind'];
const KINDS = new Set<Kind>(['stage', 'score', 'run', 'journey', 'site']);

function load(env: Env, kind: Kind, id: string): Promise<CardSource | null> {
  switch (kind) {
    case 'stage':
      return loadStageCard(env, id);
    case 'score':
      return loadScoreCard(env, id);
    case 'run':
      return loadRunCard(env, id);
    case 'journey':
      return loadJourneyCard(env, id);
    case 'site':
      return Promise.resolve(id === 'default' ? siteCard() : null);
  }
}

async function imageUrl(origin: string, kind: Kind, id: string, src: CardSource): Promise<string> {
  const { version } = await cardKey(src.data, new URL(origin).host);
  return `${origin}/api/cards/${kind}/${encodeURIComponent(id)}.png?v=${version}`;
}

const notFoundPage = () =>
  new Response('<!doctype html><title>Not found</title><p>This link does not lead anywhere any more.</p>', {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' },
  });

const PAGE_CACHE = { 'cache-control': 'public, max-age=300' };
const CARD_ALT_SUFFIX = 'World Wide Maze share card';

// ── /s/:stageId (Phase 10) ─────────────────────────────────────────────────────────────────────────

shareRoutes.get('/s/:stageId', readLimit, async (c) => {
  const stageId = c.req.param('stageId');
  const src = HEX64.test(stageId) ? await loadStageCard(c.env, stageId) : null;
  if (!src) return notFoundPage();
  const origin = new URL(c.req.url).origin;
  const { title, host, slice } = src.meta as { title: string; host: string; slice: string | null };
  const part = slice ? ` (part ${slice.replace('/', ' of ')})` : '';
  const m: PageMeta = {
    title: `Play ${title}${part} as a maze`,
    description: `${host || title} turned into a 3D island maze. Roll the ball to the goal by tilting your phone, or use the keyboard.`,
    canonical: `${origin}/s/${stageId}`,
    image: {
      url: await imageUrl(origin, 'stage', stageId, src),
      alt: `The ${host || title} page rebuilt as floating islands joined by bridges. ${CARD_ALT_SUFFIX}`,
      width: CARD_W,
      height: CARD_H,
    },
  };
  // beat/by only travel on to the game (its challenge banner); the preview never repeats them.
  const next = playPath({ stageId, ...shareParams(new URL(c.req.url).searchParams) });
  return c.html(sharePage(m, next, 'Play this maze'), 200, PAGE_CACHE);
});

// ── /s/:stageId/r/:scoreId: a submitted stage score ───────────────────────────────────────────────

shareRoutes.get('/s/:stageId/r/:scoreId', readLimit, async (c) => {
  const stageId = c.req.param('stageId');
  const scoreId = c.req.param('scoreId');
  const src = HEX64.test(stageId) ? await loadScoreCard(c.env, scoreId, stageId) : null;
  if (!src) return notFoundPage();
  const origin = new URL(c.req.url).origin;
  const s = src.meta as {
    name: string;
    score: number;
    rank: number;
    verified: boolean;
    title: string;
    host: string;
  };
  const m: PageMeta = {
    title: `${s.name} scored ${fmtInt(s.score)} on ${s.title}. Can you beat it?`,
    description: `#${fmtInt(s.rank)} on this maze${s.verified ? ' (replay verified)' : ''}. ${s.host || s.title} turned into a 3D island maze: tilt your phone to roll the ball to the goal.`,
    canonical: `${origin}/s/${stageId}/r/${scoreId}`,
    image: {
      url: await imageUrl(origin, 'score', scoreId, src),
      alt: `${s.name} scored ${fmtInt(s.score)} points on ${s.host || s.title}, rank ${s.rank}. ${CARD_ALT_SUFFIX}`,
      width: CARD_W,
      height: CARD_H,
    },
  };
  // Server values, not link parameters: the challenge banner shows the real score.
  const next = playPath({ stageId, beat: s.score, by: s.name });
  return c.html(sharePage(m, next, 'Try to beat it'), 200, PAGE_CACHE);
});

// ── /r/:scoreId: a run-board entry ──────────────────────────────────────────────────────────────────

shareRoutes.get('/r/:scoreId', readLimit, async (c) => {
  const scoreId = c.req.param('scoreId');
  const src = await loadRunCard(c.env, scoreId);
  if (!src) return notFoundPage();
  const origin = new URL(c.req.url).origin;
  const r = src.meta as { name: string; total: number; rank: number; sites: number; stages: number };
  const across = r.sites > 0 ? `${r.sites} ${r.sites === 1 ? 'site' : 'sites'}` : `${r.stages} stages`;
  const m: PageMeta = {
    title: `${r.name} is #${fmtInt(r.rank)} on the World Wide Maze leaderboard`,
    description: `${fmtInt(r.total)} points across ${across}. Turn any website into a 3D maze and steer it with your phone.`,
    canonical: `${origin}/r/${scoreId}`,
    image: {
      url: await imageUrl(origin, 'run', scoreId, src),
      alt: `${r.name}: #${r.rank} on the leaderboard with ${fmtInt(r.total)} points. ${CARD_ALT_SUFFIX}`,
      width: CARD_W,
      height: CARD_H,
    },
  };
  return c.html(sharePage(m, '/', 'Play World Wide Maze'), 200, PAGE_CACHE);
});

// ── SPA routes with their own card: /j/:trail, /, /log ──────────────────────────────────────────────

/** The SPA shell (static assets) with `m`'s tags; a plain share page where there are no assets (local dev). */
async function spaWithMeta(c: { env: Env; req: { raw: Request } }, m: PageMeta): Promise<Response> {
  const assets = c.env.ASSETS;
  if (!assets)
    return new Response(sharePage(m, null, ''), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  // Always the shell itself, unconditionally (no If-None-Match: the injected page has no asset etag).
  const res = await assets.fetch(
    new Request(new URL('/', c.req.raw.url), { headers: { accept: 'text/html' } }),
  );
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return res;
  const html = injectMeta(await res.text(), m);
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  // Worker responses don't get `_headers`: the app's own policy (security.ts mirrors apps/web/public/_headers).
  for (const [k, v] of Object.entries(SPA_SECURITY_HEADERS)) headers.set(k, v);
  return new Response(html, { status: 200, headers });
}

async function passThrough(c: { env: Env; req: { raw: Request } }): Promise<Response | null> {
  return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : null;
}

shareRoutes.get('/j/:trail', async (c) => {
  const trail = c.req.param('trail');
  const origin = new URL(c.req.url).origin;
  const { success } = await c.env.READ_LIMITER.limit({ key: `read:${c.get('ip')}` });
  const src = success ? await loadJourneyCard(c.env, trail) : null;
  if (!src) return (await passThrough(c)) ?? notFoundPage(); // the app shows its own "invalid link" state
  const j = src.meta as { chain: string; stops: number; total: number | null; name: string | null };
  const m: PageMeta = {
    title: `${j.name ? `${j.name}’s` : 'A'} web journey: ${j.stops} sites turned into mazes`,
    description: `${j.chain}${j.total !== null ? `, ${fmtInt(j.total)} points` : ''}. Roll across the web from link to link in World Wide Maze.`,
    canonical: `${origin}/j/${trail}`,
    image: {
      url: await imageUrl(origin, 'journey', trail, src),
      alt: `A chain of floating islands, one per site: ${j.chain}. ${CARD_ALT_SUFFIX}`,
      width: CARD_W,
      height: CARD_H,
    },
  };
  return spaWithMeta(c, m);
});

const SITE_DESCRIPTION =
  'Any website becomes a 3D island maze you steer with your phone. A tribute to the 2013 Chrome Experiment.';

shareRoutes.get('/', async (c) => {
  const origin = new URL(c.req.url).origin;
  const m: PageMeta = {
    title: 'World Wide Maze: turn any website into a 3D maze',
    description: SITE_DESCRIPTION,
    canonical: `${origin}/`,
    image: {
      url: await imageUrl(origin, 'site', 'default', siteCard()),
      alt: `The WORLD WIDE MAZE wordmark next to a small island maze. ${CARD_ALT_SUFFIX}`,
      width: CARD_W,
      height: CARD_H,
    },
  };
  return spaWithMeta(c, m);
});

shareRoutes.get('/log', async (c) => {
  const origin = new URL(c.req.url).origin;
  const m: PageMeta = {
    title: 'How World Wide Maze was rebuilt: the build record',
    description:
      'Every phase of the rebuild, from the logs: what was built, what failed and how long it took.',
    canonical: `${origin}/log`,
    // The build-story social image (Phase 16, content/build-story/social/og-log.png), served as a static asset.
    image: {
      url: `${origin}/og/log.png`,
      alt: 'A 24-hour clock of the build: agent runs as coloured arcs, with the totals beside it.',
      width: CARD_W,
      height: CARD_H,
    },
  };
  return spaWithMeta(c, m);
});

// ── card images ─────────────────────────────────────────────────────────────────────────────────────

// `/api/*` is already covered by the read limiter `stagesRoutes` installs.
shareRoutes.get('/api/cards/:kind/:file', async (c) => {
  const kind = c.req.param('kind') as Kind;
  const file = c.req.param('file');
  if (!KINDS.has(kind) || !file.endsWith('.png'))
    return Response.json({ error: 'card not found' }, { status: 404 });
  let id: string;
  try {
    id = decodeURIComponent(file.slice(0, -4));
  } catch {
    return Response.json({ error: 'card not found' }, { status: 404 }); // malformed %-escape
  }
  const src = await load(c.env, kind, id);
  if (!src) return Response.json({ error: 'card not found' }, { status: 404 });
  const url = new URL(c.req.url);
  const site = url.host;
  const { key, version } = await cardKey(src.data, site);
  const cache = url.searchParams.get('v') === version ? IMMUTABLE : 'public, max-age=600';
  const hit = await c.env.STAGES.get(key);
  if (hit)
    return new Response(hit.body, {
      headers: { 'content-type': 'image/png', 'cache-control': cache, etag: hit.httpEtag, 'x-card': 'hit' },
    });

  // A render: rate-limited per IP and globally (crawlers fetch each card once; the R2 copy serves the rest).
  const { log } = c.get('services');
  const perIp = c.env.LIMITER.get(c.env.LIMITER.idFromName(`card:${c.get('ip')}`));
  const global = c.env.LIMITER.get(c.env.LIMITER.idFromName('card:global'));
  const L = CARD_RENDER_LIMIT;
  const a = await perIp.hit(L.perIp, L.perIpWindowMs);
  const b = a.ok ? await global.hit(L.global, L.globalWindowMs) : a;
  if (!b.ok) {
    log.warn('card render rate limited', { kind, scope: a.ok ? 'global' : 'ip' });
    if (kind !== 'site')
      return new Response(null, {
        status: 302,
        headers: { location: '/api/cards/site/default.png', 'cache-control': 'no-store' },
      });
    return Response.json(
      { error: 'rate limited' },
      { status: 503, headers: { 'retry-after': String(b.retryAfterSec), 'cache-control': 'no-store' } },
    );
  }
  const { renderCard } = await import('../cards/render.ts');
  const art = await src.art();
  const out = await renderCard(src.data, art, site);
  log.info('card rendered', { kind, ms: Math.round(out.ms), bytes: out.png.byteLength });
  c.executionCtx.waitUntil(
    c.env.STAGES.put(key, out.png, {
      httpMetadata: { contentType: 'image/png', cacheControl: IMMUTABLE },
      customMetadata: { kind, renderMs: String(Math.round(out.ms)) },
    }),
  );
  return new Response(out.png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': cache,
      'x-card': 'render',
      'x-render-ms': String(Math.round(out.ms)),
    },
  });
});

// (Phase 10) the curated hero shot, else the stage texture.
shareRoutes.get('/api/share/:stageId/card', async (c) => {
  const stageId = c.req.param('stageId');
  if (!HEX64.test(stageId)) return Response.json({ error: 'card not found' }, { status: 404 });
  const card = await c.env.STAGES.get(heroKey(stageId));
  if (card)
    return new Response(card.body, {
      headers: {
        'content-type': card.httpMetadata?.contentType ?? 'image/png',
        'cache-control': 'public, max-age=86400',
        etag: card.httpEtag,
      },
    });
  return c.redirect(`/api/stages/${stageId}/texture`, 302);
});

/** Retention: rendered cards are caches; drop ones older than `days` (they re-render on demand). */
export async function sweepCards(env: Pick<Env, 'STAGES'>, days: number, now = Date.now(), max = 1000) {
  const cutoff = now - days * 86400_000;
  let cursor: string | undefined;
  let deleted = 0;
  let seen = 0;
  do {
    const page = await env.STAGES.list({ prefix: 'cards/', limit: 500, ...(cursor ? { cursor } : {}) });
    const old = page.objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => o.key);
    if (old.length) await env.STAGES.delete(old);
    deleted += old.length;
    seen += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && seen < max);
  return { deleted };
}
