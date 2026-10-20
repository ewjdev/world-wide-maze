# Learning accounts: privacy review record, 2026-10-20

**Reviewer:** Claude Code (Claude Opus 5.5), the Phase 31 orchestrator. The owner delegated these decisions on 2026-10-20 ("move forward with your recommendations … turn it on in production").
**Scope:** the technical and operational items of the [reviewer checklist](learning-privacy.md#reviewer-checklist). This is an engineering review, **not legal advice**. The legal items (COPPA, GDPR/UK GDPR, state law) were **not** reviewed; they still need a qualified person.

## Outcome
Production runs `LEARNING_ACCOUNTS=allowlist`. Only the owner's own addresses (the `LEARNING_ALLOWED_EMAILS` secret) can create a family, so the only family data collected is the owner's, about the owner's own children.

Open sign-up (`on`), or adding any other family to the allow-list, stays blocked until the legal items below are reviewed and recorded.

## Facts against the code
| Item | Result |
|---|---|
| Data table matches migrations, `FamilyRecords`, `profileSchema`, `evidenceSchema` | Pass. Checked by reading `migrations-learning/0001_learning_records.sql`, `family-records.ts` and `@wwm/learning` `sync.ts`/`evidence.ts`. A profile is a nickname, an avatar and an optional age band (the UI doesn't ask for it). Evidence has no free text. |
| Export contains everything about the family | Pass. The integration test compares the export with the stored rows. |
| Deletion and the 24-month purge leave nothing | Pass. The integration test checks every D1 table and the Durable Object's storage after both. |
| No logging of bodies, emails or nicknames; no telemetry | Pass. The two `console.error` calls in `learning-records/routes.ts` log only the route pattern, method and error name. No learning module calls `/api/t` or PostHog. |
| Game telemetry while a child plays | Decision: game telemetry stays as it is. It never carries profile ids or nicknames; the M5 e2e asserts no request does. |

## Operations
| Item | Result |
|---|---|
| Owner setup | Done 2026-10-20:<br>• D1 `wwm-learning-records` and `-preview` created and migrated<br>• Turnstile widget `wwm-learning` (managed, `wwm.ewj.dev`), secret set<br>• Allow-list secret set<br>• Sender `learn@ewj.dev`: `ewj.dev` is already onboarded to Email Sending, with SPF, DKIM and DMARC `p=reject`. A `wwm.ewj.dev` sender would inherit `p=reject` without being onboarded. |
| Contact path and response time published | **Open.** Required before `on`. |
| Breach response | **Open.** Required before `on`. |
| Consent wording matches `CONSENT_VERSION` | Pass for the draft notice (`2026-10-19`). Bump it when the notice changes after legal review. |

## Still open before `on` (legal; not reviewed)
- **United States:** COPPA. Whether the service is directed to children; whether email-plus consent fits; direct and online notice contents (operator name, address, phone, email); the 2025 Rule amendments (written retention and security programs); state laws.
- **EU and UK:** GDPR/UK GDPR. Lawful basis, controller and representative, parental consent age, international transfers, data subject rights, the Age Appropriate Design Code and a DPIA.
