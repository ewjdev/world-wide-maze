/** POST /api/t: bounded first-party ingestion, server allowlist, acknowledged PostHog delivery. */
import { Hono } from 'hono';
import type { AppEnv } from '../app-env.ts';
import { createLogger } from '../log.ts';
import { BodyTooLargeError, MAX_TELEMETRY_BYTES, readJsonCapped, tooLarge } from '../security.ts';
import { deliverTelemetry } from './telemetry-posthog.ts';
import { sanitizeTelemetry } from './telemetry-rules.ts';
export const telemetryRoutes = new Hono<AppEnv>();
telemetryRoutes.post('/t', async (c) => {
  c.header('cache-control', 'no-store');
  if (c.env.TELEMETRY_INGEST !== '1' || c.req.header('sec-gpc') === '1' || c.req.header('dnt') === '1')
    return c.body(null, 204);
  const origin = c.req.header('origin');
  if (origin && origin !== new URL(c.req.url).origin) {
    // Vite proxies /api from its separate loopback port during local validation.
    const localProxy =
      c.env.WWM_ENV === 'development' &&
      /^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/.test(origin) &&
      ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname);
    if (!localProxy) return c.body(null, 403);
  }
  if (c.req.header('sec-fetch-site') === 'cross-site') return c.body(null, 403);
  let body: unknown;
  try {
    body = await readJsonCapped(c.req.raw, MAX_TELEMETRY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return tooLarge(e);
    throw e;
  }
  const records = sanitizeTelemetry(body);
  if (!records.length) return c.body(null, 204);
  const log = createLogger({ svc: 'wwm-telemetry' });
  // Local QA only. Production never logs event bodies, IDs or request correlation fields.
  if (c.env.WWM_ENV === 'development' && c.env.TELEMETRY_DEBUG === '1') {
    for (const record of records) log.info('telemetry_debug', record);
  }
  const delivered = await deliverTelemetry(records, {
    host: c.env.POSTHOG_HOST,
    token: c.env.POSTHOG_TOKEN,
    environment: c.env.WWM_ENV,
    release: c.env.ANALYTICS_RELEASE,
  });
  log.info('telemetry_delivery', { accepted: records.length, delivered, environment: c.env.WWM_ENV });
  // A 204 now means the provider accepted the batch. A 502 lets the bounded client retry it.
  return c.body(null, delivered ? 204 : 502);
});
