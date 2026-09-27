import { z } from 'zod';

export { ChunkSchema, FrameSchema } from '../../../packages/maze-agent/src/validation.ts';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,90}$/);
export const CreateSchema = z
  .object({
    fixture: id,
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
