import { z } from 'zod';

export const LEARNING_VERSION = 'wwm-learning/0.1' as const;
export const LEARNING_SCRIPT_ID = 'wwm-learning';
export const MAX_DOCUMENT_BYTES = 100_000;
const text = z.string().trim().min(1).max(1000);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

export const tokenSchema = z
  .object({
    shape: z.enum(['circle', 'square', 'triangle']),
    color: z.enum(['blue', 'green', 'yellow', 'red']),
  })
  .strict();

export const activitySchema = z
  .object({
    id,
    title: text,
    domain: z.enum(['counting', 'comparison', 'geometry', 'patterns', 'sorting']),
    objective: text,
    introduction: text,
    prompt: text,
    stimulus: z.array(tokenSchema).max(12),
    interaction: z.literal('single-choice'),
    options: z
      .array(z.object({ id, label: text, tokens: z.array(tokenSchema).min(1).max(10) }).strict())
      .min(2)
      .max(4),
    answerId: id,
    hint: text,
    explanation: text,
    parentNote: text,
    offlineActivity: text,
    prerequisites: z.array(id).max(6),
  })
  .strict()
  .superRefine((activity, ctx) => {
    if (new Set(activity.options.map((option) => option.id)).size !== activity.options.length) {
      ctx.addIssue({ code: 'custom', message: 'Option IDs must be unique.' });
    }
    if (!activity.options.some((option) => option.id === activity.answerId)) {
      ctx.addIssue({ code: 'custom', message: 'The answer must reference an option.' });
    }
  });

export const pathSchema = z
  .object({
    format: z.literal(LEARNING_VERSION),
    id,
    version: z.literal('1.0.0'),
    title: text,
    description: text,
    language: z.literal('en'),
    suggestedAges: z.tuple([z.literal(4), z.literal(6)]),
    reviewStatus: z.literal('pilot-needs-educator-review'),
    provenance: z.enum(['original-baseline', 'parent-personalized-introductions']),
    activities: z.array(activitySchema).min(1).max(20),
  })
  .strict()
  .superRefine((path, ctx) => {
    const seen = new Set<string>();
    for (const activity of path.activities) {
      if (seen.has(activity.id)) ctx.addIssue({ code: 'custom', message: 'Activity IDs must be unique.' });
      for (const prerequisite of activity.prerequisites) {
        if (!seen.has(prerequisite))
          ctx.addIssue({ code: 'custom', message: 'Prerequisites must reference earlier activities.' });
      }
      seen.add(activity.id);
    }
  });

export type LearningPath = z.infer<typeof pathSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Token = z.infer<typeof tokenSchema>;

export function parseLearningPath(value: unknown): LearningPath {
  return pathSchema.parse(value);
}

export function parseLearningJson(json: string): LearningPath {
  if (new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES)
    throw new Error('Learning document is too large.');
  return parseLearningPath(JSON.parse(json));
}

export function learningScript(path: LearningPath): string {
  const json = JSON.stringify(parseLearningPath(path))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return `<script id="${LEARNING_SCRIPT_ID}" type="application/json">${json}</script>`;
}

/** Read declared data only. Never run source-page scripts or infer objectives from appearance. */
export function readLearningDocument(document: Document): LearningPath {
  const nodes = document.querySelectorAll(`script#${LEARNING_SCRIPT_ID}[type="application/json"]`);
  if (nodes.length !== 1) throw new Error('Expected exactly one learning document.');
  return parseLearningJson(nodes[0]?.textContent ?? '');
}

/** Compatibility is explicit; a consumer never silently changes an activity's interaction. */
export function compatibleActivities(path: LearningPath, interactions: readonly string[]): Activity[] {
  return path.activities.filter((activity) => interactions.includes(activity.interaction));
}

export function checkAnswer(activity: Activity, optionId: string): 'correct' | 'try-again' {
  if (!activity.options.some((option) => option.id === optionId)) throw new Error('Unknown option.');
  return optionId === activity.answerId ? 'correct' : 'try-again';
}
