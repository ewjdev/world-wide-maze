# Phase 31: Lesson depth and parent progress tracking

**Date:** October 19, 2026 (America/Los_Angeles).
**Agent:** Claude Code (Claude Opus 5.5) as orchestrator. No sub-agents.
**Plan:** [plans/phase-31-lesson-depth-and-tracking.md](../../plans/phase-31-lesson-depth-and-tracking.md).

## Key instructions
- The owner asked how fx0 (Vercel's libfx design agent, which writes one HTML file per chat) could benefit the lessons.
- Goals the owner gave: deeper lessons, progress tracking for parents (ready for other families), a child UI that stays intuitive, and Cloudflare only. Port Vercel-based ideas rather than adopt them.
- Apple TV (Phase 30) is out of scope.

## What changed (N: new, not a 2013 feature)
- **M0 item-bank spike (N):**
  - `tools/lesson-draft`: a local-only `wrangler dev` helper Worker that calls Anthropic through AI Gateway `wwm`, and `src/spike.ts`.
  - The spike asks `claude-sonnet-5-5` for six fresh rounds per objective. It validates them with `roundSchema` plus objective checks the schema can't make, and allows up to two repair turns.
- **Results:** [docs/education/item-bank-spike/2026-10-19/](../education/item-bank-spike/2026-10-19/README.md).
  - Rounds were valid 53/54 on first pass and 54/54 after one repair.
  - Three independent runs converged on the same items: 9 distinct words in 18 spelling items, and 7 distinct sets in 18 colour items.
  - Conclusion: generators for parametric objectives, and a model only for open vocabulary under review.
- **Plan:** objectives and banks, evidence events, a plain-language progress model, parent accounts on D1 with one Durable Object per family, a privacy gate, and the fx0 pattern ported to the Agents SDK and Workflows. CCR-31-1 to CCR-31-4 are proposed, not applied.

## Attempts that failed
None. The first gateway call through `env.AI.gateway('wwm').run({ provider: 'anthropic', … })` worked under `wrangler dev` with the existing login.

## Manual interventions
None.

## Test evidence
- `pnpm --filter @wwm/lesson-draft typecheck` passes.
- Spike output: `docs/education/item-bank-spike/2026-10-19/results.json`, using 18,511 input and 25,623 output tokens.
- `pnpm check` was run before commit (see the hand-off).

## Remaining defects and follow-ups
- The spelling check's dictionary (`/usr/share/dict/words`) accepts obscure words. M1 should replace it with a reviewed age-appropriate list.
- The spike is three runs of one model with default sampling. It doesn't predict other objectives.
- Owner decisions are listed at the end of the plan. The privacy review gates any family other than the owner's.
