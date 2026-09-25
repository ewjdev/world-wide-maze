# DRAFT — REQUIRES USER REVIEW — Privacy notice

> **Status: draft written by the Phase 12 agent, not reviewed by the operator or a lawyer. Not published and not
> linked from the site.** Items in `[brackets]` must be filled in. Every factual statement below was checked
> against the code at the commit this file was added in; if the code changes, re-check it.

**World Wide Maze (revival)** · operated by [OPERATOR NAME], [COUNTRY] · contact: [CONTACT EMAIL]
Last updated: [DATE]

## The short version
- We don't use cookies, ads, analytics trackers or third-party scripts.
- When you turn a website into a maze, we take a screenshot of that **public** page and keep it (and the maze made
  from it) for 30 days, unless it becomes a featured stage.
- If you put your name on a leaderboard, that name, your score and a recording of your ball's inputs are public.
- We don't store your IP address with anything you create. For abuse prevention we store a keyed, daily-changing
  hash of it next to leaderboard entries, and rate-limit counters are addressed by it (see below).

## What happens when you play
| What | Where | Kept for | Why |
|---|---|---|---|
| Game settings (language, sensitivity, "seen the tutorial", local high scores) | Your browser's `localStorage` only | Until you clear site data | So the game remembers your choices. Never sent to us |
| Pairing room (6-digit code, phone ↔ computer messages: tilt, buttons, game state) | A Cloudflare Durable Object | Deleted 30 minutes after both devices disconnect | Relays your phone's tilt to the game. Messages are passed through, not stored |
| Motion sensor readings on your phone | Your phone; forwarded live to your own game session | Not stored | Tilt controls. Your browser asks for permission first |
| Server logs (request path, time, status, a request id; for builds, the page address you entered) | Cloudflare Workers Logs | 7 days | Keeping the service running, investigating abuse |

## When you build a maze from a website
- You give us a public web address. Our server opens it in a headless browser (Cloudflare Browser Run), takes a
  screenshot and reads the positions of the page's text, images and links. It does not log in, submit forms or run
  the page's background connections.
- We store: the screenshot, the page layout data, the page title and address, and the generated maze stages
  (Cloudflare R2 and D1). Mazes from addresses players enter are **unlisted**: they can only be reached by their
  link. They are deleted automatically after **30 days** unless the operator features them. A cache entry that maps
  the address to the maze expires after 7 days.
- We don't record who asked for a maze. Rate limits (10 builds per hour, 20 score submissions per 10 minutes) are
  counted in a Durable Object addressed by your IP address (IPv6: its /64 prefix); it holds only the timestamps of
  your recent requests. The object deletes itself once its window has passed (one hour for builds).
- **Website owners** can opt out; see [takedown.md](takedown.md).

## Leaderboards
If you enter a name after a game: the name (letters, digits and `_`), your score, time, the date, and — for stage
scores — the recording of your inputs (tilt/button samples, used to check the score and to show a "ghost" run to
other players) are stored in Cloudflare D1/R2 and **shown publicly**. Don't use your real name if you don't want
it public. We also store `ip_hash`: an HMAC-SHA-256 of your IP address with a secret key and the date, truncated.
It changes every day, can't be reversed without the key, and is used only to limit and clean up abuse.
**Retention: [DECIDE — currently kept until removed; suggested: 12 months].** Ask us to remove an entry at
[CONTACT EMAIL].

## Telemetry
Off at launch. [If the operator enables it: anonymous game-funnel events (reached the title screen, paired a
phone, started, finished, build failed with error code X, and uncaught script errors with web addresses removed),
grouped by a random id that is created per page load and never stored in your browser. No names, scores, room
codes, page addresses or IPs. Written to Workers Logs (7 days). Browsers sending Do Not Track or Global Privacy
Control send nothing.]

## Service providers
Everything runs on **Cloudflare** (Workers, Durable Objects, Browser Run, R2, D1, KV, Workers Logs), which processes
data on our behalf: [link to Cloudflare's DPA / privacy policy]. Fonts and all game assets are served from our own
domain.

## Your rights
[Jurisdiction-specific text — e.g. GDPR/UK GDPR access, deletion, objection; the lawful basis is legitimate
interest in running the game and preventing abuse. Contact: [CONTACT EMAIL].]

## Children
[Decide an age statement.] The game doesn't ask for personal data; leaderboard names should not be real names.
