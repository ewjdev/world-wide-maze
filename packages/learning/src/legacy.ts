/**
 * The Phase 19 wire format, `wwm-learning/0.1`: one single-choice question per activity. Kept only so that old
 * downloads still open; `upgradeFromV01` (migrate.ts) turns a validated 0.1 document into 0.2.
 */
import { z } from 'zod';

export const LEGACY_VERSION = 'wwm-learning/0.1' as const;
const text = z.string().trim().min(1).max(1000);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

const legacyToken = z
  .object({
    shape: z.enum(['circle', 'square', 'triangle']),
    color: z.enum(['blue', 'green', 'yellow', 'red']),
  })
  .strict();

const legacyActivity = z
  .object({
    id,
    title: text,
    domain: z.enum(['counting', 'comparison', 'geometry', 'patterns', 'sorting']),
    objective: text,
    introduction: text,
    prompt: text,
    stimulus: z.array(legacyToken).max(12),
    interaction: z.literal('single-choice'),
    options: z
      .array(z.object({ id, label: text, tokens: z.array(legacyToken).min(1).max(10) }).strict())
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
  .refine((activity) => activity.options.some((option) => option.id === activity.answerId), {
    message: 'The answer must reference an option.',
  });

export const legacyPathSchema = z
  .object({
    format: z.literal(LEGACY_VERSION),
    id,
    version: z.literal('1.0.0'),
    title: text,
    description: text,
    language: z.literal('en'),
    suggestedAges: z.tuple([z.literal(4), z.literal(6)]),
    reviewStatus: z.literal('pilot-needs-educator-review'),
    provenance: z.enum(['original-baseline', 'parent-personalized-introductions']),
    activities: z.array(legacyActivity).min(1).max(20),
  })
  .strict();

export type LegacyPath = z.infer<typeof legacyPathSchema>;
