# @wwm/learning

Game-independent educational intent. Source exports follow the existing pnpm workspace convention.

- `baselinePath`: six original early-math pilot activities for an initial ages 4–6 audience.
- `parseLearningPath` / `parseLearningJson`: strict, bounded runtime validation.
- `learningScript`: escape-safe inert JSON embedded in HTML.
- `readLearningDocument(document)`: read exactly one declared data block, rejecting missing/duplicate/invalid documents. Does not execute source scripts.
- `compatibleActivities(path, interactionTypes)`: explicit consumer capability matching.
- `checkAnswer(activity, optionId)`: evaluate an option, not learner mastery.
- `createPersonalizationPrompt`, `parseDraft`, `applyDraft`: bounded, reviewable family introductions with baseline identity preserved.

```ts
import { readLearningDocument, compatibleActivities } from '@wwm/learning';

const path = readLearningDocument(document);
const activities = compatibleActivities(path, ['single-choice']);
```

See [the HTML contract](../../docs/education/html-contract.md). The package does not fetch URLs, execute third-party HTML, store learner records, contact an AI provider, or depend on game physics/rendering.

Run `pnpm vitest run --project @wwm/learning` and `pnpm --filter @wwm/learning typecheck` from the repo root.
