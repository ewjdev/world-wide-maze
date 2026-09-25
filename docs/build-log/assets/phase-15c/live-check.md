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

## After: PR Preview

(filled in after the Preview deploy)
