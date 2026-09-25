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
import { stagesRoutes } from './routes/stages.ts';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
    c.set('ip', c.req.header('cf-connecting-ip') ?? 'local');
    c.set('services', createServices(c.env, { requestId }));
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true, contract: CONTRACT_VERSION }));

  // ── Route registration: one line per feature. ──
  app.route('/api', stagesRoutes);

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
