import { describe, expect, test } from 'vitest';
import { GRAPHICS_SETTINGS, readGraphics, saveGraphics } from '../src/ui/graphics-preference.ts';

describe('graphics preference', () => {
  test('every supported setting survives a new reader', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    for (const setting of GRAPHICS_SETTINGS) {
      saveGraphics(storage, setting);
      expect(readGraphics(storage)).toBe(setting);
    }
  });
  test('unknown and inaccessible storage fall back to Auto', () => {
    expect(readGraphics({ getItem: () => 'ultra' })).toBe('auto');
    expect(
      readGraphics({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('auto');
    expect(() =>
      saveGraphics(
        {
          setItem: () => {
            throw new Error('blocked');
          },
        },
        'low',
      ),
    ).not.toThrow();
  });
});
