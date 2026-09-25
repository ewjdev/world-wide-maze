# infra/ — environments, deploy and measurement scripts (Phase 12)

**Nothing here has been run against Cloudflare.** No account, resource, domain or secret exists yet. The steps
below are for the user (account owner) to run once; after that, deploys go through
`.github/workflows/deploy.yml` only.

## Layout
| Path | What |
|---|---|
| `apps/worker/wrangler.jsonc` | Top level = local dev/test. `env.staging` (`wwm-staging`, workers.dev) and `env.production` (`wwm`, custom domain) serve the API **and** the web app (`../web/dist`) as Workers static assets, `run_worker_first` for `/api/*` and `/s/*`. Every binding/var is redeclared per env (non-inheritable keys) |
| `apps/web/public/_headers` | CSP and security headers for static assets |
| `infra/scripts/check-deploy-config.mjs` | Refuses a deploy with placeholder ids, `ROOM_STATS` on, `DEV_ALLOWED_HOSTS` set, or (production) no custom domain |
| `infra/scripts/smoke.mjs <url>` | Post-deploy smoke test (app, headers, API, stats gate, cross-site refusal, curated fallback) |
| `infra/scripts/bundle-report.mjs` | Web bundle sizes by chunk and contributor |
| `infra/scripts/cost-model.mjs` | The cost estimate in docs/launch/cost-model.md (edit the assumptions, re-run) |
| `infra/perf/frames.mjs` | Frame-time + CSP measurement of the production build (docs/launch/performance.md) |
| `tests/load/rooms.mjs`, `tests/load/builds.mjs` | Load tests (docs/launch/performance.md §5) |

## Provisioning (once per environment; user action)
Needs **Workers Paid** (for `limits.cpu_ms`, Browser Run concurrency, the 3.7 MB-gzip Worker bundle).
```sh
cd apps/worker
pnpm exec wrangler login                                   # the account owner, interactively
# staging (repeat with the production names: wwm-stages, wwm, and a new KV namespace)
pnpm exec wrangler r2 bucket create wwm-stages-staging
pnpm exec wrangler d1 create wwm-staging                   # → database_id into env.staging.d1_databases
pnpm exec wrangler kv namespace create CACHE --env staging # → id into env.staging.kv_namespaces
pnpm exec wrangler secret put IP_HASH_SALT --env staging   # 32+ random chars, e.g. `openssl rand -hex 24`
pnpm exec wrangler d1 migrations apply wwm-staging --remote --env staging
```
Then:
1. Replace the placeholder ids in `env.staging` / `env.production` of `wrangler.jsonc`. The rate-limit
   `namespace_id`s (7101–7203) only need to be unique per account.
2. Production domain: uncomment `routes` in `env.production` with your domain (`custom_domain: true` creates the
   DNS record and certificate). HTTPS is required: iOS only grants motion-sensor access on secure origins.
3. `node infra/scripts/check-deploy-config.mjs staging` must print `ok`, and
   `pnpm exec wrangler secret list --env staging` must list `IP_HASH_SALT` (deployed envs answer score
   submissions with 503 while it's missing, rather than hashing IPs with the public dev default).
4. First deploy by hand, from a clean `main`: `pnpm --filter @wwm/web build && cd apps/worker && pnpm exec wrangler deploy --env staging`,
   then `node infra/scripts/smoke.mjs https://wwm-staging.<subdomain>.workers.dev`.
5. Seed the curated runs (Phase 10 `content/scripts/curate.mjs`, after the user approves the list).

## AI docent: Cloudflare AI Gateway + Anthropic key (Phase 15; user action, optional)
The docent (`POST /api/docent`, the "Ask the docent" panel on `/about` and `/log`) calls Claude through
**Cloudflare AI Gateway**'s Anthropic endpoint, `https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_ID>/anthropic`
(checked against the AI Gateway docs, 2026-09-25). Until this is set up, `pnpm dev` uses the offline mock and
staging/production answer `DOCENT_UNAVAILABLE` ("The docent is resting right now"); nothing else is affected.

1. **Anthropic API key.** In the Claude Console, create a key for this project (ideally in its own workspace with a
   monthly spend limit).
2. **Gateway.** Cloudflare dashboard → **AI → AI Gateway → Create Gateway**, name e.g. `wwm-docent`. In its
   **Settings**:
   - **Authenticated Gateway** (recommended): *Create authentication token* (it needs the `Run` permission; copy it,
     it isn't shown again), then switch Authenticated Gateway on. AI Gateway tokens are account-scoped.
   - Optional: logs on (the docent sends only the sanitised question and excerpts; no IPs), a gateway **rate limit**
     and a **spend limit** as a second budget behind the Worker's own caps. Gateway caching can stay off: the
     Worker already caches answers in KV.
3. **Worker config** (`apps/worker/wrangler.jsonc`, in `env.staging.vars` and `env.production.vars`):
   `"AI_GATEWAY_ACCOUNT_ID": "<your account id>"`, `"AI_GATEWAY_ID": "wwm-docent"`. Keep `"DOCENT_PROVIDER": "auto"`.
4. **Secrets** (per environment; never in the repo):
   ```sh
   cd apps/worker
   pnpm exec wrangler secret put ANTHROPIC_API_KEY --env staging   # sent as x-api-key, through the gateway
   pnpm exec wrangler secret put AI_GATEWAY_TOKEN --env staging    # sent as cf-aig-authorization
   ```
   Alternative: store the Anthropic key **in the gateway** (Provider keys / BYOK) and set only `AI_GATEWAY_TOKEN`;
   the Worker then omits `x-api-key`, as the gateway requires.
5. **Budget knobs** (vars): `DOCENT_DAILY_LIMIT` (model calls per rolling 24 h, all visitors; default 500; `"0"` turns
   the docent off), `DOCENT_LIMIT_PER_HOUR` (per IP, 20), `DOCENT_MAX_TOKENS` (600, capped at 1024),
   `DOCENT_MODEL` (`claude-haiku-4-5`, the fast, inexpensive default; any current Claude model id works),
   `DOCENT_CACHE_TTL_DAYS` (7). Runtime kill switch without a deploy: KV key `kill:docent` in `CACHE`.
6. **Check it.** Deploy, then ask a suggested question on `/about`: the answer must not start with "Offline mode",
   and Workers Logs shows `docent answer` lines with `provider: "gateway"` and token counts. The gateway's own logs
   show the same requests.
7. **Eval with the real model** (costs ~26 short calls): from the repo root,
   `AI_GATEWAY_ACCOUNT_ID=… AI_GATEWAY_ID=wwm-docent ANTHROPIC_API_KEY=… AI_GATEWAY_TOKEN=… pnpm docent:eval --real`.

Local development against the real gateway: put the two ids and the secret(s) in `apps/worker/.dev.vars`
(gitignored; see `.dev.vars.example`), then `pnpm dev`.

## Enabling the deploy workflow (user action)
1. GitHub → Settings → Environments: create `staging` and `production`. On `production` add **Required
   reviewers** (you) — this is the manual approval gate for every production deploy.
2. In each environment add secrets `CLOUDFLARE_API_TOKEN` (scoped: Workers Scripts Edit, Workers KV Edit, D1 Edit,
   R2 Edit, Account Settings Read) and `CLOUDFLARE_ACCOUNT_ID`.
3. Repository variables: `WWM_STAGING_URL`, `WWM_PRODUCTION_URL`, optionally `WWM_TELEMETRY_URL` (`/api/t`, only
   after approving telemetry), and finally `WWM_DEPLOY_ENABLED=true`.
4. Staging deploys on every push to `main`; production on a pushed `v*` tag (after approval).

## Environments at a glance
| | local (`pnpm dev`) | staging | production |
|---|---|---|---|
| Worker | `wwm` (wrangler dev) | `wwm-staging` | `wwm` |
| Web app | Vite :5173 (proxy) | static assets | static assets |
| Domain | localhost | `*.workers.dev` (optional custom) | your domain (required) |
| `ROOM_STATS` | 1 | 0 | 0 |
| `TELEMETRY_INGEST` | 0 | 0 | 0 until approved |
| `GLOBAL_BUILD_LIMIT_PER_HOUR` | 600 | 120 | 600 |
| COOP/COEP | — | COOP `same-origin`; no COEP (physics doesn't use SharedArrayBuffer) | same |
