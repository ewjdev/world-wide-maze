# Legal drafts — reviewer guide

> **DRAFT — not legal advice. Prepared as a starting point for review.**
>
> None of these documents is published or linked from the site. They were filled in by an agent at the owner's
> request ("fill in the legal drafts with good placeholders") from the code, `plans/contracts.md` (§10.3),
> `plans/phase-14-mazify-extension.md`, `plans/phase-15-ai-docent.md`, `apps/worker/README.md`,
> `docs/launch/runbook.md` and `content/curated.json`. The operator and a lawyer must review them before use.

| File | Purpose |
|---|---|
| [privacy.md](privacy.md) | Privacy notice: what's collected, where, for how long, processors, rights, children |
| [terms.md](terms.md) | Terms of use |
| [takedown.md](takedown.md) | Part A: public takedown, copyright (DMCA-style) and site-owner opt-out page. Part B: internal operator procedure (not for publication) |
| [tribute-disclaimer.md](tribute-disclaimer.md) | Short (footer) and long (about/terms) non-affiliation text |

## 1. Placeholders
| Placeholder | Meaning | Used in |
|---|---|---|
| `{{OPERATOR_NAME}}` | Legal name of the person or entity running the site (data controller; copyright agent) | all four |
| `{{CONTACT_EMAIL}}` | One address for privacy, removal, opt-out and copyright notices | all four |
| `{{DOMAIN}}` | The production domain (not yet chosen) | all four |
| `{{JURISDICTION}}` | Governing law/courts and the operator's country | privacy, terms, takedown |
| `{{EFFECTIVE_DATE}}` | Effective / last-updated date | privacy, terms, takedown |
| `{{POSTAL_ADDRESS}}` | Postal address (privacy controller identity; required for a US DMCA agent registration) | privacy, takedown |
| `{{REPO_URL}}` | Public source repository | terms |
| `{{CODE_LICENSE}}` | Licence of the project's own code — **the repo has no LICENSE file yet** | terms |

Find any left over with `grep -rn '{{' docs/launch/legal-drafts`.

## 2. Default decisions made in these drafts (please check each)
Marked **[code]** where the current code already does this, **[follow-up]** where the draft promises something the
code doesn't do yet (it must be built or the text changed before publishing), and **[planned]** where it
describes a Phase 14/15 feature that isn't merged yet (re-check against the code when it lands).

**Data and retention**
1. No accounts, no cookies, no ads/analytics/third-party scripts; settings in `localStorage` only. **[code]**
2. User-URL mazes (captures, textures, stages, D1 rows) unlisted and deleted after 30 days; featured stages
   exempt. KV URL cache 7 days. **[code]**
3. Leaderboard entries (`scores`, `run_scores`) and replays deleted after **12 months**. **[follow-up]** — the
   retention cron currently only deletes runs.
4. `ip_hash` (daily-salted HMAC) erased from leaderboard entries after **30 days**. **[follow-up]** — the column is
   `NOT NULL`, so clearing means writing `''`, or a migration.
5. Workers Logs retention 7 days (Cloudflare default, per runbook). **[code/config]**
6. Pairing rooms deleted 30 minutes after both devices disconnect; messages relayed, not stored. **[code, per the
   previous draft]**
7. Rate-limit records keyed by IP (IPv6 /64), self-deleting after the window. **[code]**
8. Telemetry **off**; described as it would work if enabled (random per-load id, no IPs, DNT/GPC honoured); the
   notice must change before it is enabled. **[code]**
9. Privacy requests answered within 30 days.

**AI docent** **[planned]**
10. What's sent to Anthropic via Cloudflare AI Gateway: question (≤ 500 chars), ≤ 6 prior turns, retrieved corpus
    excerpts, system prompt. No IP or identifier sent.
11. Q&A cached in KV for **30 days** (the phase plan doesn't set a TTL — **[follow-up]**).
12. Logs hold token counts and cache hits, not question text. **[follow-up]** — enforce in Phase 15.
13. **AI Gateway request logging switched off** for the gateway. **[follow-up]** — a dashboard setting; the default
    is on.
14. Per-IP rate limit and global daily cap; questions not used to identify anyone.

**Extension / bookmarklet / portals** **[planned]**
15. Local capture only; upload only on **Share**; shared captures unlisted and deleted after 30 days like other
    runs. `activeTab` + `scripting` permissions only.
16. Shares of opted-out domains refused on upload. **[follow-up]** — Phase 14 must run the opt-out check on
    `POST /api/stages/upload` (the page's original URL is in the bundle).
17. Portal travel builds the linked URL like a typed URL (same policy, opt-out, limits).

**Takedown / opt-out**
18. Response targets: acknowledge in 3 business days, act within 7 days; personal data / illegal / dangerous
    content acknowledged in 1 business day and handled within 2.
19. Domain opt-out by email from the domain or a DNS TXT token `wwm-optout=<token>`; covers subdomains; also
    deletes featured stages; permanent until lifted. **[code: KV `optout:` check]**
20. Capture browser user agent includes a `WorldWideMaze` token + link to `/about`. **[follow-up]** — today it
    uses Browser Rendering's default UA.
21. Honour `robots.txt` rules naming `User-agent: WorldWideMaze`, but not generic `*` rules (argued as a one-off
    user-initiated fetch like a link preview). **[follow-up]** — not implemented. This is a policy choice the owner
    may prefer to make stricter (honour `*` too).
22. DMCA §512(c)(3) notice elements and a counter-notice process; no restoration after counter-notice by default
    since shares expire in 30 days; repeat-infringer blocking by address/domain.
23. Ticket records kept 2 years (internal).

**Terms**
24. Not directed at under-13s; minors with parental permission.
25. Limited licence from sharers to host/display a shared capture until it's deleted.
26. As-is, no warranty; liability excluded/limited to zero with a consumer-law carve-out.
27. Featured CC BY-SA stages: the screenshot texture offered under the same licence, with attribution in game and
    on `/about`. **[follow-up]** — confirm the game/about actually shows per-stage source + licence.
28. Leaderboard moderation after the fact; implausible/automated scores removable without notice.

**Disclaimer**
29. Non-affiliation with Google LLC, Google Japan, PARTY and the original creators; none of the original's
    code/art/audio/logos used; "Google" and "Chrome" trademarks of Google LLC; name used only to identify the
    original; invitation to rights holders to request changes.
30. The footer links to `/privacy`, `/terms`, `/takedown`; these routes don't exist yet.

## 3. Open questions for a lawyer
1. **Screenshots of third-party sites.** Is showing a user-requested, unlisted, 30-day screenshot of a public page
   as a game surface defensible (fair use in the US: transformative use; the "pastiche"/quotation exceptions in the
   EU/UK; Japan's Copyright Act Art. 30-4/47-5)? Does the answer change for **shared extension captures** of
   logged-in pages, and for **featured** stages kept indefinitely?
2. **CC BY-SA share-alike** (Wikipedia `wiki-maze`, `wiki-labyrinth`; MDN pages under CC BY-SA 2.5). Is the stage
   texture/level an "adapted material" that must be released under CC BY-SA? Does that reach the stage JSON or the
   game code (we think not, but please confirm)? Is the attribution format sufficient? Same for CC BY 4.0
   (web.dev), OGL v3.0 (GOV.UK — note its exclusions for logos/crests and third-party material), Chromium's
   footer licence, and per-image licences on Wikimedia Commons' Picture of the day (which changes daily).
3. **Trademark / name.** Is using "World Wide Maze" in the product name and domain acceptable with the disclaimer,
   or should the name change (e.g. "WWM Revival", "a tribute to World Wide Maze")? Showing third-party logos
   visible in screenshots?
4. **GDPR / UK GDPR for EU/UK visitors.** Is legitimate interest the right basis for the IP hash, logs, rate
   limiting and docent? Is the daily-salted HMAC personal data (probably pseudonymous, so yes)? Is a DPIA,
   an Art. 27 EU/UK representative, or a record of processing needed for a non-commercial hobby project? Does
   `localStorage` use need consent under ePrivacy/PECR, or is it "strictly necessary"? Is the international-transfer
   wording adequate (Cloudflare and Anthropic DPAs/SCCs; is an Anthropic DPA in place for this API account)?
5. **Children / COPPA.** Is "not directed at under-13s" defensible for a game with a playful visual style? Is a
   free-text leaderboard nickname "personal information" under COPPA? Age of digital consent in the EU (13–16).
6. **DMCA safe harbour.** Register a designated agent with the US Copyright Office (requires a postal address,
   fee, renewal every 3 years)? Does the safe harbour apply to server-side captures the operator's system makes on
   a user's request, versus user uploads? Equivalents: EU DSA notice-and-action (Art. 16) and point-of-contact
   duties, UK Online Safety Act applicability to a service with user-shared content.
7. **Robots.txt / scraping.** Is ignoring generic `User-agent: *` for one-off user-initiated captures acceptable
   in the operator's jurisdiction, and should site terms of service that forbid automated access be honoured?
   Any database-right issues (EU sui generis) from extracting page layout?
8. **AI docent.** Is describing Anthropic as a processor accurate under its commercial terms, and what does it
   retain and for how long? Any AI-specific disclosure duties (EU AI Act Art. 50 transparency: telling users they
   are interacting with an AI)?
9. **Liability limitation** to zero for a free service — enforceable under {{JURISDICTION}} consumer law?
10. **California (CCPA/CPRA)** and other US state laws — likely below thresholds for a non-commercial project;
    confirm whether any notice section is still advisable.
11. **Public leaderboard ghosts.** Are input recordings personal data when tied to a public nickname, and is 12
    months proportionate?
12. **Operator identity.** Must the notices name a natural person and postal address (e.g. German-style
    Impressum if targeting DE, Japanese Act on Specified Commercial Transactions — likely N/A as non-commercial)?
