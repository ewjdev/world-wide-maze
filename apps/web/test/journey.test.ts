/** Phase 13: web journeys (share encoding, fixture targets, colours) and the phase's en/ja strings. */
import { portalColor } from '@wwm/engine';
import { describe, expect, test } from 'vitest';
import {
  decodeJourney,
  encodeJourney,
  fixtureFor,
  hostColor,
  hostOf,
  isJourney,
  type JourneyStop,
  journeyUrl,
  MAX_SHARED_STOPS,
  monogram,
} from '../src/game/journey.ts';
import { journeyEn, journeyJa } from '../src/ui/journey-strings.ts';

const stop = (host: string, title: string, ref: string | null, via: JourneyStop['via']): JourneyStop => ({
  host,
  title,
  url: `https://${host}/`,
  ref,
  via,
});

const TRIP: JourneyStop[] = [
  stop('news.ycombinator.com', 'Hacker News', 'fixture-hn-front', 'start'),
  stop('grantland.com', 'The Board Game of the Alpha Nerds (2014)', 'a'.repeat(64), 'portal'),
  stop('ja.wikipedia.org', '迷路 – ウィキペディア', null, 'portal'),
];

describe('share links', () => {
  test('round trip: stops, refs, score and name (unicode titles too)', () => {
    const j = decodeJourney(encodeJourney(TRIP, { total: 1485, name: 'ej' }));
    expect(j).toEqual({
      stops: [
        { host: 'news.ycombinator.com', title: 'Hacker News', ref: 'fixture-hn-front' },
        { host: 'grantland.com', title: 'The Board Game of the Alpha Nerds (2014)', ref: 'a'.repeat(64) },
        { host: 'ja.wikipedia.org', title: '迷路 – ウィキペディア', ref: null },
      ],
      total: 1485,
      name: 'ej',
    });
    expect(journeyUrl('https://wwm.example', TRIP)).toMatch(/^https:\/\/wwm\.example\/j\/[A-Za-z0-9_-]+$/);
  });

  test('long journeys keep the last stops; long titles are clipped', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      stop(`s${i}.example`, `Site ${i} ${'x'.repeat(80)}`, null, i ? 'portal' : 'start'),
    );
    const j = decodeJourney(encodeJourney(many));
    expect(j?.stops).toHaveLength(MAX_SHARED_STOPS);
    expect(j?.stops[0]?.host).toBe('s8.example');
    expect(j?.stops[0]?.title.length).toBeLessThanOrEqual(48);
  });

  test('rejects broken or hostile payloads', () => {
    expect(decodeJourney('')).toBeNull();
    expect(decodeJourney('not base64!')).toBeNull();
    const enc = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeJourney(enc({ v: 2, s: [['a.com', 'A']] }))).toBeNull();
    expect(decodeJourney(enc({ v: 1, s: [] }))).toBeNull();
    expect(decodeJourney(enc({ v: 1, s: [['<script>', 'x']] }))).toBeNull();
    // a bad ref is dropped (the stop stays, without a play link)
    expect(decodeJourney(enc({ v: 1, s: [['a.com', 'A', '../../x']] }))?.stops[0]?.ref).toBeNull();
    expect(decodeJourney(enc({ v: 1, s: [['a.com', 'A']], p: -5 }))?.total).toBeNull();
  });
});

describe('helpers', () => {
  test('isJourney needs a portal hop', () => {
    expect(isJourney(TRIP.slice(0, 1))).toBe(false);
    expect(isJourney(TRIP)).toBe(true);
    expect(isJourney([TRIP[0] as JourneyStop, { ...(TRIP[1] as JourneyStop), via: 'select' }])).toBe(false);
  });

  test('a link to an offline fixture page travels there without the service', () => {
    expect(fixtureFor('https://en.wikipedia.org/wiki/Labyrinth#History')?.id).toBe(
      'fixture-wikipedia-article',
    );
    expect(fixtureFor('https://example.com')?.id).toBe('fixture-example-sparse');
    expect(fixtureFor('https://example.org/')).toBeUndefined();
  });

  test('host colour matches the engine gate colour; monogram skips language/mobile subdomains', () => {
    for (const h of ['news.ycombinator.com', 'grantland.com', 'en.wikipedia.org', 'github.com', 'koi.rest'])
      expect(hostColor(h)).toBe(portalColor(`https://${h}/x`));
    expect(hostOf('https://www.gov.uk/x')).toBe('gov.uk');
    expect(monogram('en.wikipedia.org')).toBe('W');
    expect(monogram('grantland.com')).toBe('G');
  });
});

test('journey strings: en and ja have the same keys', () => {
  const keys = (o: object, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  expect(keys(journeyJa).sort()).toEqual(keys(journeyEn).sort());
});
