# UX flow and screen list (from the 2013 localization + templates)

Sources:
- `reference/original/translation-en.json` (2013-03-22, 100 keys) and `translation-ja.json` (2013-08-28, the same 100 keys)
- the `libs/text!templates/*.html` modules in `desktop-main.js`
- the page and FSM code in `app/app` and `game/world` (see [bundle-notes.md](bundle-notes.md))

The localized strings are short UI text, quoted for specification. This is Phase 08's screen list. Keys are shown as `key.path`, and `__X__` placeholders are button glyphs.

Legend: **E** = evidenced (string or code exists), **R** = reconstructed (inferred), **N** = new in our rebuild.

## Screen order (desktop)

| # | Screen (2013 state) | Content / strings | Transitions | Label |
|---|---|---|---|---|
| 0 | **Preload** (`LOADING`) | Logo image and loader gif. At least 3 s of asset loading | → title / preview / input-number / non-display | E |
| 0a | **Unsupported** (`NON_DISPLAY`, `pc/not-supported/`) | `nondisplay.descChrome` (not Chrome: "click here" to try anyway). `nondisplay.notsupported.pc` (no WebGL/Worker/WebSocket: redirected by the entry HTML). Chrome download banner `nondisplay.download.*` | continue → title | E |
| 1 | **Title** (`TITLE`) | `title.caption`: "Turn favorite website into a 3D maze. Play now with your PC and mobile phone". Start button. A 3D logo and PC/phone model animate behind it. The footer has requirements, terms, privacy, a language switch (English/日本語), and share buttons (`tweet.site`) | start → how-to (first visit), connect, or stage select (already paired) | E |
| 2 | **How to** (`HOWTO`, first visit only) | `howto.step1`–`step4`: "Connect Chrome on Mobile to Chrome on your PC", "Choose a site to play", "Site transforms into a 3D maze", "Use your phone to control the ball and find the goal". Skip button | skip → connect | E |
| 3 | **Connect** (`CONNECT`) | Title `connect.title` ("Connect to World Wide Maze / __NUMBER__", the 6-digit code). `connect.select.pc`. Tip `connect.devicelock` ("Lock smartphone to portrait orientation"). Three methods: `connect.method.tabsync`, `.qr`, `.url`. `connect.play-pc` ("No smartphone? Play with PC only") | method sub-steps (below) · PC-only → stage select · paired → connected | E |
| 3a | Connect · Tab Sync | `connect.login.pc` (sign in on both devices, open "Other devices"), `connect.tabsync` (link to the help page), `connect.selectanother` | back | E (we replace Tab Sync, see below) |
| 3b | Connect · QR | `connect.readqr` + QR code, `connect.selectanother` | back | E |
| 3c | Connect · URL + code | `connect.access.pc` ("Access next URL on your mobile phone, and enter the code below."). Shows URL `g.co/maze` and CODE. `connect.sendurl` (email link) | back | E |
| 3d | **Input number** (`INPUT_NUMBER`, `/maze/connect`) | Pairing started from the phone: `connect.mobilenmuber` ("Enter six-digit code displayed on your phone"). An invalid code shows an alert with the same string. Phone-side counterpart: `connect.pcnumber` | input → connected | E |
| 4 | **Connected** (`CONNECTED`) | `connected` ("Connected!"). "connected" SE. Auto-advances after **4 s** | → stage select (or → game if a preview was pending) | E |
| 5 | **Stage select** (`STAGE_SELECT`) | `search.title` ("Search for a site to transform into a 3D maze."), `search.placeholder`, `search.tip` ("*Please note that some sites cannot be transformed."). `search.tutorial` ("Practice site" = google.com). `search.recommended` ("Popular sites", with difficulty stars). Results come from web search with "more" paging. The phone can type the query and pick a result | selected(url) → building | E |
| 6 | **Building** (`BUILDING`) | `building.pc`: "Transforming...<br> Control the ball with your mobile phone and head towards the goal to complete each stage. Gain points by collecting items along the way. Get to the goal with time to spare for bonus points. Compete for points against players around the world!" Phone shows `building.mobile` ("Look at PC"). Shown for at least 5 s | built → game · failure/30 s timeout → builds the "not available" page instead | E |
| 7 | **Game: intro** (`OPENING`) | Camera fly-over and the page folds down into islands (about 17 s), then the ball drops in inside a cage (3 s) | → play | E |
| 8 | **Game: calibration** (tutorial step 1, first game only) | `tutorial.mobile.step1`: "Tilting the phone, match dots on bottom left of screen". A ring with 3 coloured dots appears at bottom-left. **15 s timeout** | zero → step 2 · timeout → keyboard fallback (step 7) | E |
| 9 | **Game: tutorial** | `tutorial.mobile.step2` "This is your starting position." (3 s) · `step3` "Press and hold __POWER__ and tilt phone to control the ball" (timer starts on the first POWER) · `step4` "Press __JUMP__ on phone to jump" · `step5` "Press __MENU__ on top of phone to view map" · `step6` "Now head for the goal!" (3 s each) · `step7` (fallback) "If you have difficulties controlling with the mobile phone, you can also play with the __ARROW_KEY__ and __SPACE_KEY__." PC-only variant: `tutorial.pc.step3` "Control the ball with the arrow keys __ARROW_KEY__", `step4` "Hit space bar __SPACE_KEY__ to jump", `step5` "Press __M_KEY__ to view map.", `step6` | → play | E |
| 10 | **Game: play** (`GAME`) | HUD: TIME (counts down from 300) and score top-left, LIFE (3 spare-ball icons) top-right, orientation indicator and MENU button bottom-left. `game.tootilted` ("Too tilted!") warning. Last 30 s: caution SE and faster BGM | goal / fall / time-up / pause | E |
| 11 | **Game: map/pause** (`PAUSE`, MENU or M, or window blur) | Orbiting overview of the whole stage with a "YOU" marker. Buttons: search (another site), quit, back. Quit and search ask `game.confirm` ("Do you really want to leave this stage?"), which the template labels "Really?", with yes/no | back → play · search → stage select · quit → title | E |
| 12 | **Game: fall** (`FALLING`) | Falling BGM/SE, the ball sinks and makes a ripple. After 3 s: respawn at the nearest restart point, or game over | → restarting / game over | E |
| 13 | **Game: time up** (`TIMESUP`) | Curtain, then the "TIME IS UP" sign (image sprite, not localized) for 3 s. Costs a ball | → restarting / game over | E |
| 14 | **Game: goal** (`FLY_AWAY`) | The ball is sucked into the goal pole and rockets up. Fireworks (count = remaining seconds mod 10). Curtain and "GOAL" sign | → stage result | E |
| 15 | **Game over** (`GAME_OVER`) | "GAME OVER" sign (sprite). Stage score = items only | → ranking | E |
| 16 | **Stage result** (`STAGE_RESULT`) | Page title and URL. Rows: seconds left × 5 pt (animated count-up with a "point" tick SE, 10 ms per second, max 3 s), large items × 100, small items × 1, stage score, total score. "1UP" popup if the count-up crosses 3000. Share: `tweet.stage` ("I just conquered a 3D maze of "__TITLE__" on World Wide Maze!") + G+/Twitter/Facebook. Buttons: next stage, finish | next → stage select (score and balls carry over) · finish → ranking | E |
| 17 | **Ranking** (`RANKING`) | Global top 10 (name, points). Your rank ("??" while loading, then 1st/2nd/3rd/Nth) and total points. Name input placeholder `ranking` ("Enter name here to join ranking"), OK/SUBMIT, skip. After that: new game, back to top, share `tweet.rank` ("I just became __RANK__ th place …"). The total score resets on leaving | newgame → stage select · title → title | E |
| E1 | **Error / disconnected** (`ERROR`) | `disconnected`: "PC and mobile phone disconnected. <wbr>Reload browser and connect again." Only action: reload | reload | E |
| E2 | Socket connect failed | Redirect to `pc/not-supported/` (E). That page presumably shows `nondisplay.connectfailed` ("Ah snap! The connection has been lost.") (R) | — | E/R |
| E3 | Conversion failed / timeout (30 s) | **No error screen.** The client silently builds `/maze/pc/not-available/` instead, a playable stage made of an apology page | → game | E |
| — | Requirements overlay (footer) | `requirements.network/browser/hardware/windows/mac/iphone/android` and troubleshooting `requirements.trouble.q1–a3` (content doesn't load / devices don't connect → try Tab Sync / mobile disconnects → quit other apps) | close | E |
| — | Tab Sync help page (`/maze/tabsync/pc.html`) | `tabsync.*` step-by-step | — | E |

## Phone controller (2013, not recovered)
The mobile bundle is not in the archive (the CDX index has no mobile script, see [archive-index.md](archive-index.md)). From the PC-side code and strings:
- **E:** there are POWER (hold), JUMP and MENU buttons (MENU sits "on top of phone"). The phone sends `orientation {alpha, beta, gamma}`, `power`, and `jump`. The phone mirrors app and world state and can type the search query, choose a result, enter a nickname, and tap new game or title on the ranking screen. It receives `position` (x, y, direction at 10 Hz) and `stageData`.
- **R:** the phone likely rendered a 2D map of the stage with the ball position, given the `position` and `stageData` sync. Its layout is unknown.

## What our rebuild changes (N)
| Area | 2013 | Ours |
|---|---|---|
| Pairing | Tab Sync (Chrome sign-in), QR, typed URL + 6-digit code, email link | QR + `/c/<code>` URL + 6-digit code (contract §6). Tab Sync no longer exists in this form. **N** |
| Conversion failure | Silently plays a "not available" stage | Explicit error (`CAPTURE_BLOCKED`, `CAPTURE_TIMEOUT`, `UNPLAYABLE`…) plus "play a curated stage instead", optionally still offering a tribute "not available" maze. **N** |
| Disconnect | Error page and reload only | Pause, "reconnect your phone" with the same code, resume after fresh input. **N** |
| Orientation permission | Not needed in 2013 | iOS `DeviceOrientationEvent.requestPermission()` needs an "Enable tilt" tap. Denied → keyboard or touch fallback. **N** |
| Ranking | Global board of session totals | Per-stage boards (contract §7) plus optionally a session/global board. See contract-deltas. **N/R** |
| Search | Google Custom Search API in-app | Paste a URL plus a curated list. Search is optional/out of scope. **N** |

## Failure states checklist for Phase 08
1. Unsupported browser (no WebGL2/WebGPU fallback, no WebSocket). E (adapted)
2. Pairing code invalid. E (`connect.mobilenmuber` / `connect.pcnumber` alerts)
3. Calibration timeout (15 s) → offer keyboard. E
4. "Too tilted!" during play. E
5. Conversion failed / timeout. E (behavior changed, see above)
6. Disconnect during play. E (behavior changed)
7. Window blur → auto-pause. E
8. Orientation permission denied, and page backgrounded on the phone. N
