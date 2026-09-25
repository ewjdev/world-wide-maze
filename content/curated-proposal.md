# Curated collection: proposal for approval

**Status: PROPOSAL. Nothing here is published, captured for release, or stored anywhere.** Phase 10 needs the
project owner to approve (or edit) this list before any curated run is built, stored in R2/D1 or shown in the game.

## What "curated" means here
- A curated item is a **run**: every slice of one captured page, played in order (contracts §3). The game's select
  screen shows it with **difficulty stars** (Phase 09's solver, 1–5; E: 2013's "Popular sites" had stars).
- Curated runs are **prebuilt and kept**: exempt from the 30-day retention sweep, playable even if live capture is
  down, and exportable as an offline pack (`stage.json` + texture per slice). That is the preservation goal.
- Every curated stage shows the site's name and URL and links to it, and the page credits the source licence.
- What we republish is a **screenshot of the page** (as the island texture) plus geometry derived from it. For a
  licensed page that is an adaptation, so attribution (and share-alike, where the licence says so) applies to the
  texture. Where nothing clearly permits that, we need the owner's permission first.

## Selection criteria
1. **Permission first:** the owner's explicit permission, or a clearly permissive licence (public domain, OGL,
   CC BY / CC BY-SA), or our own pages.
2. **A good maze:** distinct blocks with background between them (cards, lists, sections), not one wall of text;
   recognisable at a glance; a mix of light and dark, sparse and dense, short and long (multi-slice) pages.
3. **Stable:** the page shouldn't change daily (the capture is frozen anyway, but a recognisable page ages better).
4. **Low risk:** no personal data, no user-generated content we can't vouch for, no third-party ads or photos
   under unclear rights, no logos used in a way that suggests endorsement.

Risk flags: **L** low, **M** medium (a condition to meet), **H** high (don't use without explicit permission).
"Checked" notes were verified on 2026-09-25 by fetching the page or its terms; everything else must be re-checked
by a person before release. This is not legal advice.

## Candidates (16; pick at least 12)

| # | Site / page | URL | Why it makes a good maze | Licence / permission | Risk |
|---|---|---|---|---|---|
| 1 | GOV.UK home page | https://www.gov.uk/ | Card grid with clear section bands; already a fixture that builds cleanly (4550 px, 3 slices) and reads instantly as GOV.UK | Open Government Licence v3.0 (checked: linked from the site's terms). Crown copyright; the OGL excludes logos and the crown/royal arms, so the **GOV.UK crown logo in the header** must be masked or the header dropped | M |
| 2 | Wikipedia: "Maze" | https://en.wikipedia.org/wiki/Maze | On-theme; infobox, images and headed sections make varied islands; long page = a multi-stage run | Text CC BY-SA 4.0: attribution + share-alike on the texture. Each **image** has its own licence on Commons; check the ones in the capture or hide images | M |
| 3 | Wikipedia: "Labyrinth" | https://en.wikipedia.org/wiki/Labyrinth | Already a fixture (6000 px, 4 slices); a long, classic run | As #2 | M |
| 4 | web.dev: "Case Study – Inside World Wide Maze" (Saqoosha) | https://web.dev/case-studies/world-wide-maze | The ultimate homage: the original's own technical story becomes a maze. Diagrams make good islands | Content CC BY 4.0, code samples Apache 2.0 (checked: page footer). Page has Google/web.dev branding in the chrome; **ask Saqoosha as a courtesy** and crop the header | M |
| 5 | KAISOKU TOKYO homepage | http://kaisokutokyo.com/ | The label said the band's homepage was redesigned to work well as a maze in 2013 (research). A loving callback if the current design still suits | **Needs the band's / label's permission** (artist site, photos, logo). Site is live (checked: title "快速東京 \| Kaisoku Tokyo"); today's design may differ from 2013 | H until permission |
| 6 | AID-DCC news page | https://aid-dcc.com/news/ | The page Saqoosha used to demonstrate the 2013 builder ("the News section of aid-dcc.com") | **Needs AID-DCC's permission.** Site is live (checked) | H until permission |
| 7 | This tribute's own History page | /about (our site) | Our own content: credits and timeline, cards and tables; a self-referential "maze of the maze's history" | Ours. Needs a deployed URL (or capture it from the dev server). No third-party assets | L |
| 8 | This tribute's own Build record | /log (our site) | Very long, text-heavy: a hard, many-slice run. Shows the build record in-game | Ours | L |
| 9 | example.com | https://example.com/ | Tiny and sparse (1 slice, a handful of islands): the gentle **practice stage**, like 2013's "Practice site" (google.com) | IANA reserved example domain, no creative content | L |
| 10 | Chromium Projects home | https://www.chromium.org/chromium-projects/ | Chrome Experiments were about showing off the browser; this is its open-source home. Clear sections and links | Content under a Creative Commons Attribution 2.5 licence (checked: page footer). Chromium logo: trademark guidelines apply; keep it as page content, not branding for us | M |
| 11 | MDN: "DeviceOrientationEvent" | https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent | On-theme (the API tilt control uses); dark-theme capture gives a night stage | Content CC BY-SA 2.5 by Mozilla contributors. **MDN shows third-party ads** (the mdn-dark-docs fixture captured two): must be removed/masked before release | M |
| 12 | MDN: "WebSocket" | https://developer.mozilla.org/en-US/docs/Web/API/WebSocket | The other half of the 2013 tech story (phone → PC). Light theme for contrast with #11 | As #11 | M |
| 13 | web.dev home | https://web.dev/ | Bright card grid: a friendly, easy stage | CC BY 4.0 for content (Google developer sites policy; re-check the home page footer). Heavy Google branding | M |
| 14 | USA.gov home | https://www.usa.gov/ | Card grid similar to GOV.UK but a different look; good "easy" stage | US federal government works are generally public domain; **check usa.gov's own policy** for third-party images/logos (not verified) | M |
| 15 | Wikimedia Commons: Picture of the day | https://commons.wikimedia.org/wiki/Commons:Picture_of_the_day | Image-heavy, colourful islands (already a fixture) | Each image has its own free licence (CC/PD): attribution per image. **Changes daily**, so the frozen capture needs a dated credit | M |
| 16 | The project owner's own site | (owner to supply) | A personal page is what made 2013's game personal ("choose your own site") | Owner's own content | L |

Not proposed, and why:
- **Commercial news sites:** news photos and text belong to the publisher and its agencies. The one internal
  news-site test fixture was never curated or shown publicly, and was removed before publication.
- **Hacker News** (`hn-front` fixture): user-submitted titles under Y Combinator's terms; keep it as a test fixture.
- **google.com** (2013's practice site): Google branding and terms; we are not affiliated with Google.
- Any page with personal data, logins, or photos of people we can't clear.

## Suggested first 12 (if the owner agrees)
Low-risk and on-theme first: **7, 8, 9, 1, 2, 3, 4, 10, 11, 12, 13, 15**, plus 5 and 6 if the permissions come
through (a message to KAISOKU TOKYO's label and to AID-DCC would also be a nice way to tell them about the tribute).

## Before any of these ship (checklist)
- [ ] Owner approves the list (edit this file or `content/curated.json`).
- [ ] Permission emails for #5, #6 (and #4 as a courtesy) sent and answered. Nothing is sent by the agents.
- [ ] Re-capture at DPR 2 (polish backlog) with ads/logos masked where noted.
- [ ] Build each run, check it in `/making`, solve it with Phase 09 (stars), and play it once.
- [ ] Credits line per stage: site name, URL, licence, "captured on <date>".
- [ ] Render the share cards and insert the `curated` rows (see `content/README.md`).

## Rights of the original game (for the record)
No 2013 art, audio, logos or code is used anywhere in the rebuild (see `/about`). If the owner ever wants the
original title logo or music on `/about`, that needs the rights holders' permission first.
