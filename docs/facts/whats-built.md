# What exists today: the World Wide Maze tribute as built

A short, maintained statement of what this 2026 rebuild actually contains, what it does not contain, and how AI
was involved. It is the current-state summary for the docent. The sources behind it are the build logs in
`docs/build-log/` (each cited below by its file name), the production settings in `.github/workflows/ci.yml` and
`apps/worker/wrangler.jsonc`, the measured build story in `content/build-story/timeline.json`, and the "Since
launch" list in `content/build-story/since-launch.json`. Plans and proposals (`RESEARCH.md` Parts 2–8,
`research/recreation-plan.md`, `plans/phase-*.md`) describe intentions; where they differ from this page, this page
and the build logs describe what was built. `pnpm record:drift` reports where this page has fallen behind.

## Features in the live site

The tribute is live at https://wwm.ewj.dev, and its source is public (MIT licence) at
https://github.com/ewjdev/world-wide-maze.

### The launch build (to 2026-09-25)

- **Reference and fidelity spec** (Phase 01, `phase-01`): the 2013 game's rules and constants, read from the
  archived code and localization, written up as the spec the rebuild follows.
- **Foundation** (Phase 02, `phase-02`): the monorepo, the shared contract types and the capture fixtures.
- **Stage builder** (Phase 03, `phase-03`, `phase-09-builder-issues`): a deterministic TypeScript program that
  turns a page screenshot and its element boxes into islands, bridges, a maze, items, rails, start and goal,
  following the 2013 image-processing approach. It is not an AI model.
- **Renderer** (Phase 04, `phase-04`): three.js with WebGPU or WebGL 2, the ocean, the glowing ball, fireworks.
- **Physics** (Phase 05, `phase-05`): deterministic Rapier physics.
- **Phone controller** (Phase 06, `phase-06`, `phase-06-device-test`): pairing through a Durable Object room with
  a QR code or six-digit code, tilt input, plus keyboard and gamepad.
- **Capture service** (Phase 07, `phase-07`): any web address is captured with Cloudflare Browser Rendering and
  built into stages.
- **Game** (Phase 08, `phase-08`, `phase-08-playtest`): title, tutorial, HUD, map, synthesized audio, results and
  rankings.
- **Solver bot and validation** (Phase 09, `phase-09`): a path-planning program (A* search plus a steering
  controller) that plays every generated stage to check it can be finished, rerolling the maze seed when it can't.
  It is an algorithm, not a language model.
- **Showcase** (Phase 10, `phase-10`): `/about` (credits, timeline, evidenced/reconstructed/new table), `/making`,
  `/log` (the build record), leaderboards with replay verification and ghost runs, share links.
- **Launch hardening** (Phase 12, `phase-12`): performance work, security headers, rate limits, kill switches.
- **Link portals** (Phase 13, `phase-13`): links on a page become portals to other sites' mazes.
- **"Maze this page"** (Phase 14, `phase-14`): a browser extension and a bookmarklet. The extension can be
  downloaded from `/mazify`; it is not published in any store.
- **AI docent** (Phase 15, `phase-15`): the grounded, cited question panel on `/about` and `/log`. Its model was
  chosen with a held-out evaluation set and runner (Phase 15b, `phase-15b`).
- **Build story** (Phase 16, `phase-16`): the build clock and the "AI found these bugs" gallery on `/log`.
- **Deployment** (Phase 17, `phase-17`): production and pull-request preview environments on Cloudflare Workers;
  every merge to `main` deploys.
- **Share cards** (Phase 18, `phase-18-share-cards`): link-preview images for invites, scores, runs and journeys.

### Since launch

Listed on `/log` under "Since launch", each with its status.

- **Explicit analytics** (`analytics`): a first-party endpoint forwards an allow-list of game events to PostHog;
  Do Not Track and Global Privacy Control are honoured, and `/privacy/analytics` (English and Japanese) lets
  players opt out.
- **Lessons with Pip** (Phases 19, 20 and 22; `phase-19`, `phase-20`, `phase-20-m4b`, `phase-22`,
  `phase-22-locks`, `phase-22-game`, `phase-22-page`): short lesson pages for young children at `/learn`, led by
  Pip in the Sky Islands theme, with rounds, hints and recorded voice lines. Pip gates and locked bridges put the
  same questions inside the maze.
- **URL catalog and content review** (Phase 21, `phase-21`): every captured site is kept in a durable catalog
  with private evidence, and a new capture waits for a person to approve it in the operator's review console
  before anyone else can play it.
- **Race mode** (Phases 24–29; `phase-24-race-mode`,
  `phase-25-race-jumps`, `phase-26-race-route-balance`, `phase-27-race-mazes`, `phase-28-race-bends-turbo-lives`,
  `phase-29-race-elevation-flow`): `/race`, a third way to play, with fourteen authored courses, island jumps,
  earned and stacked turbo, three lives, climbs and descents, and a personal ghost kept on the device.
  Physical-phone and human playtest gates are still open.
- **Cost controls** (`cost-controls`): a monthly budget that admits each paid job, pauses optional services as it
  fills and stops new paid work before the cap; the operator can pause services by hand, and offline practice makes
  no API calls.
- **Performance programme** (`performance-audit-2026-09-27`, `performance-regression-p1`, `performance-render-p1`,
  `performance-cache-p1`, `performance-ghost-p1`, `performance-p1-staging`, `performance-device-harness`,
  `performance-idle-p2`, `performance-input-p2`, `performance-audio-p2`, `performance-recording-chunks-p2`,
  `performance-resources-p2`, `performance-startup-p2`, `performance-p2-staging`,
  `performance-portal-test-repair`, `performance-p2-followup`, `performance-main-integration`,
  `performance-ghost-ci-repair`, `performance-test-quarantine`): quality adapts to measured frame times, unused
  graphics memory is released, ghost preparation and audio synthesis run off the main thread, screenshot storage
  is bounded, input recordings are compact, and idle or hidden pages do less work. A later change made the home
  page usable before the game code loads (`docs/launch/home-performance-implementation.md`).
- **Play on one phone** (`mobile-browser-game`, `phase-08-mobile-layout`): no second screen needed, with an
  on-screen stick, Jump, Turbo and Pause, then tilt to steer and tap to jump, and a layout repaired for small
  screens.
- **Lesson depth and family progress** (Phase 31, `phase-31`, `phase-31-m2`, `phase-31-m3`, `phase-31-m4`,
  `phase-31-m5`): lessons gained objectives and fresh examples on every play; progress is kept on the device and,
  for a signed-in family, synced to a parent account (passkey or email link); the maze records the same evidence at
  Pip gates. Family accounts are open to an allow-list only (the owner's family) until the privacy and educator
  reviews.
- **Operator tools** (`docs/launch/jev-admin.md`, `docs/launch/runbook.md`): an Access-protected `/admin` console
  for reviewing captures, costs and restarts, and Jev, a TypeSafe AI agent that plays mazes for the operator to
  watch under a daily spending cap. Visitors never reach either.
- **Keeping this record current** (`build-record`): the "Since launch" list on `/log`, this page's citations, and
  an advisory report on every pull request (`pnpm record:drift`) that says where the record lags the work.

### Built but not switched on

- **Portal windows** (`portal-windows`): seeing the next site through a link portal before you go (a postcard, a
  tear you push through, a cut into the site's intro). Merged, and on in pull-request previews only, until its
  production sign-off.
- **Bridge Builders** (Phase 23, `phase-23`): the first slice of a longer lesson plan (a lesson format, a session
  reducer and on-device storage), merged with its sampler hidden. The later milestones were not built.

### Paused by the operator

Cost controls let the operator pause paid services. The last recorded operator receipt
(`docs/launch/capture-restart-2026-09-29.md`, 2026-09-29) kept the docent, leaderboard scores, share cards,
telemetry, Jev and automated moderation paused. Whether each has been resumed since is not recorded in the
repository.

## Planned but not built

These ideas appear in the research plans but do not exist in the tribute:

- **AI Remix mode** (Phase 11 in `plans/00-overview.md`) was optional and was never started. There is no AI
  semantic stage theming: no model reads a page to label regions (navigation, ads, comments, footer) or maps them
  to gameplay, and there are no AI hazard islands.
- No AI model names stages, writes flavour text or level titles, picks music, or sets difficulty. Music is a fixed
  set of synthesized loops, and a stage's difficulty stars come from the solver bot's measured par time.
- No AI model moderates captured pages in production. Moderation runs in manual mode (`MODERATION_MODE=manual`):
  a person approves each new capture. An automatic classifier (`claude-haiku-4-5`) exists in the code and is
  switched off. Abuse is also handled with rate limits, an operator kill switch, a takedown and opt-out procedure,
  and a word-list filter for leaderboard names.
- No vision model removes cookie banners or reconstructs blocked sites from uploaded screenshots.
- No live AI commentary or announcer.

## How AI was used to make it

- The launch build's code, tests and build logs were written by Claude Code agents running Claude Opus 5.5 (1M
  context). A main Claude Code session acted as the orchestrator: it wrote the phase plans and the shared
  contracts, started sub-agents in parallel waves, each in its own git worktree, checked their hand-off reports
  against gates, and merged their work.
- Since launch, work has also been done by OpenAI Codex agents (GPT-6 family), as their logs state: analytics,
  cost controls, the performance programme, and Phases 19, 21, 24, 25 and 26. Claude Code agents wrote the other
  later logs that name an agent (Phases 20, 22 and 31, portal windows); a few later logs name none.
- The owner (the human who commissioned the rebuild) directed it: the briefs, approving the plan and each wave,
  choosing the names, domain, public repo and licence, approving the curated stage list, creating the Cloudflare
  account and keys, reporting bugs, approving production switches, and physically tilting the iPhone for the
  controller test, which agents cannot do.
- The build logs record each agent's instructions, failed attempts and test evidence. The launch build's logs
  record no manual human changes to the code.
- Pip's voice lines were generated once, offline, with ElevenLabs (`eleven_v3`) through Cloudflare AI Gateway, by
  an operator command (`pnpm learning:voice`); the site plays the stored recordings.
- The project makes no claim that AI made the work faster or cheaper than the 2013 team's work, and no comparison
  with the original team's effort.

## Where AI runs in the live site

The only model call a visitor can trigger is this docent. It sends the visitor's question and a few retrieved
excerpts from the project's own research notes and build logs to Claude (`claude-haiku-4-5` by default) through
Cloudflare AI Gateway, and every answer must cite those excerpts. It is subject to the cost controls above.

Two model calls run for the operator only, behind Cloudflare Access: the lesson-draft agent (Phase 31,
`claude-sonnet-5-5` through AI Gateway), whose drafts a person reviews before anything is published, and Jev
(TypeSafe's API, called directly, off by default). Everything else (capture, the stage builder, physics, the
solver bot, Race, lessons, scoring, moderation) is ordinary code with no model in it.

## Numbers from the build story

Measured in `content/build-story/timeline.json` at snapshot `f265f74`, which covers the launch build only (later
work is listed under "Since launch" above and on `/log`):

- 29 agent runs: 16 phase runs, 7 follow-up runs and 6 helper runs, all Claude Opus 5.5 (1M context).
- 855.8 minutes of agent time and 98.8 minutes of orchestrator time, with at most 6 agents running at once.
- The owner sent 13 messages (566 words).
- 96 commits; 922 tests passing (14 skipped); 58,330 source lines and 14,847 test lines.
- 19 build logs recording 121 failed attempts and 0 manual human interventions.
