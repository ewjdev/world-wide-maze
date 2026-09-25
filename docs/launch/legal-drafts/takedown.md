# DRAFT — REQUIRES USER REVIEW — Takedown and opt-out

> **Status: draft by the Phase 12 agent, not reviewed by the operator. Not published and not linked from the
> site.** The operator procedure at the bottom is tested against the code; the public text needs the contact
> address and a decision on response times.

## For website owners
World Wide Maze turns public web pages into game levels: a screenshot of the page becomes the ground the ball
rolls on. If you don't want your site used:

- **Opt out your domain.** Email [CONTACT EMAIL] from an address at that domain (or tell us how to verify you own
  it, e.g. a DNS TXT record `wwm-optout=<token we send you>`). Once added, new mazes can't be built from any
  page on that domain or its subdomains, and existing mazes are removed. We aim to act within [N] days.
- **Remove a specific maze or leaderboard entry.** Send us its link (`/play/<id>` or `/s/<id>`).
- **Copyright / DMCA-style notices** go to the same address: identify the work, the maze link, your contact details
  and a statement that you're authorised to act. [Add jurisdiction-specific requirements if needed.]

Our capture browser identifies itself with a normal Chrome user agent [DECIDE: add a `WorldWideMaze` token so
robots rules can target it]. It fetches only the page itself and its resources, once per build; mazes are cached
for up to 7 days, so popular pages aren't fetched repeatedly.

## Operator procedure (tested locally with `wrangler dev`; production commands need `--env production --remote`)
1. **Block the domain** (applies to the domain and all subdomains; checked before the cache since Phase 12):
   `pnpm --filter @wwm/worker exec wrangler kv key put --binding CACHE "optout:<domain>" "<date> <ticket>" --env production --remote`
2. **Remove existing runs** for that domain: find them with
   `wrangler d1 execute wwm --env production --remote --command "SELECT run_id, url FROM runs WHERE url LIKE '%<domain>%'"`,
   then delete the R2 objects (`stages/<stageId>.json`, `textures/<captureId>/*`, `captures/<captureId>/*`) and the
   `runs`/`stages` rows (the retention sweep in `apps/worker/src/store.ts` shows the exact keys), and the KV cache
   keys `run:<normalizedUrl>:*`. [Follow-up: a one-command admin script; see docs/launch/checklist.md.]
3. **Remove a leaderboard entry:** `DELETE FROM scores WHERE id = ?` (and its `replay_key` object in R2).
4. Reply to the requester and log the ticket.
