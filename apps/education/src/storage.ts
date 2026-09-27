import {
  applyDraft,
  applyFamilySettings,
  type FamilyFork,
  type FamilySettings,
  type LearningPath,
  parseDraft,
} from '@wwm/learning';

export const FORK_KEY = 'wwm-learning:family-fork:v1';
/** The grown-up's game settings (Phase 22): a level per lesson, and tap-only answering. */
export const SETTINGS_KEY = 'wwm-learning:settings:v1';

export function readFork(baseline: LearningPath): {
  path: LearningPath;
  fork?: FamilyFork;
  warning?: string;
} {
  try {
    const raw = localStorage.getItem(FORK_KEY);
    if (!raw) return { path: baseline };
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('draft' in value) ||
      !('acceptedAt' in value) ||
      typeof value.acceptedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.acceptedAt))
    )
      throw new Error('Invalid saved version');
    const draft = parseDraft(value.draft, baseline);
    return { path: applyDraft(baseline, draft), fork: { draft, acceptedAt: value.acceptedAt } };
  } catch {
    return {
      path: baseline,
      warning:
        'Your saved version could not be loaded. The original path is available. Restore the original or import a backup to continue.',
    };
  }
}

export const SETTINGS_WARNING =
  'Your saved game settings could not be loaded, so every lesson uses its recommended level. Choose again, or reset the game settings.';

/**
 * Validate stored game settings against a path. Fail closed: an unknown lesson or level rejects the whole
 * record, exactly as `applyFamilySettings` would. Returns null for anything that isn't a valid record.
 */
export function parseSettings(value: unknown, path: LearningPath): FamilySettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'levels' && key !== 'tapOnly')) return null;
  if (typeof record.tapOnly !== 'boolean') return null;
  const levels = record.levels;
  if (!levels || typeof levels !== 'object' || Array.isArray(levels)) return null;
  const entries = Object.entries(levels as Record<string, unknown>);
  if (entries.some(([, level]) => typeof level !== 'string')) return null;
  const settings: FamilySettings = {
    levels: Object.fromEntries(entries) as Record<string, string>,
    tapOnly: record.tapOnly,
  };
  try {
    applyFamilySettings(path, settings);
    return settings;
  } catch {
    return null;
  }
}

/** The stored game settings, if any. A record that doesn't validate is ignored, with a warning. */
export function readSettings(path: LearningPath): { settings?: FamilySettings; warning?: string } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const settings = parseSettings(JSON.parse(raw), path);
    return settings ? { settings } : { warning: SETTINGS_WARNING };
  } catch {
    return { warning: SETTINGS_WARNING };
  }
}

/** Save (or, with null, forget) the game settings. Throws when the browser can't store; the caller explains. */
export function writeSettings(settings: FamilySettings | null): void {
  if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  else localStorage.removeItem(SETTINGS_KEY);
}

/** What every page reads: the family version (or the baseline) with the grown-up's game settings applied. */
export function readFamily(baseline: LearningPath): {
  path: LearningPath;
  fork?: FamilyFork;
  warning?: string;
  settings?: FamilySettings;
  settingsWarning?: string;
} {
  const version = readFork(baseline);
  const stored = readSettings(version.path);
  return {
    ...version,
    path: stored.settings ? applyFamilySettings(version.path, stored.settings) : version.path,
    ...(stored.settings ? { settings: stored.settings } : {}),
    ...(stored.warning ? { settingsWarning: stored.warning } : {}),
  };
}

export function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}
