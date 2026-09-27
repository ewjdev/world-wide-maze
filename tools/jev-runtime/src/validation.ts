import { StageDataSchema, validateStage } from '@wwm/schema';
import { z } from 'zod';

const mazeSchema = z
  .object({
    stage: StageDataSchema.refine(
      (s) => s.islands.length <= 128 && s.items.length <= 4096 && validateStage(s).ok,
      'Invalid or oversized maze',
    ),
    textureDataUrl: z
      .string()
      .max(3 * 1024 * 1024)
      .regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/)
      .optional(),
  })
  .strict();

export { ChunkSchema, FrameSchema } from '../../../packages/maze-agent/src/validation.ts';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,90}$/);
export const CreateSchema = z
  .object({
    fixture: id,
    maze: mazeSchema.optional(),
    scoreMode: z.boolean().optional(),
    policy: z.enum(['jev', 'baseline', 'scripted']),
    orderSeed: z.number().int().min(0).max(100),
    parentRunId: id.nullable().optional(),
    documentId: id,
  })
  .strict();
export const Command = z
  .object({
    owner: id,
    documentId: id,
    epoch: z.number().int().nonnegative(),
    type: z.enum(['frame', 'chunk', 'status', 'action', 'outcome', 'discard', 'heartbeat']),
    data: z.unknown(),
  })
  .strict();
export const DecideSchema = z
  .object({ owner: id, documentId: id, epoch: z.number().int().nonnegative(), decisionId: id, attemptId: id })
  .strict();
