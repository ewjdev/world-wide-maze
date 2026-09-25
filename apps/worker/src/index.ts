/**
 * Worker entry. Phase 07 owns the API, capture and storage; Phase 06 owns src/room.ts.
 */
import { createServices } from './config.ts';
import { createApp } from './router.ts';

export { BuildJob } from './build-job.ts';
export { Limiter } from './limiter.ts';
export { Room } from './room.ts';

const app = createApp();

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),

  // Retention (task 9): delete non-curated runs older than RETENTION_DAYS.
  async scheduled(_controller, env, _ctx) {
    const { store, settings, log } = createServices(env, { requestId: 'cron' });
    const r = await store.sweep(settings.retentionDays);
    log.info('retention sweep', { ...r, days: settings.retentionDays });
  },
} satisfies ExportedHandler<Env>;
