# infra/: Cloudflare environments, provisioning, CI (Phases 12 + 17)

**Nothing here has been run against Cloudflare yet.** No account resource, domain, secret or GitHub setting exists.
Part A is done once by the account owner. After that, everything goes through GitHub (Part B).

## Environments
| | local (`pnpm dev`) | PR Preview | production |
|---|---|---|---|
| What | `wrangler dev` + Vite | a [Worker Preview](https://developers.cloudflare.com/workers/previews/) of `wwm`, one per PR, named `pr-<N>` | Worker `wwm` |
| Config | `wrangler.jsonc` top level | `env.production.previews` | `env.production` |
| URL | http://localhost:5173 | `https://pr-<N>-wwm.<account-subdomain>.workers.dev` | `https://<domain>` |
| D1 / R2 / KV | Miniflare (local) | `wwm-preview` / `wwm-stages-preview` / `wwm-cache-preview` (shared by all PRs) | `wwm` / `wwm-stages` / `wwm-cache` |
| Durable Objects | local | own namespace + storage per Preview (automatic) | production |
| AI Gateway | none (docent mock) | `wwm-preview` | `wwm` |
| Rate-limit namespace ids | 7001–7003 | 7301–7303 | 7201–7203 |
| `WWM_ENV` / `ROOM_STATS` / `TELEMETRY_INGEST` | development / 1 / 0 | preview / 0 / 0 | production / 0 / 0 until approved |
| Build caps | 600/h global, 2 browsers | 60/h global, 1 browser, cache 1 day | 600/h global, 2 browsers |
| Cron (retention sweep) | `--test-scheduled` | never (crons only run on production) | daily 03:17 UTC |
| Deployed by | nobody | `.github/workflows/preview.yml` | `.github/workflows/deploy.yml` (push to `main`) |

All names live in **`infra/cloudflare.config.json`**. To rename something, edit it there, run
`node infra/scripts/provision.mjs` (dry-run, then `--apply`), and commit the resulting `wrangler*.jsonc` changes.
The old `env.staging` Worker (`wwm-staging`) is gone. Previews replace it; see "Optional: a persistent staging".

## Files
| Path | What |
|---|---|
| `infra/cloudflare.config.json` | Resource names, domain, rate-limit ids, required secrets |
| `apps/worker/wrangler.jsonc` | Top level = local dev/test (placeholder ids on purpose). `env.production` = Worker `wwm` (API + `../web/dist` static assets). `env.production.previews` = Preview vars/bindings. Nothing is inherited, so everything is repeated. |
| `apps/worker/wrangler.preview-migrations.jsonc` | The preview D1 database, for `d1 migrations apply` (the Cloudflare docs pattern) |
| `infra/scripts/provision.mjs` | Idempotent provisioning. Dry-run by default, `--apply` to create, `--offline` for no Cloudflare calls |
| `infra/scripts/check-deploy-config.mjs production\|previews\|all` | Deploy guard: placeholder ids, dev switches, missing vars/bindings, names ≠ config, Previews bound to production data |
| `infra/scripts/smoke.mjs <url>` | Post-deploy smoke test (app, headers, API, stats gate, cross-site refusal, curated list) |
| `infra/scripts/lib/cloudflare-infra.mjs` | Pure helpers for the two scripts above (tests: `apps/worker/test/infra-provision.test.ts`) |
| `infra/scripts/{bundle-report,cost-model,kill-switch-check}.mjs`, `infra/perf/` | Phase 12 measurement tools (docs/launch/) |

## Part A: one-time setup (account owner)

Run everything from the repo root after `pnpm i`. The wrangler commands use the project's wrangler (≥ 4.135, which
Previews need), so run them as `pnpm --filter @wwm/worker exec wrangler …`, or `cd apps/worker && pnpm exec wrangler …`.

1. **Plan and account.** You need **Workers Paid** ($5/month): the Worker uses `limits.cpu_ms` 300 000, Browser
   Run, and a ~3.8 MB gzip bundle. Paid also allows 500 Previews per Worker instead of 100. Open *Workers & Pages*
   once in the dashboard so the account has a `workers.dev` subdomain, because Preview URLs live there.
2. **Log in:** `pnpm --filter @wwm/worker exec wrangler login`
3. **Provision (dry-run first):**
   ```sh
   node infra/scripts/provision.mjs            # read-only: lists what exists, prints the plan and the id changes
   node infra/scripts/provision.mjs --apply    # creates the missing D1/R2/KV (production + preview), writes ids,
                                               # applies D1 migrations to both databases (asks to confirm)
   ```
   If several accounts are visible, `export CLOUDFLARE_ACCOUNT_ID=<id>` first. AI Gateways are created through the
   API only when `CLOUDFLARE_API_TOKEN` is exported with *AI Gateway: Edit*. Otherwise the script prints the
   dashboard steps. Do them (*AI → AI Gateway → Create Gateway*: `wwm` and `wwm-preview`, logs on, rate limit
   60/60 s sliding, authentication off), then re-run `--apply` so the account id lands in the config.
4. **Domain:** in `infra/cloudflare.config.json`, replace `"{{DOMAIN}}"` with your hostname (for example
   `maze.example.com`). The zone must be on this account. Then run `node infra/scripts/provision.mjs --apply` again. It
   writes `env.production.routes` = `[{ "pattern": "<domain>", "custom_domain": true }]`. HTTPS matters because
   iOS only grants motion sensors on secure origins.
5. **Check and commit:** `node infra/scripts/check-deploy-config.mjs all` must print `production: ok` and
   `previews: ok`. Commit `infra/cloudflare.config.json`, `apps/worker/wrangler*.jsonc` and
   `apps/worker/worker-configuration.d.ts`. Resource ids are not secrets.
6. **First production deploy, by hand.** This creates the Worker and the custom domain. The CI token below can't
   create Workers or custom domains, only update them.
   ```sh
   pnpm --filter @wwm/web build
   cd apps/worker && pnpm exec wrangler deploy --env production && cd ../..
   node infra/scripts/smoke.mjs https://<domain>
   ```
7. **Worker secrets.** Use different values for production and Previews. wrangler prompts for each value; never
   paste one into a command line.
   ```sh
   cd apps/worker
   pnpm exec wrangler secret put IP_HASH_SALT --env production                        # openssl rand -hex 24
   pnpm exec wrangler secret put ANTHROPIC_API_KEY --env production
   pnpm exec wrangler preview base-config secret put IP_HASH_SALT --env production    # every NEW Preview
   pnpm exec wrangler preview base-config secret put ANTHROPIC_API_KEY --env production
   ```
   Re-run `node infra/scripts/provision.mjs` to confirm nothing is missing. It lists secret names, never values.
   Base-config secrets only reach Previews created afterwards. For an existing one:
   `pnpm exec wrangler preview secret put <NAME> --env production --name pr-<N>`. Without `IP_HASH_SALT`, deployed
   Workers (`WWM_ENV` ≠ development) answer score submissions with 503 instead of hashing IPs with the public dev
   salt.
8. **Cloudflare API token for CI** (*My Profile → API Tokens → Create Token → Custom token*, or an account-owned
   token), scoped to this account:
   | Permission | Why |
   |---|---|
   | Account › **Workers** › **Editor** (Workers product scope, or just the Worker `wwm` once it exists). Legacy name: *Workers Scripts: Edit* | `wrangler deploy`, `wrangler preview`, `preview delete` |
   | Account › **D1** › **Edit** | `d1 migrations apply` for both databases |
   | Account › **Account Settings** › **Read** (optional) | only if wrangler complains it can't read the account |
   | Zone › **Workers Routes** › **Edit** for your domain's zone (optional) | only if CI must change the custom domain later |

   Deploying bindings to KV/R2/D1 needs no permission on those resources, per Cloudflare's Workers authorization
   docs. No KV/R2/AI Gateway permission is needed in CI.
9. **GitHub** (*Settings → Secrets and variables → Actions*), or with `gh`:
   ```sh
   gh secret set CLOUDFLARE_API_TOKEN          # paste the token when prompted
   gh secret set CLOUDFLARE_ACCOUNT_ID         # the account id (provision.mjs prints it)
   gh variable set WWM_PREVIEWS_ENABLED --body true
   gh variable set WWM_DEPLOY_ENABLED --body true
   # optional, only after approving telemetry: gh variable set WWM_TELEMETRY_URL --body https://<domain>/api/t
   ```
   Also *Settings → Environments → New environment* `production`. Set *Deployment branches* to `main` only.
   *Required reviewers* (you) is **optional**: with it, every merge waits for a click before going live. Without
   it, merging to `main` deploys straight away. For the tightest setup, store the two Cloudflare secrets as
   `production` environment secrets **and** as repository secrets. Previews need the repository ones.
10. **Optional: keep Previews private.** Preview URLs are public by default (workers.dev Previews get
    `X-Robots-Tag: noindex` automatically). To require a login, use *Workers & Pages → wwm → **Access** tab →
    Protect this Worker behind Access → **Previews only***. Phones then need to log in once too. The CI smoke test
    can't pass Access, so either give it an Access service token or drop the smoke step from `preview.yml`.
11. **Curated runs:** seed them into production with Phase 10's `content/scripts/curate.mjs`.

## Part B: day to day
- **Open or update a PR.** `preview.yml` runs `pnpm check`, builds the web app, migrates `wwm-preview`, runs
  `wrangler preview --env production --name pr-<N>`, smoke-tests it, and posts or updates **one** PR comment with the
  Preview URL. The URL is HTTPS, so you can open it on a computer and scan the pairing QR code with a phone (tilt
  works on iOS). Each push updates the same Preview. Rooms and build jobs (Durable Objects) are per Preview. D1/R2/KV
  data is shared by all Previews, never with production.
- **Merge.** `deploy.yml` runs `pnpm check`, migrates `wwm`, runs `wrangler deploy --env production`, and
  smoke-tests `https://<domain>`. It waits for approval first if you added required reviewers. Closing the PR
  deletes its Preview (`wrangler preview delete`).
- **Roll back:** docs/launch/runbook.md §4 (`wrangler rollback --env production`).
- **Local:** unchanged. `pnpm dev`, `pnpm dev:phone`, and all tests use the top level of `wrangler.jsonc`. For a
  production-like local run (static assets + headers): `pnpm --filter @wwm/web build && cd apps/worker && pnpm exec
  wrangler dev --env production`. This is still local: Miniflare storage, local Chrome.
- **D1 migrations** go to the shared preview database from the first PR that has them. Keep them
  backward compatible (additive). Production and other open PRs run older code against the same schema.

## AI Gateway (Phase 15 docent)
- Gateways: `wwm` (production) and `wwm-preview` (Previews). Separate gateways keep Preview traffic out of the
  production logs, analytics and rate limit, at no extra cost.
- Vars (set by provision): `AI_GATEWAY_ACCOUNT_ID` (your account id) and `AI_GATEWAY_ID`, in both `env.production.vars`
  and `env.production.previews.vars`. They're empty at the top level, so local dev and tests use the mock provider.
  `DOCENT_DAILY_LIMIT`: 500 production, 50 Previews.
- Secret `ANTHROPIC_API_KEY`: `wrangler secret put` (production) and `wrangler preview base-config secret put`
  (Previews). Use a separate key per target so a leaked Preview key can be revoked alone.
- The gateways are created with *Authenticated Gateway* off. To turn it on, create a token with *AI Gateway: Run*,
  add it as another secret, and have the docent send `cf-aig-authorization: Bearer <token>`. That's Phase 15's code.

## Alternative: Workers Builds (Cloudflare's git integration)
Cloudflare can build and deploy from the GitHub repo itself and comment Preview URLs on PRs. Setup: *Workers &
Pages → wwm → Settings → Build → Connect* the repo. Then set:
- Production branch `main`. Root directory `apps/worker`.
- Build command: `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @wwm/web build`
- Deploy command: `pnpm exec wrangler d1 migrations apply wwm --remote --env production && pnpm exec wrangler deploy --env production`
- *Branch control → Enable Preview Builds*. Preview command: `pnpm exec wrangler d1 migrations apply PREVIEW_DB --remote --config wrangler.preview-migrations.jsonc && pnpm exec wrangler preview --env production`
  (the default is `npx wrangler preview`, and a Wrangler environment needs `--env`, per Cloudflare's docs).
- Build variables: none needed (the Builds token is managed by Cloudflare).

**Recommendation: GitHub Actions** (the workflows here), for four reasons:
1. `pnpm check` gates every Preview and every deploy. That includes the Playwright capture tests, which need
   `playwright install --with-deps`, and Workers Builds doesn't run them.
2. It runs the smoke test after each deploy.
3. Previews are named `pr-<N>` and deleted when the PR closes. Builds names them after the branch.
4. It keeps the approval gate in the GitHub Environment `production`.

Don't enable both: they would deploy twice. The Builds commands above are untested.

## Optional: a persistent staging
Previews cover per-PR review. If you ever want a long-lived pre-production copy (load tests, the rollback
rehearsal), add `env.staging` back to `wrangler.jsonc` with its own name (`wwm-staging`), its own resources, and
every var/binding repeated. Deploy it with `wrangler deploy --env staging`. `check-deploy-config.mjs` doesn't
cover it.

## Limits and caveats
- 500 Previews per Worker (Paid) and 100 deployments per Preview. The oldest are deleted automatically.
- Crons never run on Previews, so the retention sweep doesn't clean `wwm-preview` / `wwm-stages-preview`. Empty
  them now and then (for example, delete the R2 bucket's objects; runs expire from KV after 1 day).
- Previews share the account's Browser Run concurrency with production, which is why their build caps are lower.
- `wrangler tail` can't target Previews. Use the Preview's *Logs* / *Metrics* tabs in the dashboard.
- Service bindings from a Preview reach production Workers. This Worker has none.

## AI docent: Cloudflare AI Gateway + Anthropic key (Phase 15)
The docent (`POST /api/docent`, the "Ask the docent" panel on `/about` and `/log`) calls Claude through **Cloudflare AI Gateway**'s Anthropic endpoint, `https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_ID>/anthropic`. Until this is set up, `pnpm dev` uses the offline mock and deployed environments answer `DOCENT_UNAVAILABLE`. Nothing else is affected.

1. **Gateways:**
   - Dashboard → **AI → AI Gateway → Create**: `wwm` (production) and `wwm-preview` (Previews).
   - **Turn "Collect logs" off** (the privacy draft promises this).
   - Add a rate limit and a spend limit.
   - Optional: create an authentication token (`Run` permission) and switch on Authenticated Gateway.
   - `AI_GATEWAY_ACCOUNT_ID` and `AI_GATEWAY_ID` are already set in `wrangler.jsonc` (`env.production.vars` and `env.production.previews.vars`).
2. **Secrets** (never in the repo):
   ```sh
   cd apps/worker
   pnpm exec wrangler secret put ANTHROPIC_API_KEY --env production                  # production
   pnpm exec wrangler preview base-config secret put ANTHROPIC_API_KEY --env production   # new Previews
   # if the gateway is authenticated, also AI_GATEWAY_TOKEN (sent as cf-aig-authorization), both places
   ```
   Alternatively, store the Anthropic key **in the gateway** (Provider keys / BYOK) and set only `AI_GATEWAY_TOKEN`.
3. **Budget settings** (vars):
   - `DOCENT_DAILY_LIMIT`: model calls per rolling 24 h. `"0"` turns the docent off.
   - `DOCENT_LIMIT_PER_HOUR`: per IP.
   - `DOCENT_MAX_TOKENS`.
   - `DOCENT_MODEL`: default `claude-haiku-4-5`.
   - `DOCENT_CACHE_TTL_DAYS`.
   - Runtime kill switch: the KV key `kill:docent` in `CACHE`.
4. **Check it:** ask a suggested question on `/about`. The answer must not start with "Offline mode". Then run the real-model eval, about 26 short calls:
   `AI_GATEWAY_ACCOUNT_ID=… AI_GATEWAY_ID=wwm ANTHROPIC_API_KEY=… pnpm docent:eval --real`.
