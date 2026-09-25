# Capture fixtures

Real pages captured with `pnpm fixture:capture <url> <slug> [--dark]` (tools/fixture-capture). They were captured
through the same `@wwm/capture-script` sequence the hosted service uses. Each folder has:

- `capture.json`: a `CaptureBundle` (contracts §2). It passes `parseCapture`. `screenshot.path` is relative to this file.
- `screenshot.png`: 1280 wide, full page, height capped at 6000 px (`MAX_PAGE_HEIGHT_PX`).

Capture settings: Playwright Chromium 1.63 (headless shell), viewport 1280×800, DPR 1, `reducedMotion: reduce`,
locale en-US, timezone UTC, and the default (honest) headless user agent.

All pages were captured on **2026-09-25 (UTC)**. The exact timestamps are in each `capturedAt`.

| Slug | Role | URL | Page size | Notes |
|---|---|---|---|---|
| `wikipedia-article` | long article | https://en.wikipedia.org/wiki/Labyrinth | 1280×6000 (capped) | Text CC BY-SA 4.0; images are individually licensed on Commons. The sticky Vector header is hidden (`fixed: true` in the JSON). |
| `hn-front` | dense list | https://news.ycombinator.com/ | 1280×1214 | Tiny text, a table layout, and very few backgrounds. Content is user-submitted titles. Y Combinator terms apply, used here as a test fixture only. |
| `bbc-news-grid` | card grid | https://www.bbc.com/news | 1280×6000 (capped) | **Licensing concern:** news photos and text are © BBC and agencies. Keep it as an internal test fixture only and never ship it as a curated stage. Drop it or replace it with `govuk-card-grid` if the repo goes public. The consent banner was removed, 4 ad slots are classified `adlike`, and the fixed masthead is hidden. |
| `govuk-card-grid` | card grid / sections (permissive alternative) | https://www.gov.uk/ | 1280×4550 | Open Government Licence v3.0 (crown copyright). The cookie banner was dismissed through the text fallback ("Reject additional cookies"). |
| `mdn-dark-docs` | dark theme docs | https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects | 1280×3671 | Captured with `--dark` (`prefers-color-scheme: dark`). Content is CC BY-SA 2.5 by Mozilla contributors. It includes 2 third-party ad banners (top and a purple footer band), which are not classified `adlike` because their markup has no ad hints. |
| `example-sparse` | sparse landing | https://example.com/ | 1280×800 | IANA reserved example domain. It has 4 elements. |
| `image-gallery` | image-heavy | https://commons.wikimedia.org/wiki/Commons:Picture_of_the_day | 1280×6000 (capped) | Freely licensed Picture-of-the-day images (each under its own CC/PD license on Commons). The page changes daily. |

## Failed or replaced attempts
- `https://en.wikipedia.org/wiki/Marble_run` redirected to "Rolling ball sculpture", which was only 2707 px tall. It was replaced by *Labyrinth*, which reaches the 6000 px cap and makes a better "long article".
- The first GOV.UK capture left the consent banner on the page because no known selector matched. This led to the text-based consent fallback in `@wwm/capture-script`, and the page was recaptured.

## Re-capturing
Pages change, so re-capturing gives a different bundle and screenshot. Tests only assume the structural
properties (valid bundle, 1280 wide, height ≤ 6000, elements inside the page). To refresh:

```sh
pnpm --filter @wwm/fixture-capture browsers   # once: installs Playwright Chromium
pnpm fixture:capture https://en.wikipedia.org/wiki/Labyrinth wikipedia-article
pnpm fixture:capture https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects mdn-dark-docs --dark
```

Other phases add files **only in their own subfolder** (for example `fixtures/replays/` in Phase 05).
