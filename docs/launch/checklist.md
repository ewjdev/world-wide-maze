# G4 launch checklist

Legend: ✅ done with evidence · 🟡 partly done / done locally only · ❌ not done · 👤 **needs the user** (account
owner, a physical device, or an approval an agent can't give).
Status as of Phase 12 (local-only pass, 2026-09-25). **G4 is not met yet**: production doesn't exist, and several
items need the user.

## Gates and approvals
| # | Item | Status | Evidence / what's missing |
|---|---|---|---|
| 1 | G0–G3 passed | 🟡 | G0 ✅ G1 ✅ (plans/00-overview.md gate log). G2: solver ✅; human keyboard + phone playthrough of 5 stages pending (docs/build-log/phase-08-playtest.md) 👤. G3 partial: curated list not approved 👤 |
| 2 | User approved the legal pages | ❌ 👤 | Drafts: [privacy](legal-drafts/privacy.md), [terms](legal-drafts/terms.md), [takedown](legal-drafts/takedown.md), [tribute disclaimer](legal-drafts/tribute-disclaimer.md). Fill in operator name, contact, jurisdiction, score retention; not linked from the site |
| 3 | User approved the curated list | ❌ 👤 | content/curated-proposal.md → content/curated.json `approved: []` |
| 4 | User approved the production deploy | ❌ 👤 | GitHub Environment `production` with required reviewers (infra/README.md) |
| 5 | Known limitations published on `/about` | 🟡 | Draft text: [known-limitations.md](known-limitations.md); Phase 10 mounts it after approval |

## Environments and deploy
| # | Item | Status | Evidence / what's missing |
|---|---|---|---|
| 6 | Staging + production Workers, R2, D1, KV, secrets | 🟡 👤 | Config ready: `apps/worker/wrangler.jsonc` `env.staging` / `env.production` (placeholder ids); provisioning commands in infra/README.md. `node infra/scripts/check-deploy-config.mjs production` currently **fails on purpose** (placeholders, no domain) |
| 7 | Custom domain with HTTPS | ❌ 👤 | Needs a domain; `routes` stub in `env.production` |
| 8 | Web app as Workers static assets, headers | ✅ (local) | `wrangler dev --env staging` serves `apps/web/dist` with SPA fallback and `_headers`; smoke test 7/7 PASS: [evidence/smoke-local.txt](evidence/smoke-local.txt) |
| 9 | COOP/COEP | ✅ | COOP `same-origin`; no COEP needed (no SharedArrayBuffer: physics runs lockstep on the main thread, contracts v0.2.6) |
| 10 | GitHub Actions: staging on `main`, production on tag with approval, D1 migrations in CI | 🟡 👤 | `.github/workflows/deploy.yml` — never run; inert until `WWM_DEPLOY_ENABLED=true` |
| 11 | Rollback procedure tested once | ❌ 👤 | Procedure: runbook §4 (`wrangler rollback`). Needs a real staging deployment |
| 12 | Budget alerts | ❌ 👤 | Thresholds in runbook §7; dashboard-only |

## Product checks
| # | Item | Status | Evidence / what's missing |
|---|---|---|---|
| 13 | Fresh-browser end-to-end playthrough on production | ❌ 👤 | Locally: e2e suite green on the lazy-loaded build (docs/build-log/phase-12.md). Production pending |
| 14 | Phone onboarding on the device matrix | 🟡 👤 | iPhone 17 Pro Safari ✅ (phase-06-device-test.md). Missing: 2nd iOS version, 2 Android devices, desktop Safari/Firefox/Edge, permission denial, backgrounding, rotation, reconnect, keyboard-only — table below |
| 15 | Curated stages load with capture disabled (kill switch) | 🟡 | Kill switch implemented and verified locally: [evidence/kill-switch.txt](evidence/kill-switch.txt). Curated set itself pending (#3) |
| 16 | Performance report with real measurements | 🟡 | [performance.md](performance.md): M5 Max measured; integrated-GPU and midrange desktops, filmed controller latency and time-to-first-control with 5 fresh users need people/hardware 👤 |

## Security and abuse
| # | Item | Status | Evidence |
|---|---|---|---|
| 17 | Security review of Worker + web | ✅ | performance.md §6 and docs/build-log/phase-12.md (fixed/open lists) |
| 18 | SSRF suite re-verified | ✅ (local) | `pnpm vitest run --project @wwm/worker test/url-policy.test.ts test/capture-guard.test.ts` green; production config keeps `DEV_ALLOWED_HOSTS=""` (checked by `check-deploy-config.mjs` and `test/security.test.ts`) |
| 19 | CSP / security headers | ✅ (local) | `_headers` + `src/security.ts`; 0 CSP violations except zod's caught eval probe (performance.md §6) |
| 20 | Input size limits, DO message size + rate caps | ✅ | `security.ts` body caps; Room DO caps with tests (`test/room.test.ts`) |
| 21 | `/api/rooms/:code/stats` gated out of production | ✅ | `ROOM_STATS=0` in staging/production; tests in `rooms-route.test.ts`, `security.test.ts` |
| 22 | Load tests (200 rooms @ 60 Hz, 50-build burst) | 🟡 | Local only: performance.md §5. Re-run against staging 👤 |
| 23 | Pairing secret (room hijack by code guessing) | ❌ | Open CCR (phase-12 hand-off); mitigated by per-IP limits only |

## Device matrix (to fill in with the user)
| Browser / device | Pairing | Permission denied | Backgrounding | Rotation | Reconnect | Keyboard-only |
|---|---|---|---|---|---|---|
| iOS Safari (iPhone 17 Pro) | ✅ | not run | lock/unlock unverified | ✅ banner | unverified | n/a |
| iOS Safari (older iOS) | 👤 | 👤 | 👤 | 👤 | 👤 | n/a |
| Android Chrome (device 1) | 👤 | 👤 | 👤 | 👤 | 👤 | n/a |
| Android Chrome (device 2) | 👤 | 👤 | 👤 | 👤 | 👤 | n/a |
| Desktop Chrome (macOS) | host ✅ (e2e) | n/a | auto-pause ✅ (e2e) | n/a | ✅ (e2e disconnect/resume) | ✅ (e2e) |
| Desktop Safari / Firefox / Edge | 👤 | n/a | 👤 | n/a | 👤 | 👤 |
