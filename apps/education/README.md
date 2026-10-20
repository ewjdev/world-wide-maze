# WWM Learning

A separate static education site inside the existing WWM monorepo: a parent learning-path overview, eleven guided math, Spanish, and spelling lessons with Pip in the Sky Islands (`wwm-learning/0.3`), readable teaching notes, AI prompt/import review, local family versions, portable HTML export, and (Phase 31 M2) fresh examples with per-child progress saved on the device.

```sh
pnpm install
pnpm dev:education       # http://127.0.0.1:5174
pnpm build:education     # apps/education/dist
pnpm --filter @wwm/education preview  # http://127.0.0.1:4174
```

`scripts/generate.ts` renders the overview, the Progress page (`/progress/`) and eleven real HTML routes from `@wwm/learning` before dev/build. Generated source HTML is ignored; edit `src/render.ts` and `packages/learning/src/baseline.ts`, then restart dev to regenerate it. Vite enhances the static pages with local interactions. Goals, hints, explanations, and the machine data block exist in the initial response without client rendering.

## Parent workflow

1. Start with the default path; no customization is required.
2. Enter interests to generate a prompt. Copy it to the AI tool of your choice.
3. Paste its JSON response, inspect current/proposed text, accept or discard.
4. Acceptance saves a family version in this browser. Activity introductions and the embedded data both update.
5. Back up the draft as JSON; paste that backup into the same review flow to restore elsewhere. Export HTML for independent readers. Restore the baseline at any time.

This first fork format changes the path title/description and activity introductions only. It rejects changed answers, goals, unknown activities, stale baseline versions, and extra fields. No AI provider call is implied. There is no login, automatic generation, cloud sync, or in-maze progress yet. Do not treat a correct click as mastery. Pip’s voice plays pre-generated clips from `VITE_LEARNING_AUDIO_BASE` (default: the public `wwm-learning-audio` bucket). If a clip is missing or blocked, the browser’s speech reads the line; if speech is unavailable too, the cues and highlights run on estimated timing. Mute is remembered in `localStorage` (`wwm-learning.muted`). Personalized introductions always use browser speech.

## Progress on this device (Phase 31 M2)

- **Fresh examples:** each play-through is `expandActivity(path, activity, { seed, seen })`. `count-three`, `count-five`, `compare-groups` and `spanish-colors` add two generated rounds (`fresh-1`, `fresh-2`) after the written rounds and before any bonus, preferring items the child playing hasn't met. Their lines use browser speech (no studio clips). `?seed=` still replays a play-through.
- **Profiles:** a grown-up adds children (a nickname and a Pip avatar) in **Progress** (`src/progress.ts`, `src/progress-render.ts`), behind the press-and-hold gate (`src/hold.ts`, 2 s or hold G, from the game's `HoldButton`). With two or more children, a lesson starts with a picture-only picker (`src/lesson.ts`, `src/profiles.ts`); one child is chosen silently; with none, the lesson is unchanged and saves nothing. "Switch who’s playing" under a lesson is behind the same gate.
- **Evidence:** with a child chosen, each solved round appends one `roundEvidence(...)` event (`surface: 'lesson'`, the input used, the help level, a duration bucket) to `createBrowserStore()` in IndexedDB. Without IndexedDB (private browsing) everything plays and nothing is saved.
- **Progress page:** a plain-language state per objective, the last practised day, Try together, listening-practice labels, profile edit/delete, "Download progress (JSON)" and "Delete progress on this device". No percentages, scores or rankings. `#account-slot` is reserved for M3's sign-in.

What is and isn't recorded, and how to reset: [docs/education/progress-tracking.md](../../docs/education/progress-tracking.md).

## Verification

```sh
pnpm vitest run --project @wwm/learning --project @wwm/education
# With the education dev server or preview running:
WWM_EDUCATION_E2E_BASE=http://127.0.0.1:5174 pnpm vitest run --project @wwm/education education.e2e
```

Optional `WWM_EDUCATION_SHOTS=/tmp/wwm-edu-shots` saves screenshots of the compare-groups play-through at 1440×1000 and 390×844, each lesson’s success state, and the home page. Browser acceptance covers: no-JS reading; every lesson (wrong answer, hint, correct, locked success, Next); a full compare-groups play-through (the match tool, the trick follow-up, "Same", the bonus both played and skipped, the end card); Next inside the first 390×844 viewport; no horizontal scroll; blocked audio with speech and with silent fallback; mute persistence; reduced motion; and the family fork flow, including a Phase 19 `1.0.0` draft and a downloaded file read back with `readLearningHtml`. Phase 31 adds: fresh rounds before the bonus in every play-through; zero, one and two profiles (the picker by picture, the nickname through browser speech only, the held switch); evidence per solved round with the right help level and input; Progress states after scripted play over two days (`page.clock`, `?seed=`); export then delete; fresh-round lines through browser speech; and the no-IndexedDB fallback, on desktop and mobile Chromium. With `WWM_EDUCATION_SHOTS`, it also saves `p31-picker-*` and `p31-progress-*`. Speech is stubbed for deterministic timing. CI builds the standalone app; deploying it is a separate decision from the existing game deployment.

Five new lessons for ages 4–5 add Spanish speaking practice and simple English/Spanish spelling, with individual HTML downloads for loading into the maze. See [lesson details and loading instructions](../../docs/education/preschool-lessons.md).

The game’s `pnpm --filter @wwm/web build` also builds these pages with a `/learn/` asset base and packages them into `apps/web/dist/learn/`. Authored navigation and downloads are rebased with them. The existing production workflow deploys the combined assets in one release. `/learn/*` is served through a small Worker adapter with inline styles permitted for the authored SVG layout; scripts remain self-only, and microphone access remains disabled.
