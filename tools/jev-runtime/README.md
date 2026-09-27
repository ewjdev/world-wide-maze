# Local Jev spectator

From the worktree root, add `TYPESAFE_API_KEY=...` to ignored `.env.jev`, then run:

```sh
pnpm dev:jev
```

Open http://127.0.0.1:5176/dev/jev. Restart the launcher after changing the key. Only this opt-in launcher enables the route and API. The ordinary game, preview, and production bundle have no Jev endpoint. Keep the server on loopback.

Choose Jev, baseline explorer, or the explicitly labeled scripted demo. Pause freezes simulation; Next decision finishes one local action and pauses at the next boundary. A visible goal invokes a forced local finish action. No solver rescue, automatic retries, or hidden full-map input is provided to Jev.

Run history retains every started run, frame, request, observed provider response, receipt, action, outcome, and acknowledged replay chunk under `local/jev/local-pilot`. Export individual JSON recordings or a CSV summary. Replay/import uses recorded inputs and makes no inference calls. Exact observations and probabilities remain available in the notebook; confidence is not measured accuracy.

Every provider dispatch reserves a durable budget entry first. Limits: 64 calls per run, 600 per pilot, 5-second provider deadline, 16 KiB payload, 256 KiB response, 300 active seconds/256 actions, 10 MiB replay, 32 MiB per run, 512 MiB archive. Errors consume reserved attempts; no automatic refund or retry. Unknown remote outcomes remain unknown. A crash can lose an unacknowledged movement suffix; saved decisions and the confirmed replay prefix remain available. Restarting the server interrupts prior nonterminal runs without clearing history or budgets.

A new browser document interrupts its prior owned run rather than claiming to resume lost physics. Merely reading history in another tab does not alter live state. Deliberately paused sessions persist while their owner document exists. Keep the archive until you explicitly decide to remove it.

The launcher uses one archive instance across Vite configuration reloads; fully restart it after runtime-code or credential changes. If a killed process leaves a stale lock or torn final record, stop/check its owning process first, then use:

```sh
pnpm jev:recover local-pilot --confirm
```

Recovery refuses a live owner and preserves damaged files. An interior corrupt record requires manual investigation. Do not delete the attempts ledger or choose a new pilot ID to bypass a budget or recovery error.

Focused verification:

```sh
pnpm exec vitest run packages/maze-agent/test tools/jev-runtime/test --maxWorkers=1
node apps/web/scripts/jev-smoke.mjs
```

Live evaluation (requires the running launcher and spends its durable request budget):

```sh
pnpm exec tsx tools/jev-runtime/src/evaluate.ts --smoke
pnpm exec tsx tools/jev-runtime/src/evaluate.ts
```

The measured run records its pricing estimate, fixture hashes, every trial and replay result under `plans/evidence/jev-evaluation/`. Full evidence remains in the local archive. Only curated fixture observations are sent to TypeSafe. Credentials and owner/session capabilities are excluded from the archive and exports.
