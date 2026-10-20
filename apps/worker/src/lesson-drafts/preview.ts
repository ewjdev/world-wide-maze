/**
 * Revision previews through the trusted renderer only: the revision's bank becomes ordinary activities in a copy of
 * the baseline, the learning schema validates it, and `portablePage()` (@wwm/education) renders it, escaping every
 * piece of text. Model output never becomes markup. The page is served with a CSP that allows no scripts and is
 * sandboxed, so even a renderer bug couldn't run anything.
 */
import { portablePage } from '@wwm/education/render';
import {
  type Activity,
  baselinePath,
  type DraftRevision,
  type LearningPath,
  parseLearningPath,
} from '@wwm/learning';
import { authoringActivity } from './pipeline.ts';

const ROUNDS_PER_ACTIVITY = 8;

export function previewPath(revision: DraftRevision, path: LearningPath = baselinePath): LearningPath {
  const activity = authoringActivity(path, revision.objective);
  const items = revision.bank.items;
  const activities: Activity[] = [];
  for (let at = 0; at < items.length; at += ROUNDS_PER_ACTIVITY) {
    const rounds = items.slice(at, at + ROUNDS_PER_ACTIVITY);
    const { fresh: _fresh, play: _play, ...rest } = activity;
    activities.push({
      ...rest,
      id: `${activity.id}-draft-${activities.length + 1}`,
      title: `${activity.title}: draft items ${at + 1}–${at + rounds.length}`,
      objectives: [revision.objective],
      rounds,
      prerequisites: [],
    });
  }
  const { voice: _voice, family: _family, ...base } = path;
  return parseLearningPath({
    ...base,
    title: `Lesson draft preview (not reviewed): ${activity.title}`,
    description: `Revision ${revision.hash} from turn ${revision.turn}. Operator preview only; nothing here reaches a child until it is approved, imported, reviewed in git and deployed.`,
    activities,
    banks: [],
  });
}

export function previewHtml(revision: DraftRevision): string {
  return portablePage(previewPath(revision));
}

/** Headers for the preview: inert HTML that only the admin workbench may frame. */
export const PREVIEW_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox",
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'private, no-store',
};
