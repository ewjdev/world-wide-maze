import { applyDraft, type FamilyFork, type LearningPath, parseDraft } from '@wwm/learning';

export const FORK_KEY = 'wwm-learning:family-fork:v1';
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
