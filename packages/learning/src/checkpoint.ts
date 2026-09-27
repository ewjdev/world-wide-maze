/**
 * Engine-neutral data for one round placed in a game world (the WWM "Pip gate"): what to ask, which choices
 * exist in on-screen order, which is right, and where each gem sits on its island, in ball radii from the
 * island's centre. A 2D overlay can use `sceneSvg` instead; a 3D consumer can build the same picture from this.
 */

import { choicesInOrder, sceneLayout } from './scene.ts';
import { type Activity, findRound, type RoundKind, type Theme } from './schema.ts';
import { lineId } from './script.ts';

export interface CheckpointSpec {
  activityId: string;
  roundId: string;
  kind: RoundKind;
  prompt: string;
  promptLine: string;
  /** Choice ids, left to right: tilt/arrow selection order. */
  choices: { id: string; label: string; ariaLabel: string }[];
  answer: string;
  /** Gem islands (compare/difference rounds): gem centres relative to the island centre, in gem radii. */
  islands: { count: number; gems: [number, number][]; size: 'small' | 'medium' | 'large' }[];
  colors: Pick<Theme['palette'], 'gem' | 'gemEdge' | 'gate' | 'ballShell' | 'ballSeam' | 'glow'>;
}

export function checkpointSpec(theme: Theme, activity: Activity, roundId: string): CheckpointSpec {
  const round = findRound(activity, roundId);
  const layout = sceneLayout(
    round,
    'wide',
    1,
    activity.domain === 'counting' || activity.domain === 'comparison',
  );
  const order = choicesInOrder(round);
  const byId = new Map(layout.choices.map((choice) => [choice.id, choice]));
  const r3 = (value: number) => Math.round(value * 1000) / 1000;
  const p = theme.palette;
  return {
    activityId: activity.id,
    roundId: round.id,
    kind: round.kind,
    prompt: round.prompt,
    promptLine: lineId.prompt(activity.id, round.id),
    choices: order.map((id) => {
      const choice = byId.get(id);
      return { id, label: choice?.label ?? id, ariaLabel: choice?.ariaLabel ?? id };
    }),
    answer: String(round.answer),
    islands:
      round.kind === 'choose'
        ? []
        : layout.islands.map((island, i) => {
            const cx = island.inner.x + island.inner.w / 2;
            const cy = island.inner.y + island.inner.h / 2;
            const group = round.islands[i] as (typeof round.islands)[number];
            return {
              count: group.count,
              size: group.size,
              gems: island.points.map(
                ([x, y]) => [r3((x - cx) / island.r), r3((y - cy) / island.r)] as [number, number],
              ),
            };
          }),
    colors: {
      gem: p.gem,
      gemEdge: p.gemEdge,
      gate: p.gate,
      ballShell: p.ballShell,
      ballSeam: p.ballSeam,
      glow: p.glow,
    },
  };
}
