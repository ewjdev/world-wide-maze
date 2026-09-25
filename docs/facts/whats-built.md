# What exists today: the World Wide Maze tribute as built

A short, maintained statement of what this 2026 rebuild actually contains, what it does not contain, and how AI
was involved. It is the current-state summary for the docent. The sources behind it are the status board in
`plans/00-overview.md`, the build logs in `docs/build-log/` and the measured build story in
`content/build-story/timeline.json`. Plans and proposals (`RESEARCH.md` Parts 2–8, `research/recreation-plan.md`,
`plans/phase-*.md`) describe intentions; where they differ from this page, this page and the build logs describe
what was built. Update this file whenever a phase merges or is dropped.

## Features in the live site

The tribute is live at https://wwm.ewj.dev, and its source is public (MIT licence) at
https://github.com/ewjdev/world-wide-maze. What was built and merged, phase by phase:

- **Stage builder** (Phase 03): a deterministic TypeScript program that turns a page screenshot and its element
  boxes into islands, bridges, a maze, items, rails, start and goal, following the 2013 image-processing approach.
  It is not an AI model.
- **Renderer** (Phase 04): three.js with WebGPU or WebGL 2, the ocean, the glowing ball, fireworks.
- **Physics** (Phase 05): deterministic Rapier physics.
- **Phone controller** (Phase 06): pairing through a Durable Object room with a QR code or six-digit code, tilt
  input, plus keyboard and gamepad.
- **Capture service** (Phase 07): any web address is captured with Cloudflare Browser Rendering and built into
  stages.
- **Game** (Phase 08): title, tutorial, HUD, map, synthesized audio, results and rankings.
- **Solver bot and validation** (Phase 09): a path-planning program (A* search plus a steering controller) that
  plays every generated stage to check it can be finished, rerolling the maze seed when it can't. It is an
  algorithm, not a language model.
- **Showcase** (Phase 10): `/about` (credits, timeline, evidenced/reconstructed/new table), `/making`, `/log`
  (the build record), leaderboards with replay verification and ghost runs, share links.
- **Launch hardening** (Phase 12): performance work, security headers, rate limits, kill switches.
- **Link portals** (Phase 13): links on a page become portals to other sites' mazes.
- **"Maze this page"** (Phase 14): a browser extension and a bookmarklet. The extension is not published in any
  store.
- **AI docent** (Phase 15): the grounded, cited question panel on `/about` and `/log`.
- **Build story** (Phase 16): the build clock and the "AI found these bugs" gallery on `/log`.
- **Deployment** (Phase 17): production and pull-request preview environments on Cloudflare Workers.
- **Share cards** (Phase 18): link-preview images for invites, scores, runs and journeys.

## Planned but not built

These ideas appear in the research plans but do not exist in the tribute:

- **AI Remix mode** (Phase 11 in `plans/00-overview.md`) was optional and was never started. There is no AI
  semantic stage theming: no model reads a page to label regions (navigation, ads, comments, footer) or maps them
  to gameplay, and there are no AI hazard islands.
- No AI model names stages, writes flavour text or level titles, picks music, or sets difficulty. Music is a fixed
  set of synthesized loops, and a stage's difficulty stars come from the solver bot's measured par time.
- No AI model moderates captured pages. The build pipeline has a moderation hook, and it currently lets all
  content through (`allowAllContent`). Abuse is handled with rate limits, an operator kill switch, a takedown and
  opt-out procedure, and a word-list filter for leaderboard names.
- No vision model removes cookie banners or reconstructs blocked sites from uploaded screenshots.
- No live AI commentary or announcer.

## How AI was used to make it

- The code, tests and build logs were written by Claude Code agents running Claude Opus 5.5 (1M context). A main
  Claude Code session acted as the orchestrator: it wrote the phase plans and the shared contracts, started
  sub-agents in parallel waves, each in its own git worktree, checked their hand-off reports against gates, and
  merged their work.
- The owner (the human who commissioned the rebuild) directed it: the briefs, approving the plan and each wave,
  choosing the names, domain, public repo and licence, approving the curated stage list, creating the Cloudflare
  account and keys, reporting a bug, and physically tilting the iPhone for the controller test, which agents
  cannot do.
- The build logs record every agent's instructions, failed attempts and test evidence; they record no manual human
  changes to the code.
- The project makes no claim that AI made the work faster or cheaper than the 2013 team's work, and no comparison
  with the original team's effort.

## Where AI runs in the live site

The only model call the live site makes is this docent. It sends the visitor's question and a few retrieved
excerpts from the project's own research notes and build logs to Claude (`claude-haiku-4-5` by default) through
Cloudflare AI Gateway, and every answer must cite those excerpts. Everything else (capture, the stage builder,
physics, the solver bot, scoring, moderation) is ordinary code with no model in it.

## Numbers from the build story

Measured in `content/build-story/timeline.json` at snapshot `f265f74` (later work, such as the share cards and CI
fixes, came after it):

- 29 agent runs: 16 phase runs, 7 follow-up runs and 6 helper runs, all Claude Opus 5.5 (1M context).
- 855.8 minutes of agent time and 98.8 minutes of orchestrator time, with at most 6 agents running at once.
- The owner sent 13 messages (566 words).
- 96 commits; 922 tests passing (14 skipped); 58,330 source lines and 14,847 test lines.
- 19 build logs recording 121 failed attempts and 0 manual human interventions.
