# Mobile game layout repair — October 19, 2026

The site chooser after Start created a 469px horizontal scroll area in a 390px phone viewport. Its grid's intrinsic sizing widened the heading, URL form, lesson loader and practice card together.

The game shell now constrains menu grids to their available width. Phone layouts stack the Transform action and practice card, wrap long button labels, and keep touch targets at least 44px high. Menu scrolling starts below the persistent settings bar and respects safe-area insets. Settings and pause panels scroll in short viewports. Pause and Race panels sit above the joystick deck, and ranking name fields remain inside their panel in WebKit.

## Verification

- `CI=1 pnpm exec vitest run apps/web/test/mobile-layout.e2e.test.ts`: 2 passed.
- `CI=1 WWM_LAYOUT_BROWSER=webkit pnpm exec vitest run apps/web/test/mobile-layout.e2e.test.ts`: 2 passed.
- English and Japanese chooser layouts: 320×568, 390×844, 430×932, 768×1024, 844×390 and 1440×900.
- Instructions, invalid URL feedback, built-in lesson loading, the last site's vertical scroll reachability, short-landscape settings, practice pause/resume, results, rankings and Race entry. Pause and Race action checks include hit testing above the joystick deck.
- Final 390px WebKit chooser: `clientWidth = scrollWidth = 390`.
- Workspace typechecks, web typecheck, web production build, changed-file Biome checks and `git diff --check` passed.
- The mechanical design detector reported the existing colored thumbnail stripe; the incumbent visual treatment was retained.

In the initial shared checkout, `pnpm check` stopped at formatting errors in unrelated learning-package files being edited concurrently. A separate full-suite run encountered extension E2E timeouts and a Vite hot-reload context error during workspace edits; it was stopped after those failures. The PR branch was then based directly on `main`, excluding the unrelated lesson-planning commits; repository lint and the web typecheck pass on that branch. Full-suite acceptance remains subject to GitHub CI.

These are browser-emulation receipts, not physical iPhone/Android qualification. No production deployment was performed.

## Saved review images

- [Phone chooser](assets/mobile-layout/select-390.png)
- [Phone practice card](assets/mobile-layout/practice-390.png)

The regression suite can save its full screenshot matrix with `WWM_LAYOUT_SHOTS=/tmp/wwm-mobile-layout` and can select WebKit with `WWM_LAYOUT_BROWSER=webkit` (requires the Playwright WebKit browser).

Each run uses its own temporary Vite dependency cache, preventing concurrent browser suites from overwriting one another's optimized modules.
