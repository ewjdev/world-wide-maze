/** Semantic binding data has no URL, file path, executable expression, or renderer object. */
import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const lessonWorldManifestSchema = z
  .object({
    revision: id,
    stageHash: z.string().regex(/^[a-f0-9]{64}$/),
    targets: z.record(
      id,
      z
        .object({
          islandId: z.number().int().min(0),
          pos: z.tuple([z.number().finite(), z.number().finite()]),
          radius: z.number().min(8).max(30),
        })
        .strict(),
    ),
    connectors: z.record(
      id,
      z.object({ kind: z.enum(['bridge', 'elevator']), id: z.number().int().min(0) }).strict(),
    ),
  })
  .strict();

export interface LessonWorldManifest {
  revision: string;
  stageHash: string;
  targets: Record<string, { islandId: number; pos: [number, number]; radius: number }>;
  connectors: Record<string, { kind: 'bridge' | 'elevator'; id: number }>;
}

export function parseLessonWorldManifest(value: unknown): LessonWorldManifest {
  return lessonWorldManifestSchema.parse(value);
}
