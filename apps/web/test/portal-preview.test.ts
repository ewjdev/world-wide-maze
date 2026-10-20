/** Portal windows (N; plans/portal-windows-execution.md): the flag and the fixture picture source. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StageData } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { pngSize, portalWindowsEnabled, previewablePortals, topSquare } from '../src/game/portal-preview.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

describe('flag', () => {
  test('needs an explicit "true", even in development', () => {
    expect(portalWindowsEnabled({})).toBe(false);
    expect(portalWindowsEnabled({ VITE_PORTAL_WINDOWS_ENABLED: '1' })).toBe(false);
    expect(portalWindowsEnabled({ VITE_PORTAL_WINDOWS_ENABLED: 'false' })).toBe(false);
    expect(portalWindowsEnabled({ VITE_PORTAL_WINDOWS_ENABLED: 'true' })).toBe(true);
  });
});

describe('picture helpers', () => {
  test('pngSize reads the IHDR of a real fixture screenshot', () => {
    const bytes = readFileSync(resolve(ROOT, 'fixtures/captures/portal-hub/screenshot.png'));
    expect(pngSize(new Uint8Array(bytes.subarray(0, 24)))).toEqual({ width: 2560, height: 1972 });
  });

  test('pngSize rejects anything that is not a PNG', () => {
    expect(pngSize(new Uint8Array(24))).toBeNull();
    expect(pngSize(new Uint8Array(8))).toBeNull();
  });

  test('topSquare keeps the top of the page, centred', () => {
    expect(topSquare(2560, 1972)).toEqual({ sx: 294, sy: 0, sw: 1972, sh: 1972 });
    expect(topSquare(1280, 6000)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 1280 });
  });
});

describe('previewable portals', () => {
  const stage = (hrefs: string[]) =>
    ({ portals: hrefs.map((href, id) => ({ id, href })) }) as unknown as StageData;

  test('fixture targets only; real sites and Pip gates are skipped', () => {
    const got = previewablePortals(
      stage([
        'https://en.wikipedia.org/wiki/Labyrinth',
        'https://www.w3.org/',
        'https://example.com/',
        'wwm-learning:sky-islands/1#4f9fd6',
      ]),
    );
    expect(got.map((p) => [p.id, p.entry.slug])).toEqual([
      [0, 'wikipedia-article'],
      [2, 'example-sparse'],
    ]);
  });

  test('the portal-hub fixture stage has portals to at least three fixtures', () => {
    const golden = JSON.parse(
      readFileSync(resolve(ROOT, 'fixtures/builder/portal-hub.normal.seed1.json'), 'utf8'),
    ) as StageData;
    expect(previewablePortals(golden).length).toBeGreaterThanOrEqual(3);
  });

  test('a stage without portals has nothing to show', () => {
    expect(previewablePortals({} as StageData)).toEqual([]);
  });
});
