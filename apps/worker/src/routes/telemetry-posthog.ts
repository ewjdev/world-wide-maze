import type { TelemetryRecord } from '@wwm/schema';

const HOSTS = new Set(['https://us.i.posthog.com', 'https://eu.i.posthog.com']);
export interface AnalyticsConfig {
  host: string;
  token: string;
  environment: string;
  release: string;
}
export function posthogBatch(records: TelemetryRecord[], config: AnalyticsConfig) {
  return {
    api_key: config.token,
    batch: records.map(({ name, event_id, timestamp, context, visit, visitor, identity, ...properties }) => ({
      event: name === 'page_viewed' ? '$pageview' : name === 'page_left' ? '$pageleave' : name,
      uuid: event_id,
      timestamp: new Date(timestamp).toISOString(),
      properties: {
        ...properties,
        ...context,
        distinct_id: identity === 'browser' ? visitor : visit,
        $session_id: visit,
        visit,
        identity,
        environment: config.environment,
        release: config.release,
        $lib: 'wwm-first-party',
        $process_person_profile: false,
        $geoip_disable: true,
        // Canonical route labels only: no arbitrary URL, title, query, fragment, referrer or client IP.
        $pathname: `/${context.route}`,
        $current_url: `https://wwm.ewj.dev/${context.route}`,
        $host: 'wwm.ewj.dev',
        $device_type:
          context.device === 'mobile' ? 'Mobile' : context.device === 'tablet' ? 'Tablet' : 'Desktop',
        $browser: context.browser,
        $referring_domain: context.source,
        $ip: null,
      },
    })),
  };
}
export async function deliverTelemetry(
  records: TelemetryRecord[],
  config: AnalyticsConfig,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!HOSTS.has(config.host) || !/^phc_[A-Za-z0-9_]+$/.test(config.token)) return false;
  try {
    const response = await fetcher(`${config.host}/batch/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(posthogBatch(records, config)),
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
