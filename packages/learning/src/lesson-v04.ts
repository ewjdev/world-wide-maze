/** Experimental 0.4 lesson contract. Kept separate from the stable 0.1–0.3 reader. */
import { z } from 'zod';
import { GUIDED_VERSION, type GuidedV05, parseGuidedPath } from './guided-v05.ts';
import { LEARNING_SCRIPT_ID, type LearningPath, MAX_DOCUMENT_BYTES, parseLearningPath } from './schema.ts';

export const LESSON_VERSION = 'wwm-learning/0.4' as const;
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const line = z.string().trim().min(1).max(300);
const count = z.number().int().min(0).max(99);
const item = z.object({ type: id, count }).strict();
const target = z
  .object({
    id,
    role: z.enum(['pickup', 'deposit', 'destination', 'key', 'safe-post']),
    item: id.optional(),
    count: count.optional(),
  })
  .strict();
const pickup = z.object({ id, item: id, count: z.number().int().min(1).max(99), target: id }).strict();
const encounter = z
  .object({
    id,
    prompt: line,
    hints: z.array(line).min(1).max(3),
    initialInventory: z.array(item).max(16),
    pickups: z.array(pickup).max(64),
    deposit: z
      .object({
        target: id,
        item: id,
        required: z.number().int().min(1).max(99),
        prefilled: count,
        connector: id,
      })
      .strict(),
    validCompositions: z
      .array(z.array(z.number().int().min(1).max(99)).min(1).max(8))
      .min(1)
      .max(8),
    transfer: z.boolean().optional(),
  })
  .strict();

const bridgeActivity = z
  .object({
    id,
    kind: z.literal('bridge-builders'),
    title: line,
    objective: line,
    gradeTarget: z.number().int().min(1).max(4),
    parentNote: line,
    encounters: z.array(encounter).length(4),
  })
  .strict();

export const lessonV04Schema = z
  .object({
    format: z.literal(LESSON_VERSION),
    id: id,
    revision: id,
    title: line,
    description: line,
    interfaceLocale: z.literal('en-US'),
    targetLocale: z.enum(['en-US', 'es-MX']),
    reviewStatus: z.literal('draft-needs-educator-review'),
    requiredCapabilities: z
      .array(z.enum(['inventory.deposit', 'session.resume']))
      .min(1)
      .max(2),
    targets: z.array(target).min(1).max(64),
    connectors: z.array(id).min(1).max(32),
    activities: z.array(bridgeActivity).length(1),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const unique = (values: string[], label: string) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', message: `${label} IDs must be unique.` });
    };
    unique(
      doc.targets.map((x) => x.id),
      'Target',
    );
    unique(doc.connectors, 'Connector');
    const targets = new Map(doc.targets.map((x) => [x.id, x]));
    const connectors = new Set(doc.connectors);
    for (const activity of doc.activities) {
      unique(
        activity.encounters.map((x) => x.id),
        'Encounter',
      );
      const pickupIds = activity.encounters.flatMap((x) => x.pickups.map((p) => p.id));
      unique(pickupIds, 'Pickup');
      for (const e of activity.encounters) {
        const deposit = targets.get(e.deposit.target);
        if (deposit?.role !== 'deposit')
          ctx.addIssue({
            code: 'custom',
            message: `${e.id}: deposit target is missing or has the wrong role.`,
          });
        if (!connectors.has(e.deposit.connector))
          ctx.addIssue({ code: 'custom', message: `${e.id}: connector is missing.` });
        if (e.deposit.prefilled > e.deposit.required)
          ctx.addIssue({ code: 'custom', message: `${e.id}: prefilled exceeds required.` });
        const stock =
          e.initialInventory.filter((x) => x.type === e.deposit.item).reduce((n, x) => n + x.count, 0) +
          e.pickups.filter((x) => x.item === e.deposit.item).reduce((n, x) => n + x.count, 0);
        if (stock < e.deposit.required - e.deposit.prefilled)
          ctx.addIssue({ code: 'custom', message: `${e.id}: insufficient exact stock.` });
        for (const p of e.pickups) {
          const t = targets.get(p.target);
          if (t?.role !== 'pickup' || t.item !== p.item || t.count !== p.count)
            ctx.addIssue({ code: 'custom', message: `${e.id}: pickup ${p.id} has no matching target.` });
        }
        for (const parts of e.validCompositions) {
          if (parts.reduce((n, x) => n + x, 0) !== e.deposit.required - e.deposit.prefilled)
            ctx.addIssue({ code: 'custom', message: `${e.id}: composition does not match missing slots.` });
        }
      }
    }
  });

export type LessonV04 = z.infer<typeof lessonV04Schema>;
export type BridgeEncounter = LessonV04['activities'][number]['encounters'][number];
export type NormalizedLearningDocument =
  | { kind: 'legacy-linear'; path: LearningPath }
  | { kind: 'v04'; path: LessonV04 }
  | { kind: 'guided-v05'; path: GuidedV05 };

export function parseLessonV04(value: unknown): LessonV04 {
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES)
    throw new Error('Learning document is too large.');
  return lessonV04Schema.parse(value);
}

/** Old paths retain their full data and semantics; consumers adapt individual linear steps. */
export function normalizeLearningDocument(value: unknown): NormalizedLearningDocument {
  if (value && typeof value === 'object' && 'format' in value && value.format === LESSON_VERSION)
    return { kind: 'v04', path: parseLessonV04(value) };
  if (value && typeof value === 'object' && 'format' in value && value.format === GUIDED_VERSION)
    return { kind: 'guided-v05', path: parseGuidedPath(value) as GuidedV05 };
  return { kind: 'legacy-linear', path: parseLearningPath(value) };
}

export function validateLesson(doc: LessonV04, capabilities: readonly string[]): string[] {
  return doc.requiredCapabilities
    .filter((capability) => !capabilities.includes(capability))
    .map((capability) => `Unsupported required capability: ${capability}`);
}

export function learningScriptV04(doc: LessonV04): string {
  const json = JSON.stringify(parseLessonV04(doc))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return `<script id="${LEARNING_SCRIPT_ID}" type="application/json">${json}</script>`;
}

/** Read only the inert data block. An imported page cannot select a world or media origin. */
export function readLearningHtmlAny(html: string): NormalizedLearningDocument {
  const pattern = new RegExp(
    `<script\\s+id="${LEARNING_SCRIPT_ID}"\\s+type="application/json"\\s*>([\\s\\S]*?)</script>`,
    'gi',
  );
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Expected exactly one learning document.');
  const json = matches[0]?.[1] ?? '';
  if (new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES)
    throw new Error('Learning document is too large.');
  return normalizeLearningDocument(JSON.parse(json));
}
