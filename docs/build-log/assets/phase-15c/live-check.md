# Phase 15c live check: docent answers before and after (verbatim)

Outside the docent corpus (`docs/build-log/assets/` is excluded), so the questions can be quoted here.

## Before: production (https://wwm.ewj.dev, `claude-haiku-4-5`), 2026-09-25

Fetched with `curl -X POST https://wwm.ewj.dev/api/docent` at about 22:05Z. The answers were served from the KV
answer cache, as first asked on production. Citation markers are the display numbers the visitor sees.

### g-live-2013-builder: "How did the 2013 stage builder turn a page into islands?"
> The sources don't cover that. The build logs describe how the 2026 rebuild's stage builder works—for instance, the
> rules for rejecting islands that are too narrow or decks that are too small [1]—but they don't explain the 2013
> original's process for converting pages into islands.

[1] Build log: Phase 03 (Stage Builder) › Comparison with the 2013 AID-DCC stage (slice 0, normal, seed 1; lengths
in ball diameters D) (continued), `docs/build-log/phase-03.md`

### g-live-ai-agents: "What did AI agents do in this rebuild?"
> The rebuild used AI agents for specific, bounded tasks that complemented human work. [1][2] Claude Code agents
> executed planned phases: one built the AI docent system itself (the grounded, cited Q&A tool you're using now), and
> another prepared evaluation infrastructure for it. [3] The agents also contributed semantic understanding—vision
> models analyze screenshots to extract page regions (navigation, ads, comments, footers) and map them to gameplay
> elements, infer text and images from blocked sites, choose music and difficulty, and generate flavor text for
> stages. [4] A third agent built the build-story timeline and gallery, computing traceable numbers from git logs and
> session records without making speed or cost claims about the original 2013 team. [5] Importantly, the sources
> note that the human algorithm from 2013 remains the skeleton; AI adds meaning, polish and robustness around it.

[1] `docs/build-log/phase-15.md` · [2] `docs/build-log/phase-15b.md` · [3] `RESEARCH.md` › Part 5 — Where AI fits
(showcase angle) · [4] `docs/build-log/phase-16.md#what-was-built` · [5] `docs/build-log/phase-16.md`

### g-live-who-made: "Who made the original World Wide Maze?"
> The original World Wide Maze (2013) was made by [Google Japan as the client and commissioning organization,
> working with the Tokyo agency PARTY][1]. Several Tokyo production companies contributed: [AID-DCC, Katamari, and
> FUTUREK, which handled backend development][1]. [Saqoosha wrote the detailed first-person engineering case study
> and related posts about the installations][1]. This is not a complete list of the individual designers, engineers,
> producers, and sound contributors [1].

[1] About page history data › Who made it, `apps/web/src/pages/about/history.ts#credits`

## After: PR Preview (https://pr-5-wwm.ewjdev.workers.dev, `claude-haiku-4-5`), 2026-09-25

Run at about 22:30Z with
`pnpm docent:eval --url https://pr-5-wwm.ewjdev.workers.dev --only grounding --out …`, against commit `3ce6145`.
The Preview has its own AI Gateway token. It took 10 model calls: one earlier `curl` of `g-live-who-made`, whose
answer the eval then got from the cache, plus 9 calls from the eval. Result: 10/10 answered, and every answer
cites an expected source of the expected kind. No answer presents a plan as fact.

### g-live-2013-builder: "How did the 2013 stage builder turn a page into islands?"
> The 2013 stage builder used image processing to turn a page into islands. [1] PhantomJS took a screenshot and exported bounding boxes for every `div` and `img` tag. The builder then removed the most common color (usually the page background), and applied dilation, blurring, and thresholding to merge fine text into solid blocks and fill image rectangles, producing clean blob-shaped islands. [1] This image-processing approach worked on any site regardless of markup, unlike an earlier attempt based on the DOM.

[1] World Wide Maze — Research Dossier & Rebuild Plan › Part 1 — What the original was › 1.3 How it was built (from Saqoosha's case study) › Stage builder algorithm (the heart of it), `RESEARCH.md#13-how-it-was-built-from-saqooshas-case-study`

### g-live-ai-agents: "What did AI agents do in this rebuild?"
> AI agents wrote the code, tests, and build logs for the 2026 rebuild [1]. A main Claude Opus 5.5 agent acted as orchestrator: it wrote the phase plans and shared contracts, started sub-agents in parallel waves in isolated git worktrees, checked their reports against gates, and merged their work [1]. The 29 agent runs (16 phase runs, 7 follow-up runs, and 6 helper runs) produced 96 commits, 922 passing tests, and 58,330 source lines, while the human owner directed the project by approving plans and waves, choosing names and domains, and handling tasks agents cannot do [1][2]. In the live site today, the only place an AI model runs is this docent, which answers visitors' questions by retrieving excerpts from the project's research and build notes and citing them [2].

[1] What exists today: the World Wide Maze tribute as built › Planned but not built · How AI was used to make it, `docs/facts/whats-built.md#planned-but-not-built`
[2] What exists today: the World Wide Maze tribute as built › Where AI runs in the live site · Numbers from the build story, `docs/facts/whats-built.md#where-ai-runs-in-the-live-site`

### g-live-who-made: "Who made the original World Wide Maze?"
> The original World Wide Maze (2013) was made by [Google Japan as the client and commissioning organization, with Tokyo agency PARTY][1]. Production companies AID-DCC and Katamari, also based in Tokyo, and backend developer FUTUREK contributed to the project [1]. Saqoosha wrote the detailed engineering case study and is credited as a key technical contributor [1]. This is not a complete list of individual designers, engineers, producers, and sound contributors [1].

[1] About page history data › Who made it, `apps/web/src/pages/about/history.ts#credits`

### g-ai-theming: "Does the game use AI to theme stages?"
> No, the game does not use AI to theme stages. [1] The planned AI Remix mode, which would have used a model to read pages and map regions to gameplay, was optional and was never started. [1] There is no AI semantic stage theming, and no AI model names stages, writes flavour text or level titles, or sets difficulty. [1]

[1] What exists today: the World Wide Maze tribute as built › Planned but not built · How AI was used to make it, `docs/facts/whats-built.md#planned-but-not-built`

### g-ai-remix: "Is there an AI Remix mode?"
> No, there is not. AI Remix mode was planned as an optional phase but was never started. [1] The live tribute has no AI semantic stage theming, no AI model names stages or writes their flavour text, and no AI hazard islands. [1]

[1] What exists today: the World Wide Maze tribute as built › Planned but not built · How AI was used to make it, `docs/facts/whats-built.md#planned-but-not-built`

### g-ai-moderation: "Does AI moderate captured pages?"
> No. [1] The build pipeline has a moderation hook, but it currently lets all content through. Abuse is instead handled with rate limits, an operator kill switch, a takedown and opt-out procedure, and a word-list filter for leaderboard names. [1]

[1] What exists today: the World Wide Maze tribute as built › Planned but not built · How AI was used to make it, `docs/facts/whats-built.md#planned-but-not-built`

### g-ai-names-music: "Does an AI model write the stage names or choose the music?"
> No. The sources say that no AI model names stages or picks music. [1] Music is a fixed set of synthesized loops, and stage difficulty comes from a solver bot's measured par time rather than an AI setting it. [1]

[1] What exists today: the World Wide Maze tribute as built › Planned but not built · How AI was used to make it, `docs/facts/whats-built.md#planned-but-not-built`

### g-runtime-model: "Which AI model runs in the live site, and for what?"
> The only AI model that runs in the live site is Claude Haiku 4.5 (by default), and it powers the docent—the question panel that answers visitors' questions about the original 2013 project and this rebuild [1]. The docent receives a visitor's question along with relevant excerpts from the project's research notes and build logs, then generates a cited answer through Cloudflare AI Gateway [1]. Everything else on the site—the stage capture, stage builder, physics, solver bot, scoring, and moderation—uses ordinary code with no model in it [1].

[1] What exists today: the World Wide Maze tribute as built › Where AI runs in the live site · Numbers from the build story, `docs/facts/whats-built.md#where-ai-runs-in-the-live-site`

### g-2013-text-blobs: "In 2013, how did the original builder merge lines of text into solid shapes?"
> In 2013, the original builder merged lines of text into solid shapes through image processing. [1] After capturing a screenshot and removing the background, it applied `cv::dilate`, then `GaussianBlur`, then `threshold`, so that fine text merged into solid blocks. [1] This processing step was part of the "clump text" phase, which produced clean blobs called islands that could then be connected into a maze. [1]

[1] World Wide Maze — Research Dossier & Rebuild Plan › Part 1 — What the original was › 1.3 How it was built (from Saqoosha's case study) › Stage builder algorithm (the heart of it), `RESEARCH.md#13-how-it-was-built-from-saqooshas-case-study`

### g-2013-start-goal: "Where did Saqoosha's stage builder place the start and the goal?"
> [1] The stage builder found the points on each island farthest from its edges using a distance transform. The top-left point became the start, and the bottom-right became the goal. [1] Up to 6 other distant points held large items.

[1] World Wide Maze — Research Dossier & Rebuild Plan › Part 1 — What the original was › 1.3 How it was built (from Saqoosha's case study) › Stage builder algorithm (the heart of it), `RESEARCH.md#13-how-it-was-built-from-saqooshas-case-study`

## Review notes (agent)
- `g-live-ai-agents`: the source says a main Claude Code *session* was the orchestrator. The answer calls it "a main
  Claude Opus 5.5 agent", which is close but loses that distinction. Nothing from the plans appears in the answer.
- `g-ai-names-music`: "stage difficulty comes from … par time" compresses "difficulty stars come from the solver's
  par time".
- `g-live-2013-builder`: the answer is correct but stops before the bridge, maze-carving and item steps (the answer
  length rule allows two to five sentences).
