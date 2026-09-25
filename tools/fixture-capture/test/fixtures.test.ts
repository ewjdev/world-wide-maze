/** Guards the checked-in fixtures (contracts §8) that every other phase tests against. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_PAGE_HEIGHT_PX, parseCapture, validateStage } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { formatJson } from '../src/format.ts';
import { buildHandmadeStage, railsAround } from '../src/handmade.ts';
import { CAPTURES_DIR, STAGES_DIR } from '../src/paths.ts';

function pngSize(path: string): { width: number; height: number } {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const slugs = readdirSync(CAPTURES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe('capture fixtures', () => {
  test('at least 6 contrasting captures exist', () => {
    expect(slugs.length).toBeGreaterThanOrEqual(6);
  });

  test.each(slugs)('%s: capture.json passes parseCapture and matches its 1280-wide screenshot', (slug) => {
    const dir = resolve(CAPTURES_DIR, slug);
    const bundle = parseCapture(JSON.parse(readFileSync(resolve(dir, 'capture.json'), 'utf8')));
    const png = pngSize(resolve(dir, bundle.screenshot.path));
    expect(png.width).toBe(1280);
    expect(png.height).toBeLessThanOrEqual(MAX_PAGE_HEIGHT_PX);
    expect(bundle.screenshot).toMatchObject({ width: png.width, height: png.height, format: 'png' });
    expect(bundle.page).toEqual({ width: 1280, height: png.height });
    expect(bundle.elements.length).toBeGreaterThan(0);
    for (const e of bundle.elements) {
      expect(e.rect.x + e.rect.w).toBeLessThanOrEqual(bundle.page.width + 0.01);
      expect(e.rect.y + e.rect.h).toBeLessThanOrEqual(bundle.page.height + 0.01);
    }
  });
});

describe('handmade-simple stage', () => {
  test('checked-in JSON passes validateStage and matches the generator', async () => {
    const onDisk = JSON.parse(readFileSync(resolve(STAGES_DIR, 'handmade-simple.json'), 'utf8'));
    expect(validateStage(onDisk)).toEqual({ ok: true, errors: [] });
    expect(onDisk).toEqual(await buildHandmadeStage());
  });

  test('texture is 1280×1600', () => {
    expect(pngSize(resolve(STAGES_DIR, 'handmade-simple.png'))).toEqual({ width: 1280, height: 1600 });
  });
});

describe('helpers', () => {
  test('railsAround leaves a gap of the requested width', () => {
    const ring: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    expect(railsAround(ring, [{ center: [100, 50], width: 20 }])).toEqual([
      [
        [100, 60],
        [100, 100],
        [0, 100],
        [0, 0],
        [100, 0],
        [100, 40],
      ],
    ]);
    expect(railsAround(ring, [])).toHaveLength(1);
  });

  test('formatJson is valid JSON with one line per compact entry', () => {
    const v = { a: 1, elements: [{ x: 1 }, { x: 2 }], p: [1, 2] };
    const s = formatJson(v);
    expect(JSON.parse(s)).toEqual(v);
    expect(s).toContain('    {"x":1},\n');
  });
});
