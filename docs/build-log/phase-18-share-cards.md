# Build log: Phase 18 (share cards: link previews for invites, scores, runs and journeys)

- **Agent:** Claude Opus 5.5 (1M context), run as a Claude Code sub-agent in an isolated git worktree (branch
  `feat/share-cards`, from `origin/launch/config-legal-story`), with the `cloudflare`, `workers-best-practices` and
  `impeccable` skills loaded. Limits and APIs were checked in the Cloudflare docs (Worker size, startup time,
  module `rules`, `run_worker_first`, `_headers` vs Worker responses).
- **Start / end:** 2026-09-25, about 19:10Z to 20:10Z.
- **Environment:** macOS (arm64), Node 26, pnpm 11.5, wrangler 4.140.0 (workerd), Playwright Chromium,
  fonttools 4.60 (temporary venv in /tmp, only to cut the font subsets).

## Instructions received (summary)
Pasting a World Wide Maze link into LinkedIn, X, iMessage, Slack, Discord or WhatsApp should unfurl into a card in
the game's visual language. Worker-side, dynamic and cached:
- Render 1200×630 PNGs in the Worker within bundle/CPU limits, with the game's fonts (licences recorded), cached in
  R2 under a content-addressed key, long immutable cache headers.
- Card types: stage invite (`/s/:stageId`), high score (`/s/:stageId/r/:scoreId`, numbers from the D1 row only;
  `?beat=&by=` links keep working but get the plain invite), run/global rank, web journey (`/j/:trail`), a default
  card, `og-log.png` for `/log`. Pairing links (`/c/…#p=…`) stay generic.
- Crawler-readable Open Graph/Twitter tags on every shareable route, humans still land in the app, CSP intact.
- In-game: the right link after a clear, a high score or a journey; Web Share (with the image) on phones, copy on
  desktop; a preview of the card on the result screen; en + ja.
- Safety: escape everything, cap lengths, never show unverified numbers as verified, rate-limit renders.
- Tests (unit, workerd integration for every card, crawler UAs), sample cards reviewed at unfurl size, a draft PR
  against `launch/config-legal-story`. Avoid the CI fixes happening on `fix/ci-runners`.

## What was built
**Renderer (`apps/worker/src/cards/`, new)**
- Hand-written SVG templates (`svg.ts`) rasterised by **resvg** (`@resvg/resvg-wasm` 2.6.2, MPL-2.0). No Satori/Yoga:
  the five layouts are fixed, so a small layout kit (`text.ts`: measure, balanced wrap, fit-to-box, ellipsis) on top
  of a 120-line TrueType metrics reader (`font.ts`: cmap, hmtx, name) is enough, and resvg shapes the text itself.
- workerd forbids compiling WASM at runtime, so the `.wasm` is imported as a module wrangler precompiles (the same
  approach Phase 10 used for Rapier), and the fonts are `Data` modules (`rules` in `wrangler.jsonc`, `fallthrough`
  so the default `**/*.bin` rule still applies). WASM and fonts are initialised on the first render in an isolate
  (`render.ts`, loaded with a dynamic import), so other requests pay nothing.
- **Fonts:** static, subset instances of the game's own faces: Unbounded Black/Bold and Figtree SemiBold/ExtraBold
  (OFL 1.1), cut from the Google Fonts variable TTFs by `fonts/build-fonts.sh` (fonttools). 169 KiB for all four.
  resvg draws only a variable font's default instance, hence the static cuts. `CARD_TEXT_RE` is exactly the
  characters both headline faces have (a test walks every code point); titles outside it (CJK, emoji) fall back to
  the host as the headline.
- **The picture:** the stage drawn from its own geometry in an oblique map view: islands raised to their levels with
  blue slab sides, the page screenshot on their tops (clipped per level), yellow rails, green bridges, red
  elevators, teal items, the ball on the start and the cyan goal beam; soft shadow on the COLOR_TRIANGLE facets.
  Curated stages with an R2 hero shot (`share/<stageId>.png`, Phase 10) show that engine render instead.
- **Page texture:** stage textures are WebP and resvg can't decode WebP (checked with 2.6.2 and 2.7.0-alpha.2), so
  the card uses the capture's 1× **PNG** screenshot. `png.ts` streams it through the platform zlib inflater, only
  un-filters rows above the slice, box-downscales rows inside it straight into a ≈ 560 px RGB buffer, cancels the
  stream after the slice, and re-encodes a small PNG (`CompressionStream`). Peak memory is two scanlines plus the
  thumbnail; the last slice of a 4 730 px page takes ≈ 60 ms in Node.
- **Card data (`data.ts`, `load.ts`)**: every card is a pure function of a `CardData` value built from server state
  only. R2 key `cards/<kind>/<sha256(renderer version + site + data)>.png`; the page puts the first 16 hex digits in
  the image URL (`?v=`), and a matching `v` is served `immutable` for a year (else 10 minutes). Rank changes, a new
  hero or a renderer bump give a new key; the old object ages out (cron sweep, 30 days).
- Card kinds: `stage` (invite: headline "Play “<title>” as a maze", host, difficulty stars for curated runs or the
  difficulty, "Stage x of y"), `score` (name, the score, "#N on this stage", "Replay verified" chip and the item
  breakdown only for verified rows, else "Finished in m:ss"), `run` (name, "#N on the World Wide Maze leaderboard",
  total, sites/stages, the sites as island tiles), `journey` (the chain of hosts as floating island tiles joined by
  bridges with the portal colours and monograms from Phase 13, first stops + last, "+N"), `site` (the title-screen
  wordmark next to the practice stage).

**Worker routes (`src/routes/share.ts`, `share-html.ts`)**
- `GET /api/cards/:kind/:id.png`: load → key → R2 hit, or render (rate-limited: 30 per IP per 10 min and 1 200 per
  hour in total through the `Limiter` DO; over the limit a card redirects to the default card) → `waitUntil` R2 put.
  `x-card: hit|render`, `x-render-ms`. `cross-origin-resource-policy: cross-origin` for crawlers.
- `/s/:stageId`: the invite card. **`?beat=&by=` no longer reach the preview text or image** (before, the og:title
  said "Beat <by>’s <beat> points", which anyone could spoof); they still travel on to `/play/:id` for the game's
  challenge banner.
- `/s/:stageId/r/:scoreId` and `/r/:scoreId`: score and run permalinks; the score page forwards to
  `/play/:stageId?beat=<score>&by=<name>` with the **server's** values.
- `/`, `/log`, `/j/:trail`: the Worker fetches the app shell from the assets binding and replaces its preview tags
  (`injectMeta`), so crawlers read a specific card and people get the app as before. `_headers` doesn't apply to
  Worker responses, so the shell goes out with `SPA_SECURITY_HEADERS` (a test keeps it identical to `_headers`).
  Without an assets binding (local `wrangler dev`, tests) these routes answer with a plain tag page.
- `index.html` gains generic tags for every other app route (`/about`, `/play/…`, and the pairing links `/c/…`,
  which therefore always unfurl as the generic card; the pairing token stays in the fragment).
- `run_worker_first`: `/api/*`, `/s/*`, **`/r/*`, `/j/*`, `/`, `/log`**. `/log` uses the Phase 16 image, now also a
  static asset at `/og/log.png`.
- Journey links are written by the sharer's browser, so the card distrusts them: hosts only (never the titles),
  hosts must look like hostnames and pass the name profanity filter (else "another site"), the name must pass the
  leaderboard rules, the total is drawn only if ≤ 20 000 per stop and is never called verified, and stops whose ref
  is a server stage use that stage's real host.
- `POST /api/scores` returns `scoreId` (16 random base64url chars) for stage and run entries (migration
  `0004_score_share_ids.sql`: `share_id` + unique index on both tables, `detail_json` = the verified replay's
  items/time bonus, NULL when unverified). Old rows have no permalink.

**Game (`apps/web`)**
- `ranking/share.ts`: `scoreUrl`, `runUrl`, `cardImage`, `fetchCardFile`; `shareLink` opens the share sheet only
  on touch devices (`pointer: coarse`), with the card attached when `navigator.canShare({files})` allows (the link
  goes in the text too, since some apps drop `url` next to a file), and copies the link on desktops.
- `ShareButton` takes `image` and fetches the card before the tap (iOS drops `share()` after a slow await);
  `CardPreview` shows the card in a chamfered frame with the pastel facets as its placeholder, hidden if it fails.
- Result screen: a card thumbnail next to "Challenge a friend" (server stages). Ranking: the run card preview, the
  Share button links `/r/<scoreId>`, and every submitted stage row gets its own Share (`/s/<id>/r/<scoreId>`).
  Journey section: the journey card preview (ranking) and the file-sharing path. Strings en + ja.
- Vite dev proxies `/r/` to the Worker like `/s/`.

## Measurements
- **Bundle** (`wrangler deploy --dry-run`): base 13 371.5 KiB / 4 064 KiB gzip → **16 055.9 KiB / 5 155 KiB gzip**
  (+2 684 KiB, +1 091 KiB gzip): resvg WASM 2 421 KiB (925 KiB gzip), four fonts 169 KiB (92 KiB gzip), the practice
  texture 55 KiB, JS +40 KiB. The Workers limit is 64 MiB uncompressed (the compressed limit was removed on
  2026-09-04). Nothing new runs at startup.
- **Render time in workerd** (local, M-series; wall ≈ CPU, the work is synchronous): stage 315 ms (first render in
  the isolate, incl. WASM instantiation and font parsing), stage with the fixture 181 ms, score 244 ms, run 93 ms,
  journey 92 ms, site 223 ms. Whole first request including D1/R2 reads and the screenshot thumbnail: 98–356 ms.
  Cached requests are an R2 read. The Worker's CPU limit is 300 s.
- PNG sizes 120–390 KiB.

## Sample cards (reviewed) — `docs/build-log/assets/share-cards/`
Node renders with fixture stages and captures: `stage-invite.png` (Hacker News), `stage-invite-long-title.png`
(GOV.UK, 3 lines + ellipsis), `stage-invite-hero.png` (curated hero), `stage-invite-ja.png` (Japanese title → host),
`score-verified.png`, `score-unverified.png` (32-char name, rank 128, no breakdown), `run-rank.png`,
`run-one-site.png`, `journey.png` (7 stops: first four, "+2", last), `site-default.png`. Worker renders from the
integration test (`worker-*.png`, printed host `localhost`). In the game: `ui/result-card-preview.png`,
`ui/ranking-run-card.png` (after a real replay run on a seeded server stage, `wrangler dev` + Vite),
`ui/dev-ranking-preview.png`.

Review, in two rounds, at full size and at 552 px (LinkedIn's unfurl width): headlines stay ≥ 26 px at 552 px, the
number on score cards reads first, the wordmark and colour roles make the source obvious at thumbnail size. Round 1
fixes: island sides were drawn down to the base level (read as stray blue slabs) → constant slab thickness; journey
labels collided with the next tile → a vertical path with labels beside the islands; leading spaces were collapsed by
XML ("cocktail_hancockscored"); orphaned last words → balanced wrapping; big empty gap in short invite plates →
the headline group is centred. Round 2: a host broken mid-word ("ja.wikipedia.o/rg") → prefer a smaller size that
keeps words whole; the host chip repeated the headline → hidden then; chain labels truncated → shrink to fit.

## Attempts that failed, and why
1. **WebP in resvg:** the first prototype drew nothing where the stage texture should be. resvg-wasm 2.6.2 (and the
   2.7 alpha) decode PNG/JPEG/GIF only. Fixed by using the capture's PNG screenshot through the streaming crop.
2. **Unicode escapes in regexes turned into raw characters** when files were written, so a regex held invisible
   literal format characters (and TypeScript rejected one range). Rewrote them from code points with a script and
   checked with `cat -v`; the unit tests now exercise each class.
3. **`tsconfig.node.json`** failed because a Node test imported the Worker-typed loader (Phase 10's lesson): the
   pure `cardTitle` moved to `text.ts`.
4. **The glyph coverage test** found that the subsets lack some Latin Extended-A letters and most of U+2010–203A:
   `CARD_TEXT_RE` is now generated from the real intersection of the two faces.
5. The integration harness' `afterAll` timed out at the default 10 s when run beside the scores suite: 60 s now.
6. `wrangler dev` on 8799 collided with another agent's workerd: used 8812/5199 for the UI check and stopped only
   my own servers.
7. Wrangler warned that a `rules` entry without `fallthrough` disables the default `**/*.bin` rule: added.

## Manual human interventions
None.

## Test evidence
- `pnpm check`: typecheck, Biome (one pre-existing warning in `story.css`), **1 017 tests passed**, 13 skipped.
- `apps/worker/test/cards.test.ts` (21, Node): XML escaping and forbidden characters, bidi/invisible stripping,
  title fallback, glyph coverage of every admitted character, wrap/fit/balance, content keys, bounded stage art,
  journey distrust rules, "verified" only for verified rows, the PNG crop/encode round trip, `injectMeta` and
  `sharePage`, and one resvg render per card kind.
- `apps/worker/test/cards.integration.test.ts` (40, workerd): every card kind renders to a 1200×630 PNG and is then
  an R2 hit with identical bytes; unknown ids/kinds and malformed escapes are 404; `?v=` → immutable; for each of
  **LinkedInBot, Twitterbot, Slackbot, facebookexternalhit**, the invite, verified score, unverified score, run,
  journey, home and build-log pages carry title, canonical, og:title/description/url/image (+ width, height, alt)
  and twitter:card `summary_large_image`/image; `?beat=999999&by=spoofer` stays out of the preview but reaches the
  play link; a score id under the wrong stage is 404; a hostile journey (profane name, 99 999 999 points,
  `<script>` title) is cleaned.
- `apps/worker/test/security.test.ts`: `run_worker_first`, card CORP, SPA headers identical to `_headers`.
- `apps/worker/test/scores.integration.test.ts`: the share-page test now asserts the opposite of before (no link
  numbers in the preview); the run submission returns `scoreId`.
- `apps/web/test/share-cards.test.tsx` (7): permalinks, share sheet with the file on phones (and without when files
  aren't shareable), copy on desktops, the card file only from an image response, the client keeps valid
  `scoreId`s, the preview markup.
- The existing game e2e (Chromium + workerd) still passes; the in-game screenshots above come from the same flow.

## Remaining defects / follow-ups
- **Validators need a public URL:** LinkedIn Post Inspector, the X card validator and the Facebook debugger were not
  run. After deploy: check `/`, one `/s/…`, one `/s/…/r/…`, one `/r/…` and one `/j/…` in each.
- `index.html`'s generic tags point at `https://wwm.ewj.dev` (Previews show the production default card for routes
  without their own card). A build-time origin would fix that.
- Existing scores (before migration 0004) have no permalink; only new submissions do.
- The run card could show the run's best stage as its picture instead of the host tiles.
- Titles in scripts the fonts don't cover fall back to the host; a CJK subset (Noto Sans JP) would add ≈ 1–4 MB.
- If a curated hero shot is replaced, the card re-renders (the etag is in the key); the old R2 object ages out.
- CI on GitHub is red for environment reasons being fixed on `fix/ci-runners`; this branch relies on local
  `pnpm check`.

## Contract Change Requests
- **CCR-18-1 (additive): `SubmitScoreResponse.scoreId?: string`.** `POST /api/scores` returns a 16-character
  base64url permalink id for both `kind: 'stage'` and `kind: 'run'`. Needed so the game can share a score whose card
  comes from the server row. Consumers: `apps/web/src/ranking/client.ts` (already reads it, validated), the game's
  ranking screen.
- **CCR-18-2 (additive, §7 routes):** document `GET /s/:stageId/r/:scoreId`, `GET /r/:scoreId` (share pages),
  `GET /api/cards/{stage|score|run|journey|site}/:id.png` (card images, `?v=` = content version), and that
  `/s/:stageId?beat=&by=` previews no longer repeat the link's numbers (they still reach `/play`).
- **CCR-18-3 (additive, §10.1):** `/j/:trail` now has a server-rendered preview; the card shows hosts only and a
  bounded, unverified total. No change to the trail format.
