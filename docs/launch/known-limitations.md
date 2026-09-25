# Known limitations (draft for the `/about` page)

> Draft text for Phase 10's `/about` (the G4 checklist requires known limitations to be published there). Not yet
> on the site; the orchestrator/Phase 10 mounts it after the user approves the wording.

- **Any website, within limits.** Pages behind logins, paywalls or bot checks can't be captured; very long pages
  are cut at 6,000 px (up to four stages). Pages that need Web Workers or WebSockets to render may look
  incomplete, because the capture browser switches those off for safety.
- **Your maze expires.** Mazes built from addresses you enter are unlisted and deleted after 30 days. Featured
  stages stay.
- **Phone control needs a phone browser with motion sensors** and permission to use them. Tested on an iPhone 17
  Pro (Safari); Android Chrome hasn't been tested on a real device yet. The keyboard (arrow keys, space, M) always
  works.
- **Graphics need WebGPU or WebGL 2.** Measured at 60 fps on an Apple M5 Max; lower-end machines weren't tested
  on real hardware — the game lowers its quality automatically when frames get slow.
- **Latency.** Phone-to-screen motion goes through a relay near you (Cloudflare); we measured ~23 ms median
  relay round trip in tests but haven't filmed end-to-end latency on many networks yet.
- **Leaderboards** also accept scores without a verified replay (stored as unverified) and are moderated after the fact.
- **Not the original.** Rules and numbers are reconstructed from public evidence; visuals, sound and code are new.
  Nothing from the 2013 site is reused.
