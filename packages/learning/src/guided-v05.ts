import { z } from 'zod';
import {
  activitySchema,
  LEARNING_SCRIPT_ID,
  type LearningPath,
  MAX_DOCUMENT_BYTES,
  parseLearningPath,
  pathSchema,
} from './schema.ts';

export const GUIDED_VERSION = 'wwm-learning/0.5' as const;
export const MOTION_CAPABILITIES = ['round.predict-motion', 'scene.rocket-lab', 'demo.rocket-push'] as const;
export const guidedV05Schema = z
  .object({
    ...pathSchema.shape,
    format: z.literal(GUIDED_VERSION),
    version: z.literal('1.0.0'),
    activities: z.array(activitySchema).min(1).max(20),
    requiredCapabilities: z
      .array(z.enum(MOTION_CAPABILITIES))
      .length(3)
      .refine((v) => new Set(v).size === 3),
  })
  .strict()
  .superRefine((path, ctx) => {
    if (path.play?.shuffle !== 'none')
      ctx.addIssue({ code: 'custom', message: 'Guided science scenes use fixed spatial order.' });
    const ids = new Set<string>();
    for (const activity of path.activities) {
      if (ids.has(activity.id)) ctx.addIssue({ code: 'custom', message: 'Activity IDs must be unique.' });
      for (const pre of activity.prerequisites)
        if (!ids.has(pre))
          ctx.addIssue({ code: 'custom', message: 'Prerequisites must reference earlier activities.' });
      ids.add(activity.id);
      if (
        !activity.rounds.some((r) => !r.optional && !r.onlyAfterHelpOn) ||
        !activity.play ||
        activity.play.levels.some(
          (l) => l.steps !== 'rounds' || l.locks.mode === 'none' || l.locks.goal !== true,
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Guided science requires all required rounds and a locked finish.',
        });
      if (
        !activity.demonstration ||
        activity.domain !== 'physical-science' ||
        activity.rounds.some((r) => r.kind !== 'predict-motion')
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Guided science requires a demonstration and motion-prediction rounds.',
        });
    }
    for (const [id, level] of Object.entries(path.family?.levels ?? {})) {
      const activity = path.activities.find((a) => a.id === id);
      if (!activity?.play?.levels.some((l) => l.id === level))
        ctx.addIssue({ code: 'custom', message: 'Unknown family lesson or level.' });
    }
  });
export type GuidedV05 = z.infer<typeof guidedV05Schema>;

export function parseGuidedPath(value: unknown): LearningPath {
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES)
    throw new Error('Learning document is too large.');
  return value && typeof value === 'object' && 'format' in value && value.format === GUIDED_VERSION
    ? guidedV05Schema.parse(value)
    : parseLearningPath(value);
}
export function guidedCapabilities(path: LearningPath, supported: readonly string[]): string[] {
  return path.format === GUIDED_VERSION
    ? path.requiredCapabilities.filter((c) => !supported.includes(c))
    : [];
}
export function guidedLearningScript(path: LearningPath): string {
  const json = JSON.stringify(parseGuidedPath(path))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return `<script id="${LEARNING_SCRIPT_ID}" type="application/json">${json}</script>`;
}
export function readGuidedLearningHtml(html: string): LearningPath {
  const matches = [
    ...html.matchAll(
      new RegExp(
        `<script\\s+id="${LEARNING_SCRIPT_ID}"\\s+type="application/json"\\s*>([\\s\\S]*?)</script>`,
        'gi',
      ),
    ),
  ];
  if (matches.length !== 1) throw new Error('Expected exactly one learning document.');
  const json = matches[0]?.[1] ?? '';
  if (new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES)
    throw new Error('Learning document is too large.');
  return parseGuidedPath(JSON.parse(json));
}
export function readGuidedLearningDocument(document: Document): LearningPath {
  const nodes = document.querySelectorAll(`script#${LEARNING_SCRIPT_ID}[type="application/json"]`);
  if (nodes.length !== 1) throw new Error('Expected exactly one learning document.');
  return readGuidedLearningHtml(nodes[0]?.outerHTML ?? '');
}
