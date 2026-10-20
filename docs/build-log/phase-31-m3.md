# Phase 31 M3: Parent accounts, child devices and progress sync

**Date:** October 19, 2026, about 22:50–23:40 PT (America/Los_Angeles).
**Agent:** Claude Code (Claude Opus 5.5), a phase sub-agent in the worktree `p31-m3-accounts-sync` (branch
`claude/p31-m3-accounts-sync`). M2 (device progress) and M4 (lesson drafts) ran in parallel in their own worktrees.
**Plan:** [plans/phase-31-lesson-depth-and-tracking.md](../../plans/phase-31-lesson-depth-and-tracking.md) §6–7.
**Contract:** [plans/contracts.md](../../plans/contracts.md) §10.5 (CCR-31-3), implemented as written. No new CCR.

## Key instructions
- Implement every `/api/learning/*` endpoint in contracts §10.5.
- Storage: a new D1 database `wwm-learning-records` (`LEARNING_DB`) and a SQLite `FamilyRecords` Durable Object per
  family.
- Sign-in: email links (Turnstile, consent, 15 minutes, one use) and passkeys.
- Devices: pairing (6 characters, 10 minutes, one use) with revocable bearer tokens.
- Rate limits, export, deletion and 24-month retention.
- Privacy: no body, email or nickname logging, no telemetry, `no-store`. A same-origin check on cookie requests.
- The gate `LEARNING_ACCOUNTS`: `off` by default and in production and previews, `on` in local dev.
- Also build a typed client with `syncOutbox`, the account UI in the education app (plugging into M2's slot), a
  draft privacy notice, owner setup steps, and tests: real workerd integration, client units, and a browser e2e
  if feasible.
- Load the `durable-objects`, `cloudflare-email-service`, `workers-best-practices` and `wrangler` skills first.
- Don't touch remote Cloudflare resources, deploy, send real email or use real secrets.

## What changed (N: new, not a 2013 feature)
- **Worker (N)** in `apps/worker/src/learning-records/`:
  - **Routes:** `routes.ts` is one Hono sub-app, mounted with one line in `router.ts`. `index.ts` exports
    `FamilyRecords`, and the existing cron calls `sweepLearningRecords` first, wrapped so it can never block the
    other sweeps.
  - **Storage:** `accounts.ts` holds the D1 queries (every token is SHA-256 only). `family-records.ts` is the DO:
    `INSERT OR IGNORE` dedupe, `UNKNOWN_PROFILE`, a profile deletion that cascades in one `transactionSync`,
    `(at, id)` cursor paging, and `deleteAll()`.
  - **Sign-in:** `passkeys.ts` uses `@simplewebauthn/server` 14, with one-use challenges in D1. `mailer.ts` sends
    through the `send_email` binding, with a development-only KV mock mailbox. `turnstile.ts` calls siteverify;
    in development it answers Cloudflare's test secrets locally.
  - **Configuration:** `config.ts` fails closed. Deployed Workers refuse test secrets, the mock mailbox and
    `http://` origins.
- **Config:**
  - `wrangler.jsonc` adds to every environment: the `LEARNING_DB` binding (placeholder ids for production and
    previews), `FAMILY_RECORDS` (migration tag `v5`), `LEARNING_MAIL`, `LEARNING_AUTH_LIMITER` and
    `LEARNING_EVENTS_LIMITER` (namespaces 7010/7011, 7210/7211, 7310/7311), and five vars. The cron is reused.
  - `worker-configuration.d.ts` was regenerated.
  - `migrations-learning/0001_learning_records.sql`.
  - The dev scripts apply both databases' migrations.
- **No enumeration:** `POST auth/email` validates the request and Turnstile, then answers `202 {}`. The account
  lookup, the allow-list check, the per-address limit (5 an hour, `Limiter` DO) and the email all run in
  `waitUntil`, so neither the answer nor its timing depends on whether the account exists.
- **No silent sign-up:** a new address without consent gets an email explaining how to sign up, with no link.
- **Client (N):** `packages/learning/src/sync-client.ts`:
  - `createSyncClient()` covers every endpoint and raises `LearningApiError` with the `LEARNING_*` code or
    `NETWORK`.
  - `syncOutbox()` sends batches of at most 200 and marks accepted and duplicate ids synced. It keeps rejected
    ids and skips past them, so they can't block newer events. It backs off on 429 (honouring `Retry-After`),
    offline and 5xx.
  - `uploadLocalProgress()`.
- **UI (N):** `apps/education/src/account*.ts` and `account.css`. These pages are generated: `/account/` and
  `/account/verify` (served at `/learn/account/…`).
  - Email sign-in with Turnstile and the consent box, and a passkey sign-in (`@simplewebauthn/browser`).
  - "Add a child's device": a code plus a QR code drawn with `uqr`, the same way the game draws its pairing QR.
    The QR opens `/learn/account/#pair=CODE`, which prefills the claim form.
  - The device list with Remove, "Send this device's practice now", the JSON export, and delete with typed
    `DELETE`.
  - A privacy summary on the page.
  - `account-sync.ts` is the API for M2's Progress page: `mountAccountSlot`, `syncNow`, `progressProfiles`,
    `progressEvents`, `pushProfile` and `removeProfile`.
- **Small edits outside the owned paths, needed to keep `pnpm check` green or the pages working:**
  - `render.ts` exports `shell`. M2 made the identical change.
  - `generate.ts` and `vite.config.ts`: the account pages, a dev `/api` proxy, and a dev `/learn/` prefix.
  - `apps/education/.gitignore`.
  - `routes/learning-page.ts`: `/learn/account/*` CSP allows `https://challenges.cloudflare.com` (script and
    frame) only.
  - `testing/solver-probe-worker.ts`: exports `FamilyRecords`, since the probe uses the same config.
  - `infra/scripts/lib/cloudflare-infra.mjs`: the required DO bindings are now checked as a subset, not an exact
    list.
  - `test/security.test.ts`: the expected limiter list, plus `LEARNING_ACCOUNTS` `off` and email mode `send` in
    production and previews.
- **Docs:**
  - [learning-privacy.md](../launch/learning-privacy.md): a DRAFT, not legal advice, with a reviewer checklist
    covering COPPA, GDPR/UK and operations.
  - [learning-accounts-setup.md](../launch/learning-accounts-setup.md): the owner steps.
  - The `apps/worker/README.md` section and `.dev.vars.example`.

## Decisions
- **WebAuthn:** `@simplewebauthn/server` runs in workerd. Proof: the integration test builds `none`-attestation
  ES256 credentials with a software authenticator (`test/learning-records-authenticator.ts`, a minimal CBOR
  encoder and a DER signature). It registers and signs in through the real Worker, and is refused for replayed
  challenges and wrong origins. In the browser e2e, Chromium's CDP virtual authenticator does the same through
  `@simplewebauthn/browser`.
  - The cost is about 0.7 MB of unminified bundle (asn1/x509, for attestation formats this app doesn't need). The
    Worker upload is 17.5 MB raw and 5.5 MB gzip in the dry run.
- **CSRF:** a mutating request that carries the cookie, or that sets one (`email/verify`, `passkey/login/verify`),
  must send an allowed `Origin`: the Worker's own, `LEARNING_ORIGIN`, or (development only) a loopback Vite proxy.
  Bearer-only device requests need none.
- **Devices read the family's profiles** (needed for the child's picker on a linked tablet) and send events. Only
  a parent reads events, the export or devices.
- **Turnstile in dev:** without a site key, the Vite dev build sends the documented dummy token and the
  development Worker answers the always-pass test secret locally. So nothing needs the network.

## Attempts that failed
- **Node strip-only TypeScript:** the first `LearningApiError` used constructor parameter properties.
  `apps/education/vite.config.ts` imports `@wwm/learning` under Node's strip-only TypeScript, which rejects them,
  so Vitest couldn't load the project. Rewritten with plain fields.
- **Gate test in a deployed environment:** an integration test that set `WWM_ENV=preview` got `429` from the
  existing global cost ingress (cost controls are always on outside development). The fail-closed checks moved
  to unit tests of `learningConfig()` instead.
- **The existing tests needed the new bindings:**
  - The solver probe Worker (its own entry, same `wrangler.jsonc`) timed out until it exported `FamilyRecords`.
  - `security.test.ts` and the deploy guard both expected exact binding lists.
- **Small fixes:**
  - The e2e needed `wrangler` as an education devDependency.
  - Biome rejected a local named `escape` (it shadows a global), and an optional chain in a test.

## Manual interventions
None.

## Test evidence
- **`pnpm check`** (typecheck, Biome, Vitest; Chromium installed) is green after `pnpm docent:index`: 162 test
  files passed and 6 skipped; 1,731 tests passed and 44 skipped. The 49 new tests below all ran, none skipped.
- **`apps/worker/test/learning-records.integration.test.ts`** has 19 tests in real workerd with D1, Durable
  Objects, KV and rate limits. It covers:
  - the anonymous session and `no-store`;
  - consent required, with version and time recorded, and normalized email;
  - the cookie attributes, the 30-day `Max-Age`, and hash-only storage;
  - one-use, 15-minute links and an expired link;
  - identical answers for existing, new and consent-less addresses;
  - profiles: upsert, patch, validation, and devices read-only;
  - pair codes: alphabet, 10 minutes, one use, expiry;
  - events: dedupe, `UNKNOWN_PROFILE`, `INVALID`, size bounds, parent-only reads, and 604-event paging;
  - the profile deletion cascade;
  - cross-family isolation (session and device, read and write, export);
  - revocation;
  - CSRF (foreign, missing and `null` Origin; `Sec-Fetch-Site`);
  - passkey register and login, with replay and wrong origin;
  - sign-out;
  - export completeness;
  - deletion completeness (every D1 table and DO `sqlite_master` empty);
  - the retention cron;
  - rate limits (per IP and per family);
  - logs free of emails and nicknames.
- **A mutation check:** disabling the DO's profile check made 4 of the 19 fail (isolation, cascade, events,
  profiles).
- **The other test files:**
  - `learning-records-gate.integration.test.ts`: 4 tests (off, allowlist, on, Turnstile failure).
  - `learning-records-config.test.ts`: 6 tests.
  - `learning-page.test.ts`: the CSP for account pages.
- **`packages/learning/test/sync-client.test.ts`:** 9 tests, with a fake fetch and an in-memory `ProgressStore`.
- **`apps/education/test/account.test.ts`:** 5 tests (the page HTML, and the helpers with and without an account).
- **`apps/education/test/account.e2e.test.ts`:** Chromium, workerd behind the education Vite dev server. It walks
  through:
  1. the email link via the mock mailbox;
  2. adding a passkey (virtual authenticator), then signing out and back in with it;
  3. the pair code and QR;
  4. a second browser context opening the QR link and linking itself;
  5. the tablet sending events (and being refused progress reads), and the parent seeing them;
  6. the device list and the JSON export;
  7. revocation and typed-confirmation delete;
  8. and, in a second test, a used link explaining itself.

  Screenshots at 1280 wide and 390×844 were reviewed by hand (`WWM_ACCOUNT_SHOTS`, not committed).

## Remaining defects and follow-ups
- **Merge blocker for automatic deploys:** the production and preview `LEARNING_DB` ids are placeholders. The owner
  must create the databases first (setup doc step 1), or merge with those entries removed.
- **CI:**
  - The CI deploy doesn't apply `migrations-learning/` yet.
  - The web build needs `VITE_TURNSTILE_SITE_KEY`. Both are owner or orchestrator edits to `ci.yml`.
- **Until M2's store is wired in, nothing is uploaded:** `account.ts` registers no `ProgressStore` (there is a
  marked MERGE POINT), and the device token falls back to `localStorage`. The e2e therefore sends the tablet's
  events through the API directly.
- **The Progress page:** M2's page still has to call `mountAccountSlot` and `progressEvents`, and
  `pushProfile`/`removeProfile` on edits. A profile deleted locally while signed out comes back from the family on
  the next sync.
- **Profiles a linked device made itself:** a device can't create profiles. Events for a device-only profile stay
  in its outbox (`UNKNOWN_PROFILE`) until a parent signs in on that device or the profile is created from the
  parent side.
- **Bundle size:** `@wwm/learning` is imported from its root, which adds about 130 KB unminified to the Worker
  (the baseline path is parsed at load). A `./sync` subpath export would avoid it.
- **Unverified on real Cloudflare:** Email Service delivery and Turnstile siteverify (only the documented local
  test-secret path and a fake fetch were exercised); and whether a `send_email` binding without an onboarded
  domain blocks a deploy.
- **The privacy review, COPPA consent method and educator review** are human gates (plan "Acceptance").
