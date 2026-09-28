/**
 * Worker entry. Phase 07 owns the API, capture and storage; Phase 06 owns src/room.ts.
 */
import { budget, controlsOn, reserveCost } from './budget-client.ts';
import { createServices } from './config.ts';
import { createApp } from './router.ts';
import { serveAdminPage } from './routes/admin-page.ts';
import { handleRooms } from './routes/rooms.ts';
import { sweepCards } from './routes/share.ts';
import { clientIp, withSecurityHeaders } from './security.ts';

export { Budget } from './budget.ts';
export { BuildJob } from './build-job.ts';
export { JevControl } from './jev/control.ts';
export { Limiter } from './limiter.ts';
export { Room } from './room.ts';

const app = createApp();

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const path = new URL(request.url).pathname;
    const dynamic = path.startsWith('/api/') || /^\/(s|r|j)\//.test(path);
    if (controlsOn(env) && dynamic && !path.startsWith('/api/admin/') && path !== '/api/health') {
      const local = await env.READ_LIMITER.limit({ key: `cost-ingress:${clientIp(request)}` }).catch(() => ({
        success: false,
      }));
      const allowance = local.success ? await reserveCost(env, 'read') : { ok: false };
      if (!allowance.ok) {
        return withSecurityHeaders(
          request,
          new Response(
            path === '/api/t'
              ? null
              : JSON.stringify({
                  code: 'RATE_LIMITED',
                  message: 'Online services are resting. Play the practice maze with keyboard controls.',
                }),
            {
              status: path === '/api/t' ? 204 : 429,
              headers: {
                'content-type': 'application/json',
                'retry-after': '60',
                'cache-control': 'no-store',
                'x-wwm-mode': 'static',
              },
            },
          ),
        );
      }
    }
    let res: Response;
    try {
      res =
        (await serveAdminPage(request, env)) ??
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
    await budget(env).sweep();
    const { store, settings, log } = createServices(env, { requestId: 'cron' });
    const r = await store.sweep(settings.retentionDays);
    log.info('retention sweep', { ...r, days: settings.retentionDays });
    // Phase 18: rendered share cards are a cache; old ones go (a deleted score's card can't be served anyway).
    const cards = await sweepCards(env, settings.retentionDays);
    log.info('card sweep', cards);
  },
} satisfies ExportedHandler<Env>;
