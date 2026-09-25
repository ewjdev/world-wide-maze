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
3. `node infra/scripts/check-deploy-config.mjs staging` must print `ok`.
4. First deploy by hand, from a clean `main`: `pnpm --filter @wwm/web build && cd apps/worker && pnpm exec wrangler deploy --env staging`,
   then `node infra/scripts/smoke.mjs https://wwm-staging.<subdomain>.workers.dev`.
5. Seed the curated runs (Phase 10 `content/scripts/curate.mjs`, after the user approves the list).

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
