# Phase 31: Lesson depth and parent progress tracking

**Status:** M0–M5 built and merged on `claude/phase-31-lesson-depth-tracking` (2026-10-20). Owner gates remain open: infrastructure setup, privacy review, vocabulary review, educator review and child/parent testing (see Acceptance). Earlier status: planned on 2026-10-19 with the owner; M0 (item-bank spike) and M1 (`@wwm/learning` objectives, banks, generators, evidence and progress) done first. The owner approved starting M1 on 2026-10-19, which applied CCR-31-1 and CCR-31-2. CCR-31-3 (accounts and sync) and CCR-31-4 (lesson drafts) are fixed in [contracts §10.5](contracts.md) and `@wwm/learning` `sync.ts`, so M2–M4 can run in parallel. Owner decisions not yet made use the plan's defaults: passkeys plus an email link, 24-month inactivity deletion, and `LEARNING_ACCOUNTS=off` in production until the privacy review.
**Audience:** Children aged 4–6 playing with a grown-up, and the grown-ups who follow their progress.
**Platform:** Cloudflare only (Workers, Durable Objects, D1, Workflows, Agents SDK, AI Gateway, Email Service, Turnstile, Access). Vercel-based ideas, such as fx0/libfx, are ported to Cloudflare primitives, not adopted.

## Goal

Lessons get deeper and parents can see real progress, while the child's screen stays as simple as it is today.

1. **Depth.** Each objective gets a bank of fresh examples, so a lesson can check understanding on a new item instead of a memorised one.
2. **Tracking for parents, ready for other families.** Parent accounts, child profiles, evidence that syncs across devices, and a Progress page in plain language. Export and deletion work from day one.
3. **Intuitive for young children.** The child's surface keeps the current vocabulary: Pip, spoken prompts, big tap targets, `choose`/`compare`/`difference` rounds and the hint ladder. Only people add new interaction types; an agent never does.

Non-goals: scores or grades shown to children, speed rewards, speech recognition or recording, ads, sharing data with third parties, an Apple TV surface (Phase 30 is out of scope here), and public lesson authoring by other parents.

## Evidence so far

- [M0 spike](../docs/education/item-bank-spike/2026-10-19/README.md): Sonnet 5.5 rounds passed validation 53/54 on first pass and 54/54 after one repair. Three independent runs converged on the same items, though: 9 distinct spelling words out of 18 items. Parametric objectives (colour, compare) gained nothing from a model. **Generators first, agent for open vocabulary.**
- Existing rules this phase keeps (`docs/education/html-contract.md`):
  - Maze falls and scores are never educational evidence.
  - One play-through is practice, not mastery.
  - The document is inert data, rendered only by `@wwm/learning`.
- Existing foundations:
  - `onlyAfterHelpOn` follow-up rounds.
  - Phase 23's session/attempt/event design and the IndexedDB compare-and-commit store (`apps/web/src/learning/storage.ts`, `plans/phase-23-lesson-limits-poc.md` §196–206).
  - The education app is served at `/learn/` on the game's host, so game and lessons share an origin.
  - The Phase 21 Access-protected admin review workbench.
  - Pairing by QR code (rooms, `/c/:code`).

## Design

### 1. Objectives and banks (CCR-31-1, `@wwm/learning`)

Additive to the `wwm-learning/0.3` reader, following the baseline 3.1.0 precedent: older strict readers reject the new fields rather than ignoring them. Baseline revision 3.2.0.

- `path.objectives[]`: `{ id, statement }`. An objective is the unit of tracking. Activities keep their prose `objective` and gain `objectives` (ids, 1–4). Each round gains an optional `objective` id, which defaults to the activity's first objective.
- `path.banks[]`: `{ objective, items: Round[] }` for open-vocabulary objectives (at most 24 items each), or `{ objective, generator: { kind, params } }` for parametric ones. Generated rounds come from shared pure functions in `@wwm/learning`, seeded as overview §7 requires, so every consumer draws the same round from the same seed (like `layoutGroup`).
- `activity.fresh: { objective, count: 1–3 }`. `expandActivity()` draws that many items the profile hasn't seen (by item hash) and inserts them as rounds `fresh-1…` after the required rounds and before any bonus. The result is an ordinary `Activity` (up to 8 written rounds plus 3 fresh), so `step()`, scripts, browser-speech fallback and levels with `steps: 'rounds'` work unchanged. Explicit level step lists don't include fresh rounds. *Changed in M1 from the earlier level-step proposal, so the lesson page gets fresh examples without levels.*
- Baseline 3.2.0 declares one objective per activity (named after it, pending educator grouping) and generated banks for `count-three`, `count-five`, `compare-groups` and `spanish-colors`. No activity asks for `fresh` until M2, when the lesson page plays them.
- Objective checks (`roundIssues`, `checks.ts`) are enforced by the document schema for every round and bank item. They cover spoken counts on compare and difference rounds, completed missing-letter words, Spanish colour words and Spanish number words. All baseline rounds pass.
- **Content hash:** canonical JSON SHA-256 (first 32 hex characters) of each round. Evidence refers to it, which meets the html-contract prerequisite for cross-device progress: a family fork or bank edit is never silently treated as the same item.
- Size: the portable HTML stays within the 200 KB bound. Generators are declared, not expanded.

### 2. Evidence events (CCR-31-2, `@wwm/learning`)

One event per finished round, produced by a pure function from the `step()` session state. The lesson page and the maze emit the same shape.

```ts
interface LearningEvidence {
  v: 1;
  id: string;            // UUIDv7, generated on the device; deduplication key
  profile: string;       // opaque child-profile id, never a name
  at: string;            // ISO time, minute precision
  activity: string;
  objective: string;
  round: string;         // round or bank item id
  item: string;          // round content hash
  source: 'lesson' | 'bank' | 'generator';
  fresh: boolean;        // first time this profile met this item
  outcome: 'first-try' | 'after-retry';
  helpLevel: 0 | 1 | 2 | 3;  // highest hint step used; 3 = worked example
  surface: 'lesson' | 'maze';
  input: InputMode;
  duration: 'lt10s' | 'lt30s' | 'lt2m' | 'ge2m';
}
```

There's no free text, audio, IP, URL, device fingerprint or child name. Evidence never goes to PostHog or any other analytics provider.

### 3. Progress model (pure function, `@wwm/learning`)

`objectiveProgress(events)` returns one plain-language state per objective. The thresholds are **proposed** and need educator review before launch:

| State | Rule (proposed) | Parent copy (draft) |
|---|---|---|
| Not started | No events | "Not tried yet" |
| Practising | Any event | "Practising" |
| Getting there with help | The latest round needed a retry, the strategy or the worked example | "Getting there with help" |
| Got it on new examples | First-try correct with help ≤ 1 on 2+ fresh items, on 2+ different days in the family's time zone | "Got it on new examples" |

There's no percentage, score or ranking. The page states that this reflects practice, not an assessment. Listen-dependent rounds (spelling with real-word distractors, Spanish practice) are labelled as listening practice. Each state links to the activity's `offlineActivity` as "Try together".

### 4. Child surface (unchanged except for profiles)

- **Profile picker:** shown only when the family has two or more child profiles. It shows avatars only (Pip-palette characters chosen by the parent), works by tap and needs no reading. Nicknames are spoken by **browser speech only**; a child's name is never sent to ElevenLabs or any other provider.
- **Fresh-example rounds** look and behave like any other round.
- **No end-of-lesson score** for the child. Pip's finale is as today.
- **Without an account:** every feature works with local-only tracking, for families who never sign in.

### 5. Parent area (`apps/education`)

- **Progress page:** each child, each objective state, the last practised date, a timeline of sessions and "Try together" suggestions.
- **Profiles:** add, rename, change avatar, delete.
- **Devices:** list, revoke, "Add a child's device" (QR code).
- **Account:** export everything as JSON, delete the whole family, privacy notice.
- **Grown-up gate:** the existing hold-to-enter gate on the parent's own device. A paired child device needs a parent sign-in to open the parent area.

### 6. Accounts and sync (CCR-31-3, `apps/worker`)

| Concern | Cloudflare resource |
|---|---|
| Parent sign-in | Passkeys (WebAuthn) first, with an email magic-link fallback through Cloudflare Email Service. Turnstile on sign-up and link requests. |
| Account index, credentials, sessions | New D1 database `wwm-learning-records`, separate from the game's `DB` so the education data can be isolated, exported and deleted on its own. |
| A family's learning records | One SQLite-backed Durable Object per family (`FamilyRecords`). It's the single writer for profiles, devices and events; it deduplicates by event id and maintains objective progress. Deleting the family runs `deleteAll()`. |
| Child devices | Pairing by QR code, as for room pairing. A device token can only append evidence for its family's profiles and read lesson state. It can't read the Progress page. |
| Offline | Events are written to IndexedDB first (an outbox in the Phase 23 store) and synced in batches when online. |
| Rate limits and cost | The existing rate-limit bindings and cost budgets. |

Endpoints (authoritative version: contracts §10.5):

| Endpoint | Purpose |
|---|---|
| `POST /api/learning/auth/passkey/{register,login}` | Passkey sign-up and sign-in |
| `POST /api/learning/auth/email`, `GET /api/learning/auth/email/verify` | Magic-link sign-in |
| `POST /api/learning/events` | `{ events ≤ 200 }` → `{ accepted, duplicate, rejected[{ id, code }] }`; idempotent by event id |
| `GET /api/learning/progress` | Parent session only |
| `GET /api/learning/export` | Parent session only |
| `DELETE /api/learning/family` | Parent session only |
| `POST /api/learning/profiles`, `PATCH /api/learning/profiles/:id`, `DELETE /api/learning/profiles/:id` | Child profile management |
| `POST /api/learning/devices/pair`, `DELETE /api/learning/devices/:id` | Device pairing and revocation |

Error codes: `LEARNING_AUTH_REQUIRED`, `LEARNING_FORBIDDEN`, `LEARNING_RATE_LIMITED`, `LEARNING_INVALID`.

### 7. Privacy gate (owner and legal review, before any family other than the owner's)

Child profiles linked to learning events are personal information about children. In the US, COPPA treats persistent identifiers that way. EU/UK families bring GDPR and the UK Age Appropriate Design Code. This plan is not legal advice; launching to other families requires a privacy review. The design minimises what's collected:

- **The parent is the account holder** and the only person who signs in. Children never create accounts or enter text.
- **Child data is limited** to a nickname, an avatar and an optional age band. There's no birthdate, photo, voice, school or location.
- **Purpose is limited:** evidence is used only to show progress to that family. There's no advertising, profiling, analytics provider or sale.
- **Retention:** until deletion, or 24 months without activity, after which records are deleted (proposed). Export and deletion are self-service and immediate.
- **Telemetry audit:** confirm that `POST /api/t` never carries profile ids. Decide whether game telemetry is disabled while a child profile is active.
- **Deliverables:** a privacy notice and parental consent at sign-up, and the review recorded in `docs/launch/` before public enablement.

### 8. Authoring agent (CCR-31-4, Access-only; the fx0 pattern ported to Cloudflare)

Narrowed by M0: the agent writes **open-vocabulary bank items and new lesson drafts**. Parametric items come from generators.

| fx0 / libfx piece | Here |
|---|---|
| `createFxAgent()` session per chat | Agents SDK `AIChatAgent`: one Durable Object per draft, transcript and versions in its SQLite |
| Each step saved in Workflow World, crash resume | Cloudflare Workflow `LessonDraft`: generate → validate → repair (≤ 2) → queue for review; after approval, voice → publish |
| Vercel Queues backstop | Not needed: Workflows resume after failure. Queues only for voice fan-out |
| Vercel AI Gateway | AI Gateway `wwm` (Anthropic BYOK) |
| Tools marked safe or unsafe to re-run | Validate, preview and read are safe to re-run. Voice generation and publishing run exactly once, with idempotency keys |
| A design version per turn | A draft revision per turn, identified by content hash, previewed with `portablePage()` |
| Sign in with Vercel, BotID | Cloudflare Access (operator identity), as in the Phase 21 admin |

Agent tools: the schema validator and `playIssues()`, the objective checks, `portablePage()` preview, `activityScript()`, the bank so far (as an exclusion list) and a reviewed age-appropriate word list. Output goes into the Phase 21 review workbench. Nothing reaches a child without an operator's approval.

## Milestones

| | Deliverable | Gate |
|---|---|---|
| M0 | Item-bank spike (`tools/lesson-draft`) | Done 2026-10-19; see evidence |
| M1 | CCR-31-1/2 in `@wwm/learning`: objectives, banks, `fresh`, objective checks, generators for compare, difference, count and colour, evidence and `objectiveProgress()` | Done 2026-10-19: `test/depth.test.ts` covers generator determinism and layout fit, checks on every generated round, fresh drawing, evidence and progress rules |
| M2 | Local tracking: IndexedDB evidence and outbox, lesson page emits evidence, profile picker, parent Progress page (local) | Done 2026-10-20 ([build log](../docs/build-log/phase-31-m2.md)): 29 Chromium e2e on desktop and mobile |
| M3 | Accounts and sync: D1 database, `FamilyRecords` DO, passkey and magic link, pairing, export and delete, Turnstile | Built 2026-10-20 ([build log](../docs/build-log/phase-31-m3.md)): workerd integration tests and an account e2e pass. **Open:** owner infrastructure setup and the privacy review before `allowlist`/`on` |
| M4 | Authoring agent: Agents SDK + Workflow, review-queue integration | Built 2026-10-20 ([build log](../docs/build-log/phase-31-m4.md)), including one real gateway smoke test. **Open:** owner vocabulary review, then one spelling bank approved, imported and merged |
| M5 | Maze emits the same evidence (`surface: 'maze'`) | Done 2026-10-20 ([build log](../docs/build-log/phase-31-m5.md)): unit proof that falls and score never affect evidence; 5 Chromium e2e |

## Acceptance (human gates, checked by the orchestrator)

- **Child usability:** a child aged 4–5 completes a lesson, including fresh-example rounds, without reading and with no more grown-up help than today's lessons need.
- **Parent comprehension:** at least three parents read the Progress page and correctly say what their child practised and what to try next, without explanation.
- **Educator review:** progress thresholds and parent copy.
- **Privacy:** review done and recorded before enabling sign-up for anyone outside the owner's family.

## Owned paths

| Path | What this phase owns there |
|---|---|
| `packages/learning/src/` | Additive objectives, banks, evidence, progress and generators. The orchestrator approves the CCRs first |
| `apps/education/src/` | Parent area and profile picker |
| `apps/worker/src/learning-records/`, `apps/worker/migrations/` | New migration for `wwm-learning-records` |
| `apps/worker/wrangler.jsonc` | Bindings only; run `pnpm --filter worker types` after editing |
| `apps/web/src/learning/` | M5 only |
| Phase 31 tooling and records | `tools/lesson-draft/`, `docs/education/`, `docs/build-log/phase-31.md` |

## Decisions for the owner

1. Approve CCR-31-1 to CCR-31-4 as written, or amend them.
2. Sign-in: passkeys with an email magic-link fallback (recommended), or magic link only.
3. Retention default: 24 months of inactivity (proposed).
4. Who performs the privacy review, and whether game telemetry is disabled while a child profile is active.
5. Educator reviewer for progress thresholds and parent copy.
