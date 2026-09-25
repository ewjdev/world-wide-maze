/**
 * Sharing (Phase 10). Mounted at `/` by the router.
 *   GET /s/:stageId[?beat=<score>&by=<name>]  a tiny HTML page with Open Graph / Twitter card tags for crawlers,
 *                                             which sends people on to /play/:stageId (keeping `beat`/`by`).
 *   GET /api/share/:stageId/card              the card image: the pre-rendered hero shot in R2
 *                                             (`share/<stageId>.png`, see content/README.md), else a redirect to
 *                                             the stage texture so every stage still has a picture.
 * 2013 shared a `/maze/?http://site` link that rebuilt the site (E, fidelity-spec §9); ours links the built stage (N).
 */
import { parseStage } from '@wwm/schema';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env.ts';
import { cardKey, shareHtml, shareParams } from './share-html.ts';
import { readLimit } from './stages.ts';

const HEX64 = /^[0-9a-f]{64}$/;
export const shareRoutes = new Hono<AppEnv>();

shareRoutes.get('/s/:stageId', readLimit, async (c) => {
  const stageId = c.req.param('stageId');
  const obj = HEX64.test(stageId) ? await c.get('services').store.getStage(stageId) : null;
  if (!obj) return c.html('<!doctype html><title>Not found</title><p>This maze does not exist.</p>', 404);
  const stage = parseStage(await obj.json());
  const origin = new URL(c.req.url).origin;
  const html = shareHtml({
    stageId,
    title: stage.source.title || stage.source.url,
    siteUrl: stage.source.url,
    slice: { index: stage.source.slice.index, count: stage.source.slice.count },
    origin,
    ...shareParams(new URL(c.req.url).searchParams),
  });
  return c.html(html, 200, { 'cache-control': 'public, max-age=300' });
});

// `/api/*` is already covered by the read limiter `stagesRoutes` installs.
shareRoutes.get('/api/share/:stageId/card', async (c) => {
  const stageId = c.req.param('stageId');
  if (!HEX64.test(stageId)) return Response.json({ error: 'card not found' }, { status: 404 });
  const card = await c.env.STAGES.get(cardKey(stageId));
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
