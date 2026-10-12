/**
 * Phase 20 M4b (N): getting a learning document into the game, per the consumer rules of
 * docs/education/html-contract.md: only the inert `<script id="wwm-learning" type="application/json">` block is
 * read (`readLearningHtml` → `parseLearningJson`, strict and size-bounded); no document markup is inserted or run,
 * and nothing is fetched from a URL the document names. Two ways in:
 *
 * - `?learn=<activityId>`: an activity of the bundled baseline path (`baselinePath`);
 * - a learning HTML file the grown-up picked (the education app's "Download learning HTML"), read with `File.text()`.
 */
import {
  type Activity,
  bundledLessonPath,
  compatibleActivities,
  guidedCapabilities,
  type LearningPath,
  MAX_DOCUMENT_BYTES,
  MOTION_CAPABILITIES,
  readGuidedLearningHtml,
} from '@wwm/learning';

/** Round kinds the gate card can play (it draws every one with the shared scene renderer). */
export const GAME_ROUND_KINDS = ['choose', 'compare', 'difference', 'predict-motion'] as const;

/** A learning HTML page also carries readable copy, so the file may be larger than its JSON (which stays bounded). */
export const MAX_FILE_BYTES = 8 * MAX_DOCUMENT_BYTES;

export type LessonSource = { kind: 'baseline' } | { kind: 'file'; name: string };

export type LessonErrorKind =
  | 'unknown-activity'
  | 'no-compatible'
  | 'not-learning'
  | 'invalid'
  | 'too-large'
  | 'unreadable';

export class LessonLoadError extends Error {
  constructor(
    readonly kind: LessonErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LessonLoadError';
  }
}

export interface LoadedLesson {
  path: LearningPath;
  activity: Activity;
  source: LessonSource;
}

/** `?learn=` for a specific activity, else the first one every round of which the game can play. */
export function pickActivity(path: LearningPath, id?: string | null): Activity {
  const compatible = compatibleActivities(path, GAME_ROUND_KINDS);
  if (id) {
    const activity = path.activities.find((a) => a.id === id);
    if (!activity)
      throw new LessonLoadError('unknown-activity', `No activity "${id}" in this learning page.`);
    if (!compatible.includes(activity))
      throw new LessonLoadError('no-compatible', `Activity "${id}" has rounds the game can't play yet.`);
    return activity;
  }
  const first = compatible[0];
  if (!first)
    throw new LessonLoadError('no-compatible', 'No activity in this learning page fits the game yet.');
  return first;
}

export function lessonFromBaseline(
  id?: string | null,
  enabled = import.meta.env.VITE_ROCKET_LAB_ENABLED === 'true',
): LoadedLesson {
  let path: LearningPath;
  try {
    path = bundledLessonPath(id, enabled);
  } catch {
    throw new LessonLoadError('no-compatible', 'Rocket Lab is not available in this build.');
  }
  return { path, activity: pickActivity(path, id), source: { kind: 'baseline' } };
}

/** Parse a learning HTML page's text: only its inert JSON block is read. */
export function lessonFromHtml(
  html: string,
  name: string,
  id?: string | null,
  enabled = import.meta.env.VITE_ROCKET_LAB_ENABLED === 'true',
): LoadedLesson {
  let path: LearningPath;
  try {
    path = readGuidedLearningHtml(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/exactly one learning document/i.test(message))
      throw new LessonLoadError('not-learning', 'This file isn’t a learning page.');
    if (/too large/i.test(message)) throw new LessonLoadError('too-large', message);
    throw new LessonLoadError('invalid', 'This learning page doesn’t pass validation.');
  }
  if (path.format === 'wwm-learning/0.5' && !enabled)
    throw new LessonLoadError('no-compatible', 'Rocket Lab is not available in this build.');
  if (guidedCapabilities(path, MOTION_CAPABILITIES).length)
    throw new LessonLoadError('no-compatible', 'This lesson requires unsupported capabilities.');
  return { path, activity: pickActivity(path, id), source: { kind: 'file', name } };
}

export async function lessonFromFile(
  file: Pick<File, 'name' | 'size' | 'text'>,
  id?: string | null,
): Promise<LoadedLesson> {
  if (file.size > MAX_FILE_BYTES) throw new LessonLoadError('too-large', 'This file is too large.');
  let html: string;
  try {
    html = await file.text();
  } catch {
    throw new LessonLoadError('unreadable', 'The file could not be read.');
  }
  return lessonFromHtml(html, file.name, id);
}
