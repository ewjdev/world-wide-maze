# Privacy notice: WWM Learning family accounts

> **DRAFT: not legal advice. Needs review** by the operator and a qualified lawyer before any family outside the
> owner's own uses a family account (plans/phase-31-lesson-depth-and-tracking.md §7).
>
> An agent wrote this draft on October 19, 2026 from the code at the commit that added it
> (`apps/worker/src/learning-records/`, `apps/education/src/account*.ts`, `packages/learning/src/sync.ts` and
> `evidence.ts`). Re-check every factual statement if that code changes. Placeholders follow
> [legal-drafts/README.md](legal-drafts/README.md): `EWJ Dev LLC`, `ewjdev@gmail.com` and `wwm.ewj.dev`. The game's
> own notice is [legal-drafts/privacy.md](legal-drafts/privacy.md); this one covers only the optional learning
> family account. The account page shows a short summary and links here (`CONSENT_VERSION` `2026-10-19`).

---

**WWM Learning** at `https://wwm.ewj.dev/learn/` is run by EWJ Dev LLC. Contact: ewjdev@gmail.com.
Draft dated October 19, 2026.

## The short version
- The family account is **optional**. Every lesson, and progress on one device, works without it.
- **A grown-up holds the account.** Children never sign in, create an account or type anything.
- We keep **as little as we can**: your email, the public half of any passkey, a nickname and Pip colour for each
  child (and an age band if you choose), which devices you linked, and records of the lesson rounds each child
  solved.
- It is used **only to show your family its own progress**. No ads, no analytics, no profiling, no selling, no
  sharing with anyone.
- You can **download everything or delete everything** yourself, at any time, from the family account page.
  Accounts unused for 24 months are deleted automatically.

## 1. What we collect

| What | Why | Where it comes from |
|---|---|---|
| **Your email address** (stored in lower case) | To send one-time sign-in links, and to recognise your family account | You type it |
| **Your consent**: the notice version you agreed to and when | To show that a parent or guardian agreed before a family account existed | The consent box at sign-up |
| **Passkeys**: a credential id, the public key and a signature counter | To let you sign in without email. The private key never leaves your device | Your device, when you add a passkey |
| **Sessions**: a random sign-in token (stored only as a one-way hash), when it was created, and when it expires | To keep you signed in for up to 30 days | Created when you sign in |
| **Sign-in links and pairing codes** (stored only as one-way hashes) and their expiry | To make links work once for 15 minutes, and codes once for 10 minutes | Created when you ask for them |
| **Each child's profile**: a nickname (letters only, up to 24 characters), a Pip colour, and optionally an age band (4, 5 or 6) | To show each child's progress separately, and to let a child pick their Pip | You choose them |
| **Linked devices**: the name you give each one (for example "Kitchen tablet"), when it was linked and roughly when it was last used, and a device token (stored only as a hash) | To list and remove the devices that can send your children's practice | You link them |
| **Practice records**, one per solved lesson round: a random id, the child's profile id, the minute it happened, which activity, learning goal and round, an identifier of the exact question, whether it was a new example, first try or after a retry, the highest hint step used, lesson page or game, how the child answered (tap, key, tilt), and how long it took in broad bands (under 10 s, 30 s, 2 min, or longer) | To show progress in plain language ("practising", "got it on new examples") | The lesson page or the game, on your linked devices |
| **Last activity date** for the family | To delete families that haven't used the account for 24 months | Updated when you or a linked device use it |

### What we never collect
- No child's full name, birth date, photo, voice, school, location or contact details.
- No free text from children, no audio and no recordings. Speaking practice is never recorded.
- No IP addresses in these records, and no device fingerprints, advertising identifiers or browsing history.
- No game scores or falls: they are never learning evidence.
- Nothing from these records goes to an analytics provider. The learning endpoints send no telemetry and write no
  request contents, emails or nicknames to logs.

## 2. How we use it
Only to run the family account: sign you in, link your devices, store your children's practice and show it to you.
We do not use it for advertising, marketing, profiling, training AI models, research or anything else, and we
never sell or rent it.

## 3. Who else processes it
No third party receives it for its own purposes. It is stored and processed on **Cloudflare**, which runs the
website for us as a service provider (data processor):
- Cloudflare D1 (database `wwm-learning-records`) and Durable Objects store the records.
- Cloudflare Email Service sends the sign-in emails.
- Cloudflare Turnstile checks that sign-in requests come from a person. It sees the request and technical signals
  from your browser to do that, under Cloudflare's own terms.

`[Reviewer: confirm Cloudflare's data processing addendum covers these products, and the data location.]`

## 4. How long we keep it
- Until you delete it, or until the family account has had **no activity for 24 months**; then everything is
  deleted automatically (proposed default, plan §7).
- Sign-in links (15 minutes), pairing codes (10 minutes), sign-in challenges (5 minutes) and sessions (30 days
  after last use) are deleted when they expire.
- A deleted profile's practice records are deleted with it.
- `[Reviewer: confirm whether Cloudflare's backups, such as D1 Time Travel, keep deleted rows for a period, and
  state that period here.]`

## 5. Your choices and rights
- **See and download everything:** "Download everything (JSON)" on the family account page gives one file with your
  email, consent record, every profile, every linked device and every practice record.
- **Correct:** change a child's nickname, colour or age band on the Progress page.
- **Delete one child:** deleting a profile deletes their practice records.
- **Delete everything:** "Delete the family account" removes the account, passkeys, sessions, devices, profiles and
  practice records immediately. Practice saved in a browser stays in that browser until you delete it there.
- **Remove a device:** it stops sending practice at once.
- Questions or requests: ewjdev@gmail.com.

## 6. Children
WWM Learning is for children aged 4 to 6 **playing with a grown-up**. The parent or guardian creates the account,
gives consent at sign-up (a box confirming they are the parent or guardian and agree to this notice), and controls
everything in it. Children never enter personal information.

## 7. Security
Sign-in uses one-time email links or passkeys; there are no passwords. Every secret token is stored only as a
one-way hash. Each family's records are kept apart from every other family's and can only be reached with that
family's own sign-in or linked-device token. All traffic is encrypted (HTTPS).

## 8. Changes
If this notice changes in a way that matters, the version number changes and we ask you to agree again the next
time you sign in.

---

## Reviewer checklist
Work through each item and record the outcome (and who reviewed it, and when) in `docs/launch/` before setting
`LEARNING_ACCOUNTS` to `allowlist` for anyone outside the owner's family, or to `on`.

**Facts against the code**
- [ ] The data table in §1 matches `apps/worker/migrations-learning/0001_learning_records.sql`, `FamilyRecords`
      (`apps/worker/src/learning-records/family-records.ts`), `profileSchema` and `evidenceSchema`.
- [ ] Export (`GET /api/learning/export`) contains everything listed in §1 that is about the family (not hashes).
- [ ] Deletion (`DELETE /api/learning/family`) and the 24-month purge remove every row and the Durable Object's
      storage (`test/learning-records.integration.test.ts` checks both).
- [ ] No learning route logs bodies, emails or nicknames, and none sends telemetry (`grep -rn "console\." apps/worker/src/learning-records`).
- [ ] Decide whether game telemetry (`POST /api/t`) is turned off while a child profile is active, and confirm it
      never carries profile ids (plan §7).

**United States (COPPA)**
- [ ] Is the service "directed to children under 13"? (Yes, likely.) Persistent identifiers linked to a child count
      as personal information.
- [ ] Is a checkbox with email sign-in an acceptable verifiable parental consent method for this data? The FTC's
      "email plus" method is limited to internal uses; confirm the use here qualifies, or choose another method.
- [ ] Direct notice to parents before collection (the sign-up email or page) and the online notice (this page) have
      the required content, including the operator's name, address, phone and email.
- [ ] The 2025 amendments to the COPPA Rule: a written data retention policy (this §4), a written information
      security program, and separate consent for any disclosure to third parties (none today).
- [ ] State laws (for example California's CCPA/CPRA and age-appropriate design code) if they apply.

**EU and UK (GDPR / UK GDPR, Age Appropriate Design Code)**
- [ ] Lawful basis for each purpose (consent, or performance of the service the parent asked for), and who is the
      controller (EWJ Dev LLC) and its EU/UK representative if one is required.
- [ ] Parental consent for children under the national age of digital consent (13 to 16), and how it is verified.
- [ ] International transfers through Cloudflare (data location, SCCs / UK addendum).
- [ ] Data subject rights in §5 cover access, rectification, erasure, portability, restriction and objection, and a
      right to complain to a supervisory authority.
- [ ] UK Age Appropriate Design Code: high-privacy defaults, data minimisation, no nudges, no profiling, a DPIA.

**Operations**
- [ ] Owner setup is done (docs/launch/learning-accounts-setup.md): real Turnstile secret, sending domain with SPF,
      DKIM and DMARC, allow-list.
- [ ] A contact path for requests, and a response time, are published.
- [ ] Breach response: who is told and how fast.
- [ ] The consent wording in the account page and `CONSENT_VERSION` match the reviewed text; bump the version when
      this notice changes.
