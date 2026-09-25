# content/ (Phase 10)

The curated collection and the scripts that turn an approved list into prebuilt, preserved runs.

| File | What |
|---|---|
| `curated-proposal.md` | Candidate sites with licence notes and risk flags. **Awaiting the owner's approval.** |
| `curated.json` | The approved list (`approved: []` until then). |
| `scripts/curate.mjs` | Builds each approved run through a Worker, waits for every slice, writes `out/curated-runs.json` and `out/curated.sql` (D1 rows for the `curated` table, migration `0003_curated.sql`). |
| `scripts/render-cards.mjs` | Renders 1200×630 share cards with the real engine (`/making/<id>?card=1`) and prints the R2 upload commands (`share/<stageId>.png`). |
| `scripts/export-pack.mjs` | Exports an offline pack of a run: `stage-<i>.json` + texture per slice + `manifest.json`. |
| `scripts/showcase-shots.mjs` | Screenshots of /about, /making, /log and the ranking components for the build log. |

`content/out/` holds generated packs, cards and SQL. It contains third-party screenshots, so it is git-ignored.

## After approval (a person runs these; agents don't create cloud resources)
1. Put the approved entries in `curated.json`.
2. `pnpm dev` (or point at the deployed Worker), then `node content/scripts/curate.mjs http://localhost:8787`.
3. Phase 09: solve every stage, then fill `stars` in `curated.json` and re-run step 2 (it is idempotent: cached runs
   come back immediately and the SQL upserts).
4. `node content/scripts/render-cards.mjs http://localhost:5173 content/out/curated-runs.json`, then run the printed
   `wrangler r2 object put …` commands.
5. From `apps/worker`: `wrangler d1 migrations apply wwm --remote`, then
   `wrangler d1 execute wwm --remote --file ../../content/out/curated.sql`.
6. Optional: `node content/scripts/export-pack.mjs <api> <runId>` for each run and archive the packs.

Curated runs are exempt from the Worker's retention sweep (Phase 07 reads the `curated` table).
