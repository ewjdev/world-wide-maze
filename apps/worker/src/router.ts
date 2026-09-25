/**
 * HTTP router (Hono). Each feature lives in `src/routes/<name>.ts` as a `Hono<AppEnv>` sub-app and is
 * registered below with ONE line, so parallel phases merge cleanly:
 *   Phase 06: `app.route('/api/rooms', roomsRoutes);`   (src/routes/rooms.ts)
 *   Phase 10: `app.route('/api/scores', scoresRoutes);` (src/routes/scores.ts)
 */
import { CONTRACT_VERSION } from '@wwm/schema';
import { Hono } from 'hono';
import type { AppEnv } from './app-env.ts';
import { createServices } from './config.ts';
import { errorResponse, toServiceError } from './errors.ts';
import { scoresRoutes } from './routes/scores.ts';
import { shareRoutes } from './routes/share.ts';
import { stagesRoutes } from './routes/stages.ts';
import { telemetryRoutes } from './routes/telemetry.ts';
import { uploadRoutes } from './routes/upload.ts';
import { clientIp, crossSiteRefused, isCrossSite } from './security.ts';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
    c.set('ip', clientIp(c.req.raw)); // Phase 12: IPv6 keyed on its /64
    c.set('services', createServices(c.env, { requestId }));
    // Phase 12: no cross-site state changes (builds, scores, telemetry) from other sites' pages.
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && isCrossSite(c.req.raw)) {
      c.get('services').log.warn('cross-site request refused', { path: c.req.path, method: c.req.method });
      return crossSiteRefused();
    }
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true, contract: CONTRACT_VERSION }));

  // ── Route registration: one line per feature. ──
  app.route('/api', stagesRoutes);
  app.route('/api/scores', scoresRoutes); // Phase 10
  app.route('/', shareRoutes); // Phase 10: /s/:stageId, /api/share/:stageId/card
  app.route('/api/stages', uploadRoutes); // Phase 14: POST /api/stages/upload (local capture → shared run)
  app.route('/api', telemetryRoutes); // Phase 12: POST /api/t (off unless TELEMETRY_INGEST=1)

  app.notFound(() => Response.json({ error: 'not found' }, { status: 404 }));
  app.onError((err, c) => {
    const e = toServiceError(err);
    c.get('services')?.log.error('unhandled', {
      path: c.req.path,
      error: String(err),
      stack: (err as Error).stack,
    });
    return errorResponse(e);
  });
  return app;
}
