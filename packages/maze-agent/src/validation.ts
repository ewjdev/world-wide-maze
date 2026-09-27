import { SIM_HZ } from '@wwm/schema';
import { z } from 'zod';
import { LIMITS } from './contracts.ts';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,90}$/);
const finite = z.number().finite();
const vec = z.tuple([finite, finite, finite]);
export const Ball = z
  .object({ pos: vec, vel: vec, quat: z.tuple([finite, finite, finite, finite]), grounded: z.boolean() })
  .strict();
const candidate = z
  .object({
    id,
    direction: z.string().max(16),
    kind: z.enum(['flat', 'ramp', 'goal']),
    destination: id.nullable(),
    traversals: z.number().int().min(0).max(256),
  })
  .strict();
export const FrameSchema = z
  .object({
    id,
    tick: z.number().int().min(0).max(LIMITS.ticks),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    candidates: z.array(candidate).min(1).max(8),
    observation: z
      .object({
        current: id,
        goalVisible: z.boolean(),
        nodes: z.array(z.object({ id, visits: z.number().int().min(0).max(256) }).strict()).max(32),
        edges: z
          .array(
            z
              .object({ id, from: id, to: id.nullable(), traversals: z.number().int().min(0).max(256) })
              .strict(),
          )
          .max(128),
        history: z.array(z.object({ node: id, edge: id.nullable() }).strict()).max(64),
      })
      .strict(),
  })
  .strict();
export const Input = z
  .object({
    tiltX: finite.min(-1).max(1),
    tiltZ: finite.min(-1).max(1),
    frameYaw: finite.min(-100).max(100),
    power: z.boolean(),
    jump: z.literal(false),
  })
  .strict();
export const ChunkSchema = z
  .object({
    sequence: z.number().int().min(0),
    from: z.number().int().min(0),
    to: z.number().int().min(0).max(LIMITS.ticks),
    inputs: z.array(Input).min(1).max(SIM_HZ),
    events: z
      .array(
        z
          .object({
            tick: z.number().int().min(1).max(LIMITS.ticks),
            event: z.discriminatedUnion('type', [
              z.object({ type: z.literal('goal') }).strict(),
              z.object({ type: z.literal('fell'), restartAt: z.tuple([finite, finite]) }).strict(),
              z.object({ type: z.literal('island'), islandId: z.number().int().nonnegative() }).strict(),
              z.object({ type: z.literal('landed'), impact: finite }).strict(),
              z.object({ type: z.literal('bump'), impact: finite }).strict(),
            ]),
          })
          .strict(),
      )
      .max(128),
    ball: Ball,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const ReceiptSchema = z
  .object({
    attemptId: id,
    decisionId: id,
    source: z.enum(['jev', 'baseline', 'scripted', 'forced', 'forced-goal']),
    choice: id,
    probabilities: z.record(z.string(), finite.min(0).max(1)).nullable(),
    confidence: finite.min(0).max(1).nullable(),
    model: z.string().max(100).nullable(),
    usage: z
      .object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() })
      .nullable(),
    latencyMs: finite.nonnegative(),
    status: z.enum(['accepted', 'discarded']),
  })
  .strict();
