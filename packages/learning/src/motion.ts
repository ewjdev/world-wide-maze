import { z } from 'zod';

export const motionSceneSchema = z
  .discriminatedUnion('apparatus', [
    z
      .object({
        apparatus: z.literal('balloon'),
        setting: z.literal('level-string'),
        exhaust: z.enum(['left', 'right', 'none']),
        startsStill: z.literal(true),
      })
      .strict(),
    z
      .object({
        apparatus: z.literal('rocket'),
        setting: z.enum(['launch', 'space']),
        exhaust: z.enum(['left', 'right', 'down']),
        startsStill: z.literal(true),
      })
      .strict(),
  ])
  .superRefine((scene, ctx) => {
    if (scene.apparatus === 'rocket' && (scene.setting === 'launch') !== (scene.exhaust === 'down'))
      ctx.addIssue({
        code: 'custom',
        message: 'A launch uses downward exhaust; space uses horizontal exhaust.',
      });
  });
export type MotionScene = z.infer<typeof motionSceneSchema>;
export type StartingMotion = 'left' | 'right' | 'up' | 'still';
export function expectedMotion(scene: MotionScene): StartingMotion {
  return scene.exhaust === 'left'
    ? 'right'
    : scene.exhaust === 'right'
      ? 'left'
      : scene.exhaust === 'down'
        ? 'up'
        : 'still';
}

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const line = z.string().trim().min(1).max(300);
export const motionRoundSchema = z
  .object({
    id,
    kind: z.literal('predict-motion'),
    prompt: line,
    hints: z.array(line).length(3),
    success: line,
    optional: z.boolean().optional(),
    onlyAfterHelpOn: id.optional(),
    input: z
      .array(z.enum(['tap', 'arrows']))
      .min(1)
      .max(2)
      .optional(),
    scene: motionSceneSchema,
    options: z
      .array(
        z
          .object({
            id: z.enum(['circle', 'triangle', 'star', 'flower', 'stay', 'zoom', 'cannot-move']),
            label: line.max(60),
            motion: z.enum(['left', 'right', 'up', 'down', 'still', 'zoom', 'impossible']),
          })
          .strict(),
      )
      .min(2)
      .max(3),
    answer: id,
  })
  .strict()
  .superRefine((round, ctx) => {
    const meanings = {
      circle: 'left',
      triangle: 'right',
      star: 'up',
      flower: 'down',
      stay: 'still',
      zoom: 'zoom',
      'cannot-move': 'impossible',
    };
    if (round.options.some((o) => meanings[o.id] !== o.motion))
      ctx.addIssue({ code: 'custom', message: 'Marker identity must agree with its motion.' });
    const allowed =
      round.scene.apparatus === 'balloon' && round.scene.exhaust === 'none'
        ? ['zoom', 'stay']
        : round.scene.setting === 'launch'
          ? ['star', 'flower']
          : round.scene.setting === 'space'
            ? ['cannot-move', 'circle', 'triangle']
            : ['circle', 'triangle'];
    if (round.options.length !== allowed.length || round.options.some((o, i) => o.id !== allowed[i]))
      ctx.addIssue({ code: 'custom', message: 'Scene markers must use their fixed spatial order.' });
    const matching = round.options.filter((option) => option.motion === expectedMotion(round.scene));
    if (new Set(round.options.map((o) => o.id)).size !== round.options.length)
      ctx.addIssue({ code: 'custom', message: 'Motion choice IDs must be unique.' });
    if (matching.length !== 1 || matching[0]?.id !== round.answer)
      ctx.addIssue({
        code: 'custom',
        message: 'Exactly one choice must match the scene’s expected motion and answer.',
      });
  });
export type MotionRound = z.infer<typeof motionRoundSchema>;
