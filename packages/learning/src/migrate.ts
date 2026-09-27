/**
 * 0.1 → 0.2: each old question becomes a one-round activity in the default theme, with its single hint as the
 * whole ladder. Old downloads keep opening; nothing about their teaching content changes.
 */
import type { LegacyPath } from './legacy.ts';
import { LEARNING_VERSION, type LearningPath, registerLegacyUpgrade } from './schema.ts';
import { skyIslands } from './theme.ts';

export function upgradeFromV01(legacy: LegacyPath): LearningPath {
  return {
    format: LEARNING_VERSION,
    id: legacy.id,
    version: '2.0.0',
    title: legacy.title,
    description: legacy.description,
    language: legacy.language,
    suggestedAges: legacy.suggestedAges,
    reviewStatus: legacy.reviewStatus,
    provenance: legacy.provenance,
    theme: skyIslands,
    activities: legacy.activities.map((activity) => ({
      id: activity.id,
      title: activity.title,
      domain: activity.domain,
      objective: activity.objective,
      introduction: activity.introduction,
      rounds: [
        {
          id: 'r1',
          kind: 'choose',
          prompt: activity.prompt.slice(0, 300),
          stimulus: activity.stimulus,
          options: activity.options.map((option) => ({
            id: option.id,
            label: option.label.slice(0, 60),
            tokens: option.tokens,
          })),
          answer: activity.answerId,
          hints: [activity.hint.slice(0, 300)],
          success: activity.explanation.slice(0, 300),
        },
      ],
      tools: [],
      finale: 'We did it!',
      parentNote: activity.parentNote,
      offlineActivity: activity.offlineActivity,
      prerequisites: activity.prerequisites,
    })),
  };
}

registerLegacyUpgrade(upgradeFromV01);
