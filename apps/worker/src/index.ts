/**
 * Worker entry. Phase 07 owns the API, capture and storage; Phase 06 owns src/room.ts.
 */
import { createServices } from './config.ts';
import { createApp } from './router.ts';
import { handleRooms } from './routes/rooms.ts';
import { sweepCards } from './routes/share.ts';
import { withSecurityHeaders } from './security.ts';

export { BuildJob } from './build-job.ts';
export { Limiter } from './limiter.ts';
export { Room } from './room.ts';

const app = createApp();

export default {
  async fetch(request, env, ctx): Promise<Response> {
    let res: Response;
    try {
      res =
        (await handleRooms(request, env)) ?? // Phase 06: /api/rooms/*
        (await app.fetch(request, env, ctx));
    } catch (err) {
      console.error(
        JSON.stringify({ level: 'error', svc: 'wwm-worker', msg: 'unhandled', error: String(err) }),
      );
      res = Response.json({ error: 'internal error' }, { status: 500 });
    }
    // Phase 12: security headers on every Worker response (static assets get theirs from `_headers`).
    return withSecurityHeaders(request, res);
  },

  // Retention (task 9): delete non-curated runs older than RETENTION_DAYS.
  async scheduled(_controller, env, _ctx) {
    const { store, settings, log } = createServices(env, { requestId: 'cron' });
    const r = await store.sweep(settings.retentionDays);
    log.info('retention sweep', { ...r, days: settings.retentionDays });
    // Phase 18: rendered share cards are a cache; old ones go (a deleted score's card can't be served anyway).
    const cards = await sweepCards(env, settings.retentionDays);
    log.info('card sweep', cards);
  },
} satisfies ExportedHandler<Env>;
