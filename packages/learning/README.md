# @wwm/learning

Game-independent educational intent. Source exports follow the existing pnpm workspace convention.

- `baselinePath`: six original early-math pilot activities plus five Spanish and spelling lessons designed for ages 4–5 with a grown-up (revision `3.1.0`).
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

See [the preschool lessons](../../docs/education/preschool-lessons.md) for content, individual loadable HTML packs, localized browser speech, and speaking-practice limits.

Run `pnpm vitest run --project @wwm/learning` and `pnpm --filter @wwm/learning typecheck` from the repo root.
