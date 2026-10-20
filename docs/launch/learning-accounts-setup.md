# Learning family accounts: owner setup (Phase 31 M3)

These steps create real Cloudflare resources and secrets, so **only the owner runs them**. The agent that built M3
didn't create, change or deploy anything remote. Until these are done, the code ships switched off:
`LEARNING_ACCOUNTS` is `off` in production and in previews, and every `/api/learning/*` path answers
`404 LEARNING_UNAVAILABLE`.

Run the commands from `apps/worker` with your normal `wrangler login`. Always pass `--env production`, as for every
other deploy command ([infra/README.md](../../infra/README.md)). Never paste a secret value on the command line:
`wrangler secret put` prompts for it.

> **Merge blocker.** `wrangler.jsonc` has **placeholder** D1 ids for `LEARNING_DB` in production
> (`…000000000004`) and previews (`…000000000005`, also in `wrangler.preview-migrations.jsonc`).
> `check-deploy-config.mjs` refuses them, so CI stops before deploying. Do step 1 **before** Phase 31 reaches
> `main`, which deploys automatically.

## Inputs the owner decides
| Input | Default in the code | Where it goes |
|---|---|---|
| Sending domain for sign-in email | `wwm.ewj.dev` | Email Service onboarding (step 2) |
| Sender address | `learn@wwm.ewj.dev` | `LEARNING_EMAIL_FROM` in `env.production.vars` (and previews) |
| Allowed emails while in allow-list mode | none | `LEARNING_ALLOWED_EMAILS` secret (step 4) |
| When to move `off` → `allowlist` → `on` | `off` | `LEARNING_ACCOUNTS` in `env.production.vars` (step 6). `on` only after the privacy review is recorded |

## 1. The D1 databases
The provisioning script knows both databases (`learningD1` in `infra/cloudflare.config.json`). From the repo root,
with your wrangler login:
```sh
node infra/scripts/provision.mjs            # dry run: shows "+ create … wwm-learning-records(-preview)"
node infra/scripts/provision.mjs --apply    # creates them, writes the ids, applies the migrations
node infra/scripts/check-deploy-config.mjs all
```
Commit the changed `apps/worker/wrangler.jsonc`, `wrangler.preview-migrations.jsonc` and
`worker-configuration.d.ts`. To do it by hand instead, run `wrangler d1 create` for both names and put the ids
in `apps/worker/wrangler.jsonc`:
- `env.production.d1_databases[]` entry with `"binding": "LEARNING_DB"`: replace `00000000-0000-0000-0000-000000000004`
  with the id of `wwm-learning-records`.
- `env.production.previews.d1_databases[]` entry with `"binding": "LEARNING_DB"`: replace
  `00000000-0000-0000-0000-000000000005` with the id of `wwm-learning-records-preview`. Never production's id.
- `apps/worker/wrangler.preview-migrations.jsonc`, binding `LEARNING_PREVIEW_DB`: the same preview id.
- Leave the top-level `…000000000003` alone: that's local dev and tests.

CI applies the schema: the production deploy runs `wrangler d1 migrations apply LEARNING_DB --remote --env
production`, and PR previews apply `LEARNING_PREVIEW_DB` from `wrangler.preview-migrations.jsonc`.
`node infra/scripts/check-deploy-config.mjs production` (and `previews`) should then report no learning problems.
`infra/cloudflare.config.json` and `provision.mjs` don't know this database yet; adding it there is optional.

## 2. Email sending domain (Cloudflare Email Service)
1. Dashboard: **Compute & AI › Email Service › Email Sending › Onboard Domain**, then choose `wwm.ewj.dev` (or the domain you
   picked) and **Add records and onboard**. CLI equivalent: `pnpm exec wrangler email sending enable wwm.ewj.dev`.
2. Onboarding adds the **SPF** (TXT) and **DKIM** records. Check them with
   `pnpm exec wrangler email sending dns get wwm.ewj.dev`. DNS usually propagates within 5–15 minutes.
3. Add a **DMARC** record if the domain has none: TXT `_dmarc.wwm.ewj.dev` with value
   `v=DMARC1; p=quarantine; rua=mailto:ewjdev@gmail.com`. Start with `p=none` if you want reports first.
4. If you chose a different sender, set `LEARNING_EMAIL_FROM` in `env.production.vars` and `previews.vars`. The
   binding is `"send_email": [{ "name": "LEARNING_MAIL" }]` in every environment. You can optionally restrict it with
   `"allowed_sender_addresses": ["learn@wwm.ewj.dev"]`.
5. Test once from your own address (don't use made-up addresses, because bounces hurt the domain's reputation):
   `pnpm exec wrangler email sending send --from learn@wwm.ewj.dev --to <you> --subject Test --text Test`.

The binding is transactional only. Sign-in emails are the only messages this feature sends.

## 3. Turnstile
1. Dashboard: **Turnstile › Add widget**. Name it `wwm-learning`, add the hostname `wwm.ewj.dev`, and choose
   Widget mode **Managed**.
2. **Site key** (public): the education pages read it at build time from `VITE_TURNSTILE_SITE_KEY`. Add it as a
   GitHub Actions variable and pass it in the `env:` of the production "build web" step
   (`pnpm --filter @wwm/web build`, which also builds `/learn/`). Without it, a production build shows "Sign-in by
   email isn't set up in this build".
3. **Secret key**:
   ```sh
   pnpm exec wrangler secret put TURNSTILE_SECRET --env production
   pnpm exec wrangler preview base-config secret put TURNSTILE_SECRET --env production   # only if previews use it
   ```
   Deployed Workers refuse Cloudflare's test secrets on purpose. Without a real secret, `POST auth/email` answers
   `503`.
4. The Worker's CSP for `/learn/account/*` already allows `https://challenges.cloudflare.com` (script and frame)
   and nothing else.

Local dev and the tests need none of this. Without `TURNSTILE_SECRET`, development uses the documented
always-pass test secret, and the dev build sends the dummy token.

## 4. Allow-list
```sh
pnpm exec wrangler secret put LEARNING_ALLOWED_EMAILS --env production
# value: comma-separated, e.g.  you@example.org,partner@example.org   (case and spaces don't matter)
```
It's only read when `LEARNING_ACCOUNTS` is `allowlist`. Everyone still gets the same `202` answer; only listed
addresses receive a link.

## 5. Passkeys: `LEARNING_RP_ID` and `LEARNING_ORIGIN`
- Production is already set: `LEARNING_RP_ID` `wwm.ewj.dev`, `LEARNING_ORIGIN` `https://wwm.ewj.dev`. If the domain
  changes, change both. Passkeys made for one RP id don't work on another. `LEARNING_ORIGIN` is also the origin
  used in emailed links, and the only extra origin trusted for cookie requests (CSRF).
- Previews: both are empty, so passkeys are refused there, and Previews are closed anyway (`preview_urls: false`).
  If you ever open a Preview to test accounts, set its exact `https://…` origin and host. Expect passkeys made there
  to be useless elsewhere.
- Deployed environments ignore `http://` origins.

## 6. Turning it on
1. Complete the privacy review: [learning-privacy.md](learning-privacy.md) and its reviewer checklist. Record the
   outcome in `docs/launch/`.
2. For your own family first: set `"LEARNING_ACCOUNTS": "allowlist"` in `env.production.vars`, then deploy
   through the normal PR flow.
3. Check that it works:
   - `curl -s https://wwm.ewj.dev/api/learning/session` returns `{"signedIn":false}`. When the feature is off, it
     returns a 404 with `LEARNING_UNAVAILABLE`.
   - Open `https://wwm.ewj.dev/learn/account/`, sign in with an allow-listed address, and confirm the email arrives
     and the link signs you in.
   - Add a passkey, sign out, and sign back in with it.
   - Pair a second device, play a lesson there, and confirm the practice appears for the grown-up.
   - Download the export. Then delete a test family, and confirm a second sign-in creates a new, empty family.
4. Use `on` (open sign-up) only after the privacy review allows it.

## Costs and limits
- D1 and Durable Object storage are small: about 500 bytes per practice record.
- Email Service is billed per message, and sends are rate-limited to 5 per address per hour, plus 20 auth requests
  per minute per IP.
- Event sync is limited to 60 batches of at most 200 events per family per minute.
- All learning routes also count against the existing per-IP read limit and cost budget.

## Rollback
Set `LEARNING_ACCOUNTS` back to `off` and deploy. Data stays in place, and the retention purge keeps running.

To remove everything, delete each family first, through `DELETE /api/learning/family` while signed in or by
letting the retention purge run. Only then run `wrangler d1 delete wwm-learning-records`. If you delete the
database first, the FamilyRecords objects can no longer be found, and their storage would be orphaned.
