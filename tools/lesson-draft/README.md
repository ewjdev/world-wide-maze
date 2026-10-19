# @wwm/lesson-draft

Phase 31 lesson-authoring experiments. Model-written example rounds go through Cloudflare AI Gateway `wwm` and are checked against `@wwm/learning`.

## Item-bank spike (M0)

```sh
pnpm --filter @wwm/lesson-draft spike [--runs 3] [--model claude-sonnet-5-5]
```

For each objective (`little-word-builders`, `compare-groups`, `spanish-colors`), the model sees the authored rounds and writes six fresh ones. Every round must pass `roundSchema` and the objective checks in `src/spike.ts`. A failing round gets up to two repair turns. Output goes to `docs/education/item-bank-spike/<date>/results.json`. See that folder's README for the October 19 findings.

The script starts `proxy/` with `wrangler dev` on port 8798 unless something already listens there. The helper Worker is local-only and never deployed. Its AI binding uses your wrangler login, and the Anthropic key stays in the gateway (BYOK). Each full run makes 9–27 paid model calls.
