import type { TelemetryRecord } from '@wwm/schema';
import { describe, expect, test, vi } from 'vitest';
import { type AnalyticsConfig, deliverTelemetry, posthogBatch } from '../src/routes/telemetry-posthog.ts';
import { sanitizeTelemetry } from '../src/routes/telemetry-rules.ts';

const now = Date.now();
const config: AnalyticsConfig = {
  host: 'https://us.i.posthog.com',
  token: 'phc_test_project',
  environment: 'test',
  release: 'test-release',
};
const record: TelemetryRecord = {
  name: 'page_viewed',
  version: 1,
  event_id: crypto.randomUUID(),
  visit: crypto.randomUUID(),
  identity: 'visit',
  timestamp: now,
  context: {
    route: 'controller',
    surface: 'controller',
    device: 'mobile',
    browser: 'Safari',
    language: 'en',
    source: 'linkedin',
    medium: 'social',
    campaign: 'launch',
  },
};

describe('first-party to PostHog boundary', () => {
  test('strips arbitrary client properties, URLs, identifiers and cross-event fields before forwarding', () => {
    const clean = sanitizeTelemetry(
      {
        events: [
          {
            ...record,
            visitor: crypto.randomUUID(),
            message: 'person@example.com',
            score: 100,
            url: 'https://private.example/token',
            room: '123456',
            context: { ...record.context, referrer: 'https://private.example/ref', token: 'pair-secret' },
          },
        ],
      },
      now,
    );
    expect(clean).toEqual([record]);
    const payload = posthogBatch(clean, config);
    const event = payload.batch[0];
    expect(event).toMatchObject({
      event: '$pageview',
      uuid: record.event_id,
      properties: {
        distinct_id: record.visit,
        $session_id: record.visit,
        $pathname: '/controller',
        $current_url: 'https://wwm.ewj.dev/controller',
        $process_person_profile: false,
        $geoip_disable: true,
        $ip: null,
        surface: 'controller',
        environment: 'test',
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(/person@example|private.example|123456|pair-secret/);
  });
  test('browser identity requires visitor ID; page-leave and event UUID map correctly', () => {
    const visitor = crypto.randomUUID();
    expect(sanitizeTelemetry({ events: [{ ...record, identity: 'browser' }] }, now)).toEqual([]);
    const records = sanitizeTelemetry(
      { events: [{ ...record, name: 'page_left', identity: 'browser', visitor }] },
      now,
    );
    expect(posthogBatch(records, config).batch[0]).toMatchObject({
      event: '$pageleave',
      uuid: record.event_id,
      timestamp: new Date(now).toISOString(),
      properties: { distinct_id: visitor },
    });
  });
  test('rejects invalid context enums, stale/future records and malformed event fields', () => {
    const bad = [
      { ...record, context: { ...record.context, route: '/c/123456' } },
      { ...record, timestamp: now - 86_400_001 },
      { ...record, timestamp: now + 60_001 },
      { ...record, name: 'client_error', kind: 'user@example.com' },
      { ...record, name: 'engagement', active_ms: -1 },
    ];
    expect(sanitizeTelemetry({ events: bad }, now)).toEqual([]);
  });
  test('delivery is restricted to the exact approved regional ingest hosts and project-token format', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 200 }));
    for (const host of [
      'https://us.i.posthog.com.evil.example',
      'http://us.i.posthog.com',
      'https://us.i.posthog.com/private',
      'https://localhost:9999',
    ])
      expect(await deliverTelemetry([record], { ...config, host }, fetcher)).toBe(false);
    expect(await deliverTelemetry([record], { ...config, token: 'personal_api_secret' }, fetcher)).toBe(
      false,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(await deliverTelemetry([record], config, fetcher)).toBe(true);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://us.i.posthog.com/batch/');
    expect(await deliverTelemetry([record], { ...config, host: 'https://eu.i.posthog.com' }, fetcher)).toBe(
      true,
    );
  });
  test('HTTP and network failure report failure without breaking ingestion', async () => {
    expect(
      await deliverTelemetry(
        [record],
        config,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
      ),
    ).toBe(false);
    expect(
      await deliverTelemetry([record], config, vi.fn<typeof fetch>().mockRejectedValue(new Error('network'))),
    ).toBe(false);
  });
});
