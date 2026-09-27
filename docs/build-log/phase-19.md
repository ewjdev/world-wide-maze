# Phase 19 — Education monorepo slice

September 26, 2026. Codex (GPT-6), local CLI/browser tooling, independent review and design-documentation agents. Work started approximately 12:14 PT; implementation and verification completed approximately 12:48 PT.

## User direction

Extend WWM into a monorepo with independent education pages to hone for ages 4–6, following the agreed default-path → parent AI customization → reviewed family fork idea. Preserve educational HTML intent separately from game mechanics and record the broader opportunity afterward.

## What changed

The repository was already a working pnpm monorepo; no game migration was needed. Added `@wwm/education` and `@wwm/learning`, root commands, CI build/browser acceptance, and education documentation. The root README no longer describes the entire repository as research-only. Existing game and backend source remain unchanged.

Six original early-math activities are generated as complete static pages. Parent notes and the versioned JSON contract are available before JavaScript. Browser enhancement supplies choices, hints/retry, optional speech, and local family introductions. Parents export a prompt to their preferred AI tool, import the response, review before accepting, and can back up, export HTML, or restore the baseline. No provider calls, accounts, cloud learner records, or in-maze hooks were introduced.

## Verification

- `pnpm install --offline`: passed; workspace lockfile updated without new dependency versions.
- `pnpm build:education`: passed; seven standalone HTML entry points and assets emitted.
- Education/learning typechecks: passed.
- Focused unit tests: 11 passed.
- Production-browser acceptance: 5 passed against the built preview. Covered all six activities, hints and wrong answers, no-JS reading, invalid import, review-before-accept, saved-version reload, HTML download, baseline restore, viewport sizing, long personalized text, and corrupt-storage recovery.
- Static output readback: readable objective, learning data, and direction contract present in built HTML.
- Independent finish review: pass for scoped local pilot; all six review items resolved. Yellow geometry contrast, long-text wrapping, counting instruction consistency, mobile spacing, settled CTA rendering, and content-source documentation were checked.
- `git diff --check`: passed.
- `pnpm check`: workspace typecheck and lint passed (one pre-existing CSS specificity warning and one info diagnostic). Test phase: **1,064 passed, 15 skipped, 2 failed**. The existing `apps/extension/test/extension.e2e.test.ts` hit Chrome's `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` quota, then its dependent Share test accessed a missing game page. These failures remain unresolved; no extension code was changed. The education E2E tests were run separately against the production preview because ordinary workspace runs skip them without a base URL.

Screenshots were inspected at `/tmp/wwm-education-final/{desktop-path,mobile-path,desktop-activity,mobile-activity}.png`; these are local QA artifacts, not committed assets or proof of physical-device testing.

## Independent finish verdict: pass for the scoped local pilot

| Review finding | Final verdict |
| --- | --- |
| Yellow learning-shape contrast | Resolved; at least 3.21:1 across choice states |
| Personalized text overflow | Resolved; wrapping plus long-text browser acceptance |
| Counting instructions versus tap behavior | Resolved |
| Mobile heading whitespace | Resolved |
| Pale CTA screenshots | Resolved in settled production screenshots |
| Missing content-source notes | Resolved |

No remaining material findings within the review scope. This verdict does not cover educator approval, physical-device use, educational effectiveness, or the separate extension-test failures.

## Corrections and limits

The design context helper initially treated the not-yet-created app as missing product context; confirmed conversation decisions were recorded in `apps/education/PRODUCT.md`. The visual system was inherited from WWM. Independent review found and prompted fixes for low-contrast yellow stimuli, long personalized copy overflow, tap/count wording, and mobile heading whitespace. No new human intervention was needed.

Material is pilot content awaiting educator and family review, not a full curriculum or efficacy claim. The portable contract is experimental. Live AI authoring, learner identity, hosted forks, game integration, and deployment are future work. See `docs/education/opportunity.md` for the evidence and decision sequence.
