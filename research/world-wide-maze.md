# World Wide Maze: historical research and recovery guide

Research date: September 24, 2026 (America/Los_Angeles). This is a substantial first investigation, not a claim that every surviving artifact or private production detail has been found. Historical observations, live retrievals, interpretations, and proposed engineering choices are distinguished below.

## Identity and intent

World Wide Maze launched on March 21, 2013 as a Chrome Experiment associated with Google Japan. Google's contemporary announcement describes a desktop game controlled by tilting a smartphone, collecting points and navigating bridges and elevators toward a timed goal. The surviving Experiments directory dates it to March 2013. These primary sources support calling it a Chrome Experiment; they do not identify it as a Google Labs product. [Google Japan launch announcement](https://blog.google/intl/ja-jp/products/android-chrome-play/2013_03_chrome-experimen/), [official experiment entry](https://experiments.withgoogle.com/world-wide-maze).

The commissioning context matters: its purpose was to demonstrate what Chrome could do across desktop and mobile. The award submission describes selecting a website, transforming it into a course, and competing through scores based on collection and completion time. This was a browser capability demonstration expressed as a game. [The One Show entry](https://www.oneclub.org/awards/theoneshow/-award/21187/world-wide-maze/).

The user's starting reference is [Engadget's March 21 launch coverage](https://www.engadget.com/2013-03-21-chrome-world-wide-maze-browser-game.html). The deeper sources below make a recreation much less dependent on press descriptions.

## Who deserves credit

| Contributor | What the evidence supports |
|---|---|
| Google Japan | Client and commissioning organization |
| PARTY, Tokyo | Agency |
| AID-DCC, Tokyo | Production company |
| Katamari, Tokyo | Production company |
| FUTUREK, Tokyo | Production company; its own case study explicitly identifies backend development |
| Saqoosha | Author of the detailed first-person engineering case study and related installation posts |

The organizational credits are recorded in [The One Show's cross-channel award entry](https://www.oneclub.org/awards/theoneshow/-award/21447/world-wide-maze/) and the [Webby record](https://winners.webbyawards.com/2014/advertising-media-pr/individual/game-or-application/145045/google-chrome-world-wide-maze). See [FUTUREK's own account](https://www.futurek.com/works/detail/worldwidemaze) and [Saqoosha's engineering case study](https://web.dev/case-studies/world-wide-maze) for the narrower role claims. This is not a complete list of individual designers, engineers, producers, and sound contributors.

The promotional song was **8**, by **KAISOKU TOKYO / 快速東京**, released March 21, 2013. The artist's release credits name Tetsumaru Fukuda for lyrics, the band for music, Kentaro Nakao for production, Yuji Kamijo for recording/mixing, and Kazuharu Sara for drum tech. This is specifically promotional music; it should not be mislabeled as the complete in-game soundtrack. [Artist's release](https://kaisokutokyo.bandcamp.com/track/8).

A particularly revealing detail: the band's label says its homepage was redesigned to work well as a maze. That is evidence of people treating webpage design itself as a form of level design. [Label announcement](https://1fct.net/news/n_5714).

## What playing involved

The recovered March 22 English localization directly documents these interactions:

- Connect by Tab Sync, QR code, or a typed/emailed link and six-digit code; PC-only play is offered.
- Lock the phone in portrait orientation and calibrate its starting pose.
- Hold **POWER** while tilting; press **JUMP** to jump; use **MENU** to view the map.
- Keyboard equivalents: arrows, space to jump, and **M** for the map.
- Choose a practice stage or search for another site; the interface explicitly acknowledges that some sites cannot convert.
- Collect items, finish with time remaining, and optionally enter a name for rankings.

Its requirements list iOS 5+ and Android 4+; separate browser-download copy says iOS 4.3+, so that copy should not replace the game's stated requirement. These are 2013 requirements, not present-day compatibility promises. [Recovered English localization](https://web.archive.org/web/20130322175440id_/http://www.chrome.com/maze/locales/en/translation.json).

## The original engineering, condensed

Saqoosha documents a hybrid image/DOM pipeline: PhantomJS captured a page and element coordinates; C++ with OpenCV and Boost converted visible regions into islands. Background removal, dilation, blur, and thresholding grouped text; image bounds preserved pictures. Neighboring islands received bridges, then randomized backtracking removed surplus connections. The builder placed items, rails, starts, goals, and recovery points, returning JSON.

The client used Three.js r53, poly2tri, Ammo.js/Bullet, Physijs workers, CoffeeScript, RequireJS, HTML/CSS, and i18next. Phone orientation traveled through Node.js/Socket.IO 0.9.11. Tab Sync shared the pairing URL; WebSocket carried ongoing input.

Engineering details worth studying: independent physics/render rates; selective glow; reflections updated every third frame; batching reduced roughly 2,000 draw calls to 50; automatic quality reduction; noisy orientation filtering; and an iOS TCP buffering workaround. The author reports roughly 10,000 lines across 60 classes, not a verified whole-project effort estimate. [Complete first-person technical account](https://web.dev/case-studies/world-wide-maze).

Read that account in this order: stage builder, physics, WebSocket, WebGL, then HTML and module organization. It is the most useful conceptual reconstruction source found.

## The backend was substantial work

Google's November 7, 2013 cloud article describes App Engine handling HTTP/orchestration and Compute Engine hosting relay connections, database servers, and stage generation. It sets a controller-to-render response objective within 200 ms. That is a historical design objective, not a modern measured benchmark. [Google Cloud article](https://cloudplatform.googleblog.com/2013/11/build-amazing-games-on-google-cloud-platform-with-nodejs-and-websocket.html).

FUTUREK explains that it used beta Compute Engine because App Engine did not support the required WebSocket server at the time. Its account describes increasing instances ahead of load and the difficulty of distributing worldwide connections. Therefore, avoid flattening the story into a claim that all scaling was automatic. [Backend developer's account](https://www.futurek.com/works/detail/worldwidemaze).

The longer solutions article linked by Google currently returned a 404 during this investigation. Its lost URL is retained as a recovery lead: [Real-time Gaming with Node.js + WebSocket on Google Cloud Platform](https://cloud.google.com/resources/articles/real-time-gaming-with-node-js-websocket-on-gcp). The short blog survives; the full article was not recovered here.

## What was recovered directly

The old [launch URL](https://chrome.com/maze/) redirected to Google during this investigation. The official directory entry survives, but it is not a playable service.

Internet Archive's index yielded assets beyond unsupported-browser pages. Direct retrieval succeeded for:

| Artifact | Archived capture | Verified result |
|---|---|---|
| Desktop entry HTML | March 22, 2013, 02:47:10 UTC | Contains feature detection and the desktop bundle entry point |
| Desktop `main.js` | March 22, 2013, 17:54:36 UTC | 1,062,393 bytes; named modules and templates remain identifiable |
| English `translation.json` | March 22, 2013, 17:54:40 UTC | 9,178 bytes; parsed successfully as JSON |

The bundle includes named modules for the ball, stage, elevators, camera, rendering, scoring, keyboard input, menus, and sound. Its configuration contains `NUM_BALLS=3`, `SMALL_SCORE=1`, `LARGE_SCORE=100`, `TIME_SCORE=5`, and `ONEUP_SCORE=3000`. Static inspection also found score-threshold logic that can replenish a ball while below three. These are properties of this recovered build. They do not by themselves settle the user-visible life-count convention or every scoring edge case. [Archived desktop bundle](https://web.archive.org/web/20130322175436id_/http://www.chrome.com/maze/pc/scripts/main.js).

The index also lists CSS, a physics worker, and some libraries. Those index entries are leads, not a completed dependency recovery. The mobile client, all original art/audio, backend implementation, and complete runnable dependency set were not recovered. The downloaded scripts were inspected as text, not executed.

Hashes and exact retrieval URLs are in [recovery-evidence.json](recovery-evidence.json). Temporary raw inspection copies are outside the project; this research package contains observations and provenance, not a redistribution of the original game.

## A second important discovery: installation artifacts

[Katamari-Inc/WWMMM](https://github.com/Katamari-Inc/WWMMM) identifies itself as **World Wide Maze Moving Model**, an installation for dotFes 2013 Kyoto. Its README describes openFrameworks, projection, motor/Arduino tests, and stage rendering. It is a related installation, not the original website's complete source release.

Direct inspection of its pinned [AID-DCC stage JSON](https://github.com/Katamari-Inc/WWMMM/blob/be2bea8f87cdb2a6394e6e8140436a2e12e28d35/_StageRenderer/bin/data/http-aid-dcc.json) found:

- 38 islands, 37 bridges, 12 large items, and 1,503 small items.
- Island contours, guardrails, height levels, and restart points.
- Start and goal coordinates; bridge angles, widths, distances, types, and endpoint levels.
- A development URL in the metadata, so it should not be described as a preserved public production session.

The repository also lists stage meshes and shaders. The companion [WWMMM-assets repository](https://github.com/Katamari-Inc/WWMMM-assets) includes Blender/SVG stage files, hardware documents, and printable model data. GitHub's repository metadata reported no top-level license for either installation repository; this research does not classify their assets as freely reusable. The [Physijs fork](https://github.com/Saqoosha/Physijs) is a separately identifiable MIT-licensed component.

This makes a later forensic viewer a plausible experiment: render a documented fixture, compare the data with the visual reference, and learn the coordinate conventions. That would still be a reconstruction experiment, not proof that the original service has returned.

## Timeline and recognition

| Date | Evidence-backed event |
|---|---|
| March 21, 2013 | Public launch in Google's Japanese announcement |
| June 2013 | Saqoosha's June 29 post reports a Mobile Lions Gold award |
| September 2013 | Saqoosha describes an Oculus Rift adaptation, “The Ball,” at PARTY's ggg exhibition; the post also mentions a Chrome fifth-birthday web update |
| November 2013 | Moving Model installation documented at dotFes; Google publishes its cloud architecture account |
| 2014 | One Show Silver Pencil for Cross-Channel Integration and Merit for Branded Games; Webby nomination and an Experimental & Innovation honoree; D&AD Wood Pencil |
| May 2023 | A lost-media discussion reports an exchange with Saqoosha about the closed backend |
| September 2026 | This investigation retrieves a desktop bundle and localization and inspects installation stage data |

Sources: [developer's Gold award post shown in the blog archive](https://saqoo.sh/a/2432), [Oculus adaptation](https://saqoo.sh/a/2437), [Moving Model production diary](https://mowwmmm.tumblr.com/), [One Show Silver](https://www.oneclub.org/awards/theoneshow/-award/21447/world-wide-maze/), [One Show Merit](https://www.oneclub.org/awards/theoneshow/-award/21187/world-wide-maze/), [Webby nominee](https://winners.webbyawards.com/2014/advertising-media-pr/individual/game-or-application/145045/google-chrome-world-wide-maze), [Webby honoree](https://winners.webbyawards.com/2014/apps-software/handheld-devices/experimental-innovation/145044/google-chrome-world-wide-maze), [D&AD record](https://www.dandad.org/work/d-ad-awards-archive/world-wide-maze).

The [2023 lost-media thread](https://www.reddit.com/r/lostmedia/comments/13e0vkv/) is secondary testimony, not an independently authenticated developer interview. Its shutdown-year claim remains unverified. Its conclusion that the game can never be played again is stronger than the evidence warrants: a closed original backend and the feasibility of a new reconstruction are different questions.

## Why the concept still matters — interpretation

The user's website choice gives the transformation personal meaning. The phone makes the scene feel physical. The course makes ordinary typography and images navigable. A successful recreation needs those relationships to survive.

The most revealing contemporary comparison is not simply visual quality. It is the chain from a messy page to readable, reachable, enjoyable geometry. Modern tools may reduce implementation work, but they do not automatically resolve collision quality, camera behavior, onboarding, or the feel of tilting a ball.

The original is also useful for studying engineering judgment. Its creators assembled existing tools, extended missing capabilities, and accommodated infrastructure and device limitations. A respectful AI showcase should make the new human decisions and inherited work equally visible.

## Study route and unresolved questions

1. Watch the [launch trailer](https://www.youtube.com/watch?v=7AvTl9aU5D8), linked by the music label, and the [Japanese technical talk](https://www.youtube.com/watch?v=ELSTW5SgsD0). These were located, but full playback and a timestamped visual analysis were not completed here.
2. Read the first-person case study and sketch each subsystem before choosing modern libraries.
3. Inspect the recovered interface text to specify onboarding, controls, and failure states.
4. Use the pinned stage fixture to investigate geometry semantics. Do not silently treat installation behavior as launch behavior.
5. Study the backend accounts and separate historical platform constraints from present requirements.
6. Read the installation diary for the physical extension of the idea and the authors' documented calibration difficulties.

Remaining gaps: complete individual credits; original budget and schedule; verified usage statistics; exact shutdown date and reason; original server code; mobile bundle and full asset coverage; complete network protocol; precise timer/life rules; legal reuse permissions for original branding, art, audio, and non-licensed code; frame-by-frame visual reference measurements. These gaps limit claims of exact restoration, not the ability to design a new tribute.
