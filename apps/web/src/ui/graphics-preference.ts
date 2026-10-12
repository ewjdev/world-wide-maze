import type { QualitySetting } from '@wwm/engine';

export const GRAPHICS_SETTINGS = ['auto', 'low', 'medium', 'high'] as const;
const KEY = 'wwm.graphics';

export function readGraphics(storage: Pick<Storage, 'getItem'>): QualitySetting {
  try {
    const value = storage.getItem(KEY);
    return GRAPHICS_SETTINGS.find((setting) => setting === value) ?? 'auto';
  } catch {
    return 'auto';
  }
}

export function saveGraphics(storage: Pick<Storage, 'setItem'>, setting: QualitySetting): void {
  try {
    storage.setItem(KEY, setting);
  } catch {
    /* Storage can be disabled. */
  }
}
