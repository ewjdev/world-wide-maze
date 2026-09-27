# WWM Learning

A separate static education site inside the existing WWM monorepo: a parent learning-path overview, six guided early-math lessons with Pip in the Sky Islands (`wwm-learning/0.2`), readable teaching notes, AI prompt/import review, local family versions, and portable HTML export.

```sh
pnpm install
pnpm dev:education       # http://127.0.0.1:5174
pnpm build:education     # apps/education/dist
pnpm --filter @wwm/education preview  # http://127.0.0.1:4174
```

`scripts/generate.ts` renders the overview and six real HTML routes from `@wwm/learning` before dev/build. Generated source HTML is ignored; edit `src/render.ts` and `packages/learning/src/baseline.ts`, then restart dev to regenerate it. Vite enhances the static pages with local interactions. Goals, hints, explanations, and the machine data block exist in the initial response without client rendering.

## Parent workflow

1. Start with the default path; no customization is required.
2. Enter interests to generate a prompt. Copy it to the AI tool of your choice.
3. Paste its JSON response, inspect current/proposed text, accept or discard.
4. Acceptance saves a family version in this browser. Activity introductions and the embedded data both update.
5. Back up the draft as JSON; paste that backup into the same review flow to restore elsewhere. Export HTML for independent readers. Restore the baseline at any time.

This first fork format changes the path title/description and activity introductions only. It rejects changed answers, goals, unknown activities, stale baseline versions, and extra fields. No AI provider call is implied. There is no login, automatic generation, cloud sync, shared learner history, or in-maze integration yet. Do not treat a correct click as mastery. Pip’s voice plays pre-generated clips from `VITE_LEARNING_AUDIO_BASE` (default: the public `wwm-learning-audio` bucket). If a clip is missing or blocked, the browser’s speech reads the line; if speech is unavailable too, the cues and highlights run on estimated timing. Mute is remembered in `localStorage` (`wwm-learning.muted`). Personalized introductions always use browser speech.

## Verification

```sh
pnpm vitest run --project @wwm/learning --project @wwm/education
# With the education dev server or preview running:
WWM_EDUCATION_E2E_BASE=http://127.0.0.1:5174 pnpm vitest run --project @wwm/education education.e2e
```

Optional `WWM_EDUCATION_SHOTS=/tmp/wwm-edu-shots` saves screenshots of the compare-groups play-through at 1440×1000 and 390×844, each lesson’s success state, and the home page. Browser acceptance covers: no-JS reading; every lesson (wrong answer, hint, correct, locked success, Next); a full compare-groups play-through (the match tool, the trick follow-up, "Same", the bonus both played and skipped, the end card); Next inside the first 390×844 viewport; no horizontal scroll; blocked audio with speech and with silent fallback; mute persistence; reduced motion; and the family fork flow, including a Phase 19 `1.0.0` draft and a downloaded file read back with `readLearningHtml`. Speech is stubbed for deterministic timing. CI builds the standalone app; deploying it is a separate decision from the existing game deployment.
