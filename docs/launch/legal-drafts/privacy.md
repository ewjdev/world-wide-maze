# Privacy notice — World Wide Maze (revival)

> **DRAFT — not legal advice. Prepared as a starting point for review.**
>
> Not published and not linked from the site. Written by an agent from the code and plans at the commit this file
> was changed in; a lawyer and the operator must review it before use. Defaults chosen for this draft, and
> behaviour that is planned but not yet built, are listed in [README.md](README.md). If the code changes, re-check
> every factual statement below.

| Placeholder | Meaning |
|---|---|
| `{{OPERATOR_NAME}}` | Legal name of the person or entity running the site (the data controller) |
| `{{POSTAL_ADDRESS}}` | Contact postal address for the operator |
| `{{CONTACT_EMAIL}}` | Address for privacy, removal and takedown requests |
| `wwm.ewj.dev` | The site's domain |
| `{{JURISDICTION}}` | Country/state whose law governs, and where the operator is based |
| `{{EFFECTIVE_DATE}}` | Date this notice takes effect / was last updated |

---

**World Wide Maze (revival)** at `https://wwm.ewj.dev` is run by {{OPERATOR_NAME}}, {{POSTAL_ADDRESS}}
({{JURISDICTION}}). Contact: {{CONTACT_EMAIL}}.
Effective: {{EFFECTIVE_DATE}}.

## The short version
- **No accounts, no ads, no analytics trackers, no third-party scripts, and no cookies.** The game remembers your
  settings in your own browser's local storage; that data isn't sent to us.
- When you turn a website into a maze, our server takes a screenshot of that **public** page. The screenshot and
  the maze are **unlisted** (only people with the link can open them) and are **deleted after 30 days**.
- If you put a name on a leaderboard, the name, your score and a recording of your ball's movements are **public**
  and kept for **12 months**. Use a nickname, not your real name.
- We never store your IP address as such. For abuse prevention we keep a keyed, daily-changing, one-way hash of it
  next to leaderboard entries, and short-lived rate-limit counters are keyed by it.
- Questions you ask the "Ask about the original" assistant are sent, with excerpts from our own documentation, to
  an AI model provider (Anthropic) through Cloudflare. Don't put personal information in them.
- Usage statistics ("telemetry") are **off**. If we ever turn them on, they will be anonymous and this notice will
  change first.

## 1. What happens when you play
| What | Where it's kept | How long | Why |
|---|---|---|---|
| Game settings (language, control sensitivity, mute, "seen the tutorial", this device's own high scores) | Your browser's local storage only | Until you clear site data | So the game remembers your choices. Never sent to us |
| Pairing room (a 6-digit code; phone ↔ computer messages such as tilt, button presses and game state) | A Cloudflare Durable Object (a small server-side process) | Deleted 30 minutes after both devices disconnect | To relay your phone's tilt to the game screen. Messages are passed through, not saved |
| Motion-sensor readings on your phone | Your phone; forwarded live to your own game session | Not stored | Tilt controls. Your browser asks for permission first; you can always use the keyboard instead |
| Server logs (time, request path, status code, a request id, error codes; for maze builds, the web address you entered) | Cloudflare Workers Logs | 7 days | Keeping the service running and investigating abuse |

Cloudflare, which runs our servers, also processes network-level data (such as IP addresses and request
headers) to deliver the site and protect it from attacks. It does this under its own policies; see §8.

## 2. When you turn a website into a maze
- You give us a web address. Our server opens it in a headless browser run by Cloudflare (Browser Rendering),
  takes a screenshot and records the positions of the page's text, images and links. It does not log in, fill in
  forms or keep any cookies the site sets. The website sees a request from Cloudflare's network, not from your
  device.
- We store the screenshot, the page layout data, the page's title and address, and the generated maze in
  Cloudflare R2 (file storage) and D1 (database). A cache entry mapping the address to the maze is kept in
  Cloudflare KV for 7 days so the same page isn't captured over and over.
- Mazes built from addresses players enter are **unlisted** and **deleted automatically 30 days** after they were
  built. The only exceptions are the featured stages that we choose and list on the site.
- We don't record who asked for a maze. To prevent abuse we count build requests per IP address (for IPv6, per
  /64 network): the counter holds only the times of your recent requests and deletes itself when the time window
  has passed (one hour for builds).
- **Link portals.** Some mazes contain portals made from links on the page. If you choose to travel through one,
  that link's address is turned into a maze exactly as if you had typed it in.
- **Website owners** can ask us not to use their site and to remove existing mazes; see the
  [takedown and opt-out page](takedown.md).

## 3. "Maze this page" (browser extension and bookmarklet)
- The extension and bookmarklet capture the page you are looking at **inside your own browser** and build the maze
  there. **Nothing is uploaded unless you press Share.**
- The extension asks only for access to the tab you click it on (`activeTab`) when you click it; it does not read
  your browsing in the background.
- **If you press Share**, the screenshot and page layout are uploaded to us and treated like any other built maze:
  unlisted, reachable only by its link, and deleted after 30 days. Because the extension can capture pages you are
  logged into, **check what's on screen before you share** — anything visible in the screenshot (your name,
  messages, account details) becomes visible to anyone you give the link to.

## 4. Leaderboards
- If you enter a name after a game, we store the name (letters, digits and `_`), your score, time, the date and,
  for stage scores, the recording of your inputs (tilt and button samples). We use the recording to check the
  score and to show other players a "ghost" of your run. All of this is **shown publicly**.
- We also store `ip_hash`: an HMAC-SHA-256 of your IP address with a secret key and the current date, shortened.
  It changes every day and can't be turned back into your IP address without our secret key. We use it only to
  spot and clean up abuse (for example, many fake scores from one source on one day). It is erased from the entry
  after 30 days.
- **Retention:** leaderboard entries and their recordings are deleted **12 months** after they were submitted.
  You can ask us to remove an entry sooner at {{CONTACT_EMAIL}}; send its name, score and date or a link to the
  stage.

## 5. The "Ask about the original" assistant (AI docent)
- On the About and Build log pages you can ask questions about the 2013 original and how this rebuild was made.
  The assistant answers only from this project's own research and build notes.
- **What's sent:** your question (up to 500 characters), up to six earlier messages from the same conversation,
  excerpts from our own documents, and our instructions to the model. These go from our server through
  **Cloudflare AI Gateway** to **Anthropic**, which provides the AI model. No IP address, name or other identifier
  of yours is included in what we send to Anthropic.
- **What's kept:** the question (in a normalized form) and the answer are cached in Cloudflare KV for up to
  **30 days**, so the same question can be answered again without another model call. Our logs record token
  counts and whether the cache was used, not the text of your question. Cloudflare AI Gateway's own request
  logging is switched off for this project. Anthropic handles the data it receives under its own terms (see §8).
- We count questions per IP address for a short period to stop abuse, and we don't use questions to identify
  anyone. **Please don't include personal information in a question.**

## 6. Usage statistics (telemetry) — off
Telemetry is switched off. If we turn it on in future, we will update this notice first, and it will work like
this: anonymous game-progress events (reached the title screen, paired a phone, started, finished, a build failed
with an error code, and script errors with web addresses removed), grouped by a random id that is created for each
page load and never saved in your browser. No names, scores, room codes, page addresses or IP addresses are sent.
Events go to Workers Logs (7 days). Browsers that send Do Not Track or Global Privacy Control send nothing.

## 7. Cookies and similar technology
We don't set cookies. The game uses your browser's local storage only for the settings in §1, which are needed
for the features you use and never leave your device. There are no advertising, analytics or social-media
trackers, and fonts and game assets are served from `wwm.ewj.dev` itself.

## 8. Service providers
We use these providers to run the service. They process data on our behalf, for the purposes described here.

| Provider | What it does for us | What it receives |
|---|---|---|
| **Cloudflare, Inc.** — Workers, static hosting, Durable Objects, Workers Logs | Hosts the site and API, relays phone ↔ screen messages, keeps logs | All requests to the site, including IP addresses and request headers; pairing messages; the log fields in §1 |
| **Cloudflare** — Browser Rendering | Opens pages in a headless browser and takes screenshots | The web address you enter (not your IP address or identity) |
| **Cloudflare** — R2, D1, KV | Stores mazes, screenshots, leaderboard entries, cache entries and rate-limit data | The data in §§2–5 |
| **Cloudflare** — AI Gateway | Routes docent questions to the model provider, enforces limits | The docent request in §5 |
| **Anthropic, PBC** | Provides the AI model that writes docent answers | The docent request in §5 (question, recent conversation, excerpts from our documents, instructions) |

Cloudflare's privacy policy and data processing terms: `https://www.cloudflare.com/privacypolicy/` and
`https://www.cloudflare.com/cloudflare-customer-dpa/`. Anthropic's privacy policy and commercial terms:
`https://www.anthropic.com/legal/privacy` and `https://www.anthropic.com/legal/commercial-terms`.
These providers operate internationally, so data may be processed outside your country.

We don't sell or share personal information for advertising, and we don't use any of it for profiling.

## 9. Your choices and rights
- You can play without entering a leaderboard name, without pairing a phone (keyboard controls), and without
  using the assistant.
- You can clear the game's local data at any time in your browser's site settings.
- You can ask us to access, correct or delete data relating to you — for example a leaderboard entry or a
  maze you shared — or object to how we use it, by writing to {{CONTACT_EMAIL}}. We will reply within 30 days.
  Because we don't have accounts, we may ask for details (such as a link, name, score and date) to find the data;
  we can't link data to you by IP address, since we don't keep it.
- Depending on where you live (for example the EU, UK or California), you may have further rights under local
  law, including the right to complain to your data protection authority.
- Where the law requires a legal basis, we rely on our legitimate interest in running a free game and keeping it
  safe from abuse, and, for motion sensors, on the permission you give in your browser.

## 10. Children
The game is suitable for all ages, but it is not directed at children under 13, and we don't knowingly collect
personal information from them. It asks for no personal information: the only thing you can type in is a
leaderboard nickname (which should not be a real name) and questions to the assistant. If you believe a child has
put personal information on a leaderboard or in a shared maze, write to {{CONTACT_EMAIL}} and we will delete it.

## 11. Security
Data is sent over HTTPS. The IP hash uses a secret key held as an encrypted server secret. Our capture browser is
isolated from our own systems and can only reach public web addresses.

## 12. Changes
If we change this notice, we will update the effective date above. If a change affects how we use existing data
(for example, turning telemetry on), we will say so on the site before it takes effect.
