# World Wide Maze — Research Dossier & Rebuild Plan

> Goal: faithfully recreate Google's 2013 Chrome Experiment **World Wide Maze** (turn any website into a 3D marble maze, steer with your phone), rebuilt in 2026 with modern web tech and AI, as a tribute to the original craft and a showcase of what's possible now.

---

## Part 1 — What the original was

### 1.1 Facts

| | |
|---|---|
| Released | March 21, 2013, as a Chrome Experiment (`chrome.com/maze`) |
| Made by | Google Japan with Tokyo agency **PARTY**. Engineering lead **Saqoosha** wrote the technical case study. Won Interactive **Silver at Cannes Lions**, and was featured on The FWA |
| Pitch | "Turn your favorite site into a 3D maze, then find your way out using your mobile phone as a controller" |
| Platforms | Desktop Chrome for the game; Chrome on iOS 5+ or Android 4+ as the tilt controller. Keyboard fallback on desktop |
| Codebase | About 10,000 lines of CoffeeScript in about 60 classes, loaded with RequireJS and built with r.js. The client JS was about 2 MB, or about 1 MB minified |

### 1.2 Gameplay (what players saw)
- You enter any URL. The server screenshots the page and turns its content (images and text blocks) into floating **islands** in an **ocean**. **Bridges** connect the islands to form a maze.
- A glowing, metallic, reflective **ball** (reviewers compared it to the Nexus Q) appears with a shader "mesh" materialize effect.
- **Tilt** the phone to roll the ball. The controller has **Power** (boost) and **Jump** buttons.
- Collect **small glowing orbs** (points) and up to **6 large items**, then reach the **goal**. The goal triggers shader fireworks.
- There is a **time limit** ("TIME IS UP"). If you fall into the ocean, you respawn at the nearest **restart point**.
- The game has **Result** and **Ranking** screens, with rankings kept per site. Elevators and bridges were mentioned as stage features.
- First-time players get a **tutorial** that starts with calibration. If calibration fails within a time limit, the game offers keyboard controls instead.
- Community reception (Hacker News): "the first time I've been genuinely impressed with a Chrome Experiment", "Super Monkey Ball made of websites". Complaints included disconnects, loads of up to about 2 minutes, flaky accelerometers, battery drain, and Chrome-only support.

### 1.3 How it was built (from Saqoosha's case study)

**Pipeline**
```
Phone (DeviceOrientation) ──Socket.IO──► Node.js relay on Google Compute Engine (US) ──► Desktop (three.js + Physijs)
Desktop ──URL via WebSocket──► GCE: PhantomJS screenshot + div/img boxes (JSON)
                               └► C++ "stage_builder" (OpenCV + Boost.Geometry + picojson) ──stdout JSON──► Node ──► browser
```

**Controller and networking**
- `deviceorientation` fired about every 50 ms on iOS and about every 100 ms on Android. The value ranges differed by device and browser, and only Android Firefox matched the spec. The game used iOS values as the standard and normalized Android (`if gamma > 180: gamma -= 360`). The Nexus 10 swapped beta and gamma.
- **Pairing by number:** the PC connects and gets a random number, the phone enters that number, and the server relays messages between the pair. Pairing could also start from the phone.
- **Tab Sync trick:** the PC ran `history.replaceState(null, null, '/maze/' + n)`. Chrome sync then pushed the tab URL to the phone, and the phone read the number from the URL and connected automatically, so users didn't need a QR code or to type anything.
- **Latency:** the round trip from Japan to the US server was about 200 ms. An EMA low-pass filter hid the lag and also removed sensor jitter. Jumps still felt sluggish.
- **Nagle bug:** iOS WebKit WebSockets didn't set TCP_NODELAY, so 100 ms tilt packets arrived in 500 ms bursts. The fix was for the server to send filler packets about every 50 ms. The frequent ACKs kept Nagle from buffering.
- WebRTC DataChannels were considered, but in 2013 they only worked in Chrome Canary and Firefox Nightly.

**Physics**
- The game used Ammo.js (Bullet compiled with Emscripten) through **Physijs**, which ran physics in a **Web Worker**. Physics ran at a steady 60 fps even when rendering dropped. Saqoosha used his own fork of Physijs to strip unneeded work.
- The whole stage was a `ConcaveMesh` (`btBvhTriangleMeshShape`) and handled more than 100k triangles.
- Items and goals were **ghost objects** with `collision_flags = 1|4` (STATIC and NO_CONTACT_RESPONSE), which detect overlap without collision response.

**Rendering (three.js r53)**
- **Selective glow** used a simplified Kawase MGF bloom. Only the ball core and items went into a separate glow render target, because blooming everything would have made white website backgrounds glow. The blur ran in 3 passes at full, ½ and ¼ resolution.
- The **reflective ball** used a cube-camera environment map updated every 3 frames.
- A **GLSL for everything** approach used the GPU to keep the CPU free for physics: ocean waves, fireworks, the ball-spawn mesh (320 polygons), and **all small items merged into one mesh** and animated by vertex shaders (tested with 5,000 items, about 20k triangles).
- **Triangulation:** three.js's built-in triangulator failed often, so the game used **poly2tri** (patched to throw instead of calling `alert`).
- **Anisotropic filtering** kept the website texture sharp at grazing angles.
- **Draw calls:** merging islands, bridges and rails by type cut draw calls from about 2,000 to about 50.
- **Auto performance adjuster** (reused from *Find Your Way to Oz*):
  - Below 45 fps, stop updating the environment map.
  - Below 40 fps, render at 70% resolution.
  - Still below 40 fps, drop FXAA.
  - Below 30 fps, drop glow.
- The UI was HTML/CSS overlays: "GOAL" and "TIME IS UP" animated with CSS transitions, and i18n through i18next driven from a Google Sheet.

**Stage builder algorithm (the heart of it)**
1. **Capture:** PhantomJS takes a screenshot and exports every `div` and `img` bounding box as JSON.
2. **Background removal:** remove the most common color in the screenshot (usually the page background). Everything left is a candidate island.
3. **Clump text:** apply `cv::dilate`, then `GaussianBlur`, then `threshold`, so fine text merges into solid blocks. Fill each `img` rectangle solid. The result is clean blobs: **islands**.
4. **Bridges:** each island looks **left, right, up and down** for its nearest neighbor and builds a bridge to that neighbor's closest point.
5. **Maze carving:** randomized depth-first search from the top-left island. Keep one random unvisited bridge, delete the rest, and backtrack at dead ends until every island is visited. The result is a spanning tree, which is a perfect maze.
6. **Large items:** find the points on each island farthest from its edges (a distance transform). The top-left point becomes the **start**, the bottom-right becomes the **goal**, and up to 6 others hold large items.
7. **Small items:** place them along inset contours a fixed distance inside each island edge, jittered slightly.
8. **Restart points:** place them the same way as small items. A fall respawns the ball at the nearest one.
9. **Guard rails:** follow island outlines, and cut the rails where bridges attach (Boost.Geometry intersections).
10. **Output:** JSON goes to stdout and on to Node, then to the client. The client triangulates the outlines with poly2tri, extrudes them, and applies the screenshot as the texture.

> Key design decision: Saqoosha first tried a pure DOM-based approach (like the Firefox 3D Inspector), then switched to **image processing**, which works on any site regardless of markup.

---

## Part 2 — Rebuild strategy: 2013 → 2026

| Concern | 2013 | 2026 rebuild |
|---|---|---|
| Headless capture | PhantomJS (dead WebKit) | **Playwright/Puppeteer on Cloudflare Browser Rendering** (or a container), using modern Chromium |
| Layout data | div/img boxes | Full DOM walk: text-node rects via `Range.getClientRects()`, images, video, canvas, headings, links and buttons, plus semantic role and computed background color |
| Image processing | C++ OpenCV and Boost subprocess | **A pure TypeScript grid-based builder** (below) that runs in a Web Worker *and* on the server. Optionally Rust compiled to WASM |
| Polygon ops | Boost.Geometry | **Clipper2** (offsets, booleans, rail cutting) |
| Triangulation | poly2tri, patched | **earcut** (three.js built-in, robust), or poly2tri-ts for constrained cases |
| Physics | Ammo.js and Physijs in a worker | **Rapier 3D (WASM)** in a worker: deterministic, fast, and has sensors (the modern ghost objects) and CCD |
| Rendering | three.js r53 WebGL1 | **three.js WebGPURenderer with WebGL2 fallback**, TSL node materials, selective bloom through MRT, and instancing |
| Controller transport | Socket.IO relay (Nagle issues) | **WebRTC DataChannel** (unordered, `maxRetransmits: 0`) peer to peer, with a **Durable Object** WebSocket relay as signaling and fallback |
| Pairing | Numeric code and Chrome Tab Sync | **QR code** plus a **4-letter room code**, with the code in the URL (`/p/ABCD`), so it works in any browser |
| Tilt filter | EMA | **One Euro filter** (low jitter at rest, low lag in motion) plus client-side prediction |
| Sensors | Raw `deviceorientation` quirks | `DeviceOrientationEvent.requestPermission()` on iOS, which needs HTTPS and a user gesture. Normalize by `screen.orientation.angle`, and calibrate zero |
| Input fallback | Keyboard | Keyboard, **Gamepad API**, touch joystick, and **single-device mode** (play on the phone itself by tilting it) |
| Hosting | GCE US-only and GAE | **Cloudflare edge**: Workers, Durable Objects (rooms near users), R2, D1 and KV |
| Browsers | Chrome-only | Every evergreen browser: Chrome, Safari, Firefox and Edge |
| AI | None | Semantic stage theming, AI-named levels, difficulty tuning, a solver bot, and a "made with AI" narrative (Part 5) |

---

## Part 3 — System architecture

```
┌──────────────┐  URL   ┌───────────────────────── Cloudflare ─────────────────────────┐
│ Desktop web  │──────► │ Worker: /api/stage                                            │
│ (game view)  │        │   1. normalize URL + SSRF guard + cache lookup (KV/R2)        │
│  three.js    │◄────── │   2. Browser Rendering (Playwright): screenshot + DOM JSON    │
│  Rapier(wkr) │ stage  │   3. Stage builder (TS, same lib as client)                   │
│              │  JSON  │   4. AI enrichment (Claude): theme, names, hazards            │
│              │        │   5. Store: R2 (webp texture, stage.json), D1 (metadata)      │
│              │        │                                                                │
│              │◄─RTC──►│ Durable Object "Room": signaling + WS fallback relay          │
│  Phone web   │        │ D1: leaderboards, replays index    R2: ghost replays          │
│ (controller) │        │                                                                │
└──────────────┘        └────────────────────────────────────────────────────────────────┘
```

### Monorepo layout (pnpm + Turborepo, TypeScript everywhere)
```
apps/
  web/            Vite + React (or Svelte) shell. Routes: / (enter URL), /play/:stageId, /c/:room (controller), /museum
  worker/         Cloudflare Worker: API, Browser Rendering, Durable Objects
packages/
  stage-builder/  Pure TS. Input: screenshot bitmap + DOM JSON + seed. Output: StageData. No DOM or Node deps
  stage-schema/   Zod schema + types for StageData, versioned
  engine/         three.js scene, materials, shaders, perf adjuster
  physics/        Rapier worker, fixed-step sim, input → forces, deterministic replay
  net/            Pairing, WebRTC, WS fallback, One Euro filter, message codec (binary)
  ai/             Prompting + schemas for stage enrichment
tools/
  stage-debugger/ Web page that visualizes each builder step as layers (like Saqoosha's debug images)
```

---

## Part 4 — Components in detail

### 4.1 Capture service (Worker + Browser Rendering)
- **Viewport** is 1280×(auto) at DPR 1. Cap page height at about 6,000 px, so long pages become multiple stages (Part 4.8).
- **Page prep before capture:**
  - Auto-dismiss cookie and consent banners with a selector list plus an AI fallback.
  - Scroll to the bottom to trigger lazy loading, wait for network idle, then scroll back to the top.
  - Remove fixed and sticky headers after the first viewport so they don't duplicate across the page.
  - Pause animations and videos (grab a poster frame).
- **DOM extraction script** (runs in the page) emits, for every visible element with area above a threshold:
  - `rect`, `kind` (text | image | video | button | link | heading | input | nav | ad-like)
  - `bg` (computed background color)
  - `zIndex`, `fixed`, `textLength`, `fontSize`
  - text snippet, trimmed (for AI naming)

  It gets text rects per line from `Range.getClientRects()`. This is far better than 2013's div boxes.
- **Outputs:** `screenshot.webp` (full page) and `dom.json`.
- **Safety:**
  - Resolve DNS and block private, link-local and metadata IPs to prevent SSRF.
  - Allow http and https only.
  - Enforce a 20 s timeout and a max size.
  - Honor an opt-out list.
  - Run NSFW or unsafe-content classification on the screenshot (a vision model) before publishing a stage.
  - Don't execute downloads, and use no persistent cookies.
- **Caching:** key = hash of the normalized URL + builder version + day. Popular sites get stable, shared stages, and the leaderboards depend on that.
- **Fallback:** if a site blocks headless browsers, let the user **upload a screenshot**. Vision AI then infers the block layout (Part 5).

### 4.2 Stage builder (pure TypeScript and deterministic, the core IP)
This follows the original algorithm on a **grid** instead of OpenCV. It's simpler and portable, and it's fast enough with typed arrays.

1. **Rasterize to a work grid:** downsample the screenshot to 1 cell = 4 px, so a 1280 px wide page becomes 320 columns.
2. **Background mask:**
   - Build a color histogram (quantized) and treat the dominant color as background, as in the original.
   - Improvement: also treat each element's computed `bg` as local background, so colored sections don't become one giant island.
   - Add a threshold on color distance, with ΔE in Lab space.
3. **Semantic fill:** OR in the DOM rects. Image, video and button rects become solid, and text line rects are dilated by about 0.5 line height. Ignore tiny noise (area below N cells).
4. **Morphology:** dilate by r, then close (dilate + erode), then fill holes. This recreates `dilate → blur → threshold`.
5. **Islands:** connected components (union-find). Drop components smaller than the minimum playable size (at least 3× the ball diameter). Split huge components, such as a full-bleed hero image, with a grid so they don't become one boring plain.
6. **Contours:** marching squares, then Douglas–Peucker simplification (ε ≈ 1 cell), then Chaikin smoothing for soft edges. Holes stay as holes.
7. **Candidate bridges:** as in the original, look in 4 directions for the nearest island and connect closest points. Improvement: build a **Relative Neighborhood Graph** over the islands, so diagonal-only layouts also connect. Reject bridges that cross another island or are too long (more than a max span).
8. **Maze carving:** randomized DFS spanning tree, seeded by the stage seed, exactly like the original. **Difficulty knob:** add back k% of the removed bridges to create loops and shortcuts. Easy mode uses more loops.
9. **Start and goal:** compute a distance transform per island, and take local maxima as "safe spots". Improvement over top-left/bottom-right: pick the **start on the island nearest the top-left**, and put the **goal on the island farthest along the tree** (longest path by BFS). That makes a guaranteed long route.
10. **Items:**
    - Up to 6 large items at the remaining safe spots, preferring dead-end islands, which rewards exploration.
    - Small orbs along Clipper2 inward offsets (inset d), spaced every s, with jitter.
11. **Restart points:** placed along the same insets. A fall respawns the ball at the nearest point on the *current or last-touched island*.
12. **Guard rails:** Clipper2 outward offset of each island outline, minus the bridge mouths (a boolean difference with bridge-end rectangles). Leave some deliberate **rail gaps** as hazards at higher difficulty.
13. **Special features** (from the original's mentions and new ideas):
    - **Elevators** between islands whose heights differ by more than the jump height.
    - **Height layering:** island height comes from a DOM depth or z-index heuristic, so headers sit higher and footers lower. Stages get verticality, and ramps make up bridges.
    - **Moving bridges** (sine-animated) at hard difficulty.
14. **Validation:**
    - Graph check: the goal is reachable, and every bridge is at least 2.5× the ball diameter wide.
    - **Headless physics check:** a solver bot (Part 4.6) must reach the goal in simulation within the time limit, otherwise regenerate with the next seed. This fixes the original's "occasional unplayable stage".
15. **Output:** `StageData` JSON with islands (outline and holes), heights, bridges, rails, items, start, goal, restarts, texture UV transform, seed, builder version and time limit.

`tools/stage-debugger` renders each step as a toggleable layer over the screenshot: mask, islands, candidate bridges, carved maze, items, rails, restart points. That matches the debug imagery in the case study, and it's great showcase material.

### 4.3 Renderer (packages/engine)
- **Islands:** extrude each outline (earcut) to a slab with a beveled edge. Top faces get planar UVs into the screenshot, so the island *is* the website content. Sides get a stylized material. **Merge by type** (one mesh for all island tops, one for sides, one for bridges, one for rails) to keep draw calls under 50, as in the original.
- **Screenshot texture:** use KTX2/Basis, or tile long pages into multiple textures. Use max anisotropy, sRGB and mipmaps.
- **Ocean:** Gerstner-wave vertex shader, a fresnel fragment shader, and screen-space or planar reflections on high tier. The islands' bottoms fade into fog.
- **Ball:** a metallic PBR shell with a glowing emissive core. Cube-camera env map every 3 frames (the original's trick), or a single low-res probe on low tier.
- **Selective bloom:** an MRT emissive buffer, then a mip-chain bloom (the Kawase or dual-filter successor), so the website texture never blooms. This is the same problem the original solved.
- **Items:** one `InstancedMesh` of orbs animated in the vertex shader (bob and spin), with collection handled by an instance attribute. Large items are distinct models with glow.
- **Effects:** ball spawn "wireframe materialize" shader, GPU-particle goal fireworks, splash when falling in the ocean, and speed lines when Power is active.
- **Camera:** chase camera with spring damping and look-ahead in the direction of velocity. It pulls back on bridges and has a top-down "map" peek button.
- **Auto performance adjuster** (modern version of the original ladder), based on an average frame time over 2 s:
  - Stop env-map updates.
  - Drop DPR to 0.7.
  - Drop anti-aliasing (SMAA/FXAA).
  - Drop bloom.
  - Simplify the ocean.
  - Recover upward with hysteresis.
- **UI:** an HTML/CSS overlay (timer, score, GOAL / TIME IS UP with CSS or View Transitions), as in the original. i18n with a message-catalog library.

### 4.4 Physics (packages/physics)
- **Rapier 3D in a dedicated Web Worker**, fixed step at 120 Hz with interpolation on the render side. It sends the ball transform through a SharedArrayBuffer (COOP/COEP headers) or through transferable messages.
- **Colliders:** the island top and side trimeshes (static), bridges, rails, and a ball rigid body with CCD. Items and goal use **sensor** colliders, the modern ghost objects.
- **Controls:**
  - Tilt maps to a **world gravity tilt**, which is the true marble-maze feel: rotate the gravity vector by pitch and roll, clamped to ±25°. An alternative mode applies torque on the ball (Monkey Ball style).
  - **Power:** a timed torque or impulse multiplier with a cooldown meter.
  - **Jump:** an upward impulse that's only allowed when a ground contact is detected.
- **Fall detection:** y < ocean level, then splash, then respawn at the nearest restart point with a time penalty.
- **Determinism:** fixed dt and recorded input frames make replays and ghosts exactly reproducible, as long as the Rapier build is the same.

### 4.5 Controller and pairing (packages/net + Durable Object)
- **Flow:**
  1. The desktop opens `/play/...` and creates a Room DO with a code like `KXQT`.
  2. The desktop shows a **QR code** for `https://wwm.app/c/KXQT` and the code in large type.
  3. The phone scans it. The page needs a tap to start, because iOS needs a gesture to grant motion permission.
  4. The DO relays SDP/ICE and opens a WebRTC DataChannel (unordered, no retransmits).
  5. If ICE fails, the game stays on the DO WebSocket relay.
- **Protocol:** binary messages (a DataView of about 12 bytes) carrying `seq`, `t`, `pitch`, `roll`, and a `buttons` bitmask. The phone sends at 60 Hz. The desktop sends back haptics events (`navigator.vibrate` on collect, fall and goal, on Android) plus state (timer and score, shown on the phone).
- **Latency tooling:** a ping/pong RTT display, a One Euro filter on tilt, and a jump button with local visual feedback on the phone right away. The Nagle problem goes away with WebRTC, and WebSocket in 2026 browsers sets TCP_NODELAY.
- **Calibration:** "Hold your phone flat and tap". Store the zero offset and normalize for landscape or portrait with `screen.orientation`. The 10 s calibration timeout falls back to keyboard, **exactly as in the original**.
- **Controller UI:** a big Power button (right thumb), a Jump button (left thumb), a live tilt indicator, and a wake lock (`navigator.wakeLock`) so the screen doesn't sleep.
- **Also support** keyboard (WASD or arrows, Shift for power, Space for jump), the Gamepad API, and **solo phone mode**, where the game renders on the phone and tilt controls it directly.

### 4.6 AI solver bot (validation, ghosts, attract mode)
- **Path planner:** A* over the island/bridge graph, then waypoints along bridge centerlines.
- **Controller:** a PD controller that outputs tilt (the same input channel humans use) to follow the waypoints, run inside the headless physics sim.
- **Uses:**
  - (a) Stage validation (4.2 step 14).
  - (b) Par time: the time limit = bot time × 2.2 (tunable per difficulty).
  - (c) An **attract-mode demo** on the home page, where the bot plays a random famous site.
  - (d) A "race the AI" ghost.

### 4.7 Game layer
- **Session:** title, then pairing, then tutorial (the first time only: calibrate → roll → jump → power), then stage intro fly-over of the website, then countdown, then play, then result, then ranking.
- **Scoring:**
  - Small orb +10 and large item +500.
  - Time bonus = remaining seconds × 50.
  - Fall −5 s.
  - Stars based on collection percentage and time.
- **Leaderboards:** per normalized URL and builder version in D1. Store top-N replays in R2 as input streams (small), so ghosts can be played back.
- **Sharing:** the link `wwm.app/s/<stageId>` includes an OG image, which is a rendered hero shot of that site's maze.
- **Daily Maze:** one curated site per day, with a global leaderboard, for retention.
- **Museum page:** a side-by-side of the 2013 stack and pipeline and the 2026 one, credits to Saqoosha, PARTY and Google Japan, and the stage-debugger visualizations. This is the showcase narrative you want.

### 4.8 Long pages and multiple stages
- If the page is taller than 1.5 viewports, slice it into **sections** (Stage 1, 2, 3...) at natural DOM section boundaries. Clearing one section drops the ball onto the next.
- Mobile layouts: optionally capture at 390 px for a tall "tower" variant.

---

## Part 5 — Where AI fits (showcase angle)

Keep the **geometry deterministic** (reproducible stages and fair leaderboards) and use AI for **meaning, polish and robustness**. This is the story: the *human* 2013 algorithm is still the skeleton, and AI adds understanding of *what the page is*.

1. **Semantic stage theming** (Claude with vision, on the screenshot plus trimmed DOM JSON). It returns strict JSON (tool use and schema):
   - Region roles: nav, hero, article, sidebar, ads, footer, comments.
   - Mapping to gameplay:
     - Nav becomes a raised "skyline" start plateau.
     - Ads become **hazard islands** that crumble after 2 s.
     - Comments become a bumpy field.
     - Search boxes become bounce pads.
     - The footer becomes the goal harbor.
   - Page palette becomes the ocean and sky color grading.
   - The page mood becomes the music track choice.
2. **Level names and flavor text:** "The Verge — Stage 2: The Gadget Archipelago". It's shown on the intro fly-over and shared cards.
3. **Difficulty director:** given stage stats (island count, bridge lengths, bot time), the AI proposes a difficulty tier, time limit, and loop percentage. The final choice is clamped by deterministic rules.
4. **Consent and overlay removal:** when the selector list fails, a vision model finds the "Accept" button, and Browser Rendering clicks it.
5. **Blocked-site fallback:** from a user-uploaded screenshot, vision infers text, image and nav blocks, which replace the DOM JSON.
6. **Safety:** vision moderation on screenshots before stages go public.
7. **Commentary:** optional light "announcer" lines on events (near-miss, record pace), pre-generated per stage so there are no live calls.
8. **Built with AI:** the museum page documents that the rebuild was produced with Claude Code: timelines, prompts, and diffs versus the 10k lines of hand-written CoffeeScript from 2013.

**Models:**
- A fast, cheap model (e.g. `claude-haiku-4-5`) for classification and moderation.
- `claude-sonnet-5` for vision theming and naming.
- Cache results per stage ID, so AI runs once per unique site version and never per play.

---

## Part 6 — Delivery plan

### Phase 0: Spike (1 week)
- A static prototype: a hardcoded screenshot and DOM JSON, then the builder in the browser, then three.js islands with the texture, then a Rapier ball with keyboard controls.
- Stage debugger with step layers.
- **Exit:** you can roll across a Wikipedia page turned into islands.

### Phase 1: Core game (2–3 weeks)
- The full builder (steps 1–15, without AI), the solver bot, and stage validation.
- Ball, items, goal, fall and respawn, timer, scoring, and the result screen.
- Renderer: merged meshes, ocean, selective bloom, ball env map, and the perf adjuster.
- **Exit:** 50 popular sites, with at least 90% producing valid, fun stages. Track this with an automated batch run.

### Phase 2: Any URL (1–2 weeks)
- Worker with Browser Rendering capture, SSRF guard, consent dismissal, lazy-load handling, R2/KV cache, and multi-section pages.
- Upload-screenshot fallback.
- **Exit:** paste any URL and play in under 10 s for a cold capture, under 1 s when cached. The original took up to about 2 minutes.

### Phase 3: Phone controller (1–2 weeks)
- Room Durable Object, QR pairing, WebRTC with WS fallback, and the iOS permission flow.
- Calibration tutorial, One Euro filter, haptics, wake lock, and solo phone mode. Gamepad support.
- **Exit:** under 60 ms added input latency on the same Wi-Fi, verified on iPhone (Safari) and Pixel (Chrome).

### Phase 4: AI layer (1–2 weeks)
- Semantic theming, hazards, naming, difficulty director, moderation, and consent fallback.
- **Exit:** AI-themed stages score higher than plain ones in blind playtests, at under $0.01 per unique stage.

### Phase 5: Social and polish (2 weeks)
- Leaderboards, ghost replays, share cards, Daily Maze, museum page, music and SFX, accessibility, and i18n.
- Accessibility covers reduced motion, colorblind-safe item glow, full keyboard play, and adjustable tilt sensitivity.

### Phase 6: Launch hardening (1 week)
- Load test the Durable Objects and Browser Rendering concurrency, and add a queue with a "building your maze..." progress UI that streams builder steps. Showing the steps live is a great showcase moment.
- Abuse limits, analytics, and error reporting.

**Total: about 9–12 weeks for one strong engineer with AI assistance. The MVP (Phases 0–2) takes about 4–5 weeks.**

---

## Part 7 — Risks and mitigations

| Risk | Mitigation |
|---|---|
| Sites block headless browsers or show bot walls | Upload-screenshot fallback, a curated cache of popular sites, and a clear error UX |
| Legal/ToS: rendering third-party content | Transformative, user-initiated, and not re-hosting the page as the page. Honor opt-out requests, don't capture behind logins, expire textures after N days, and handle DMCA |
| Unplayable or boring stages | Bot validation, seed reroll, min/max island size rules, and the batch fun-metric dashboard |
| iOS motion permission friction | Clear tap-to-enable screen, and keyboard or touch fallback |
| Latency across the internet | WebRTC P2P first, DO relays placed near users, and filtering plus local feedback |
| Low-end GPUs | Auto perf ladder, WebGL2 fallback, and texture tiling |
| Cost of capture and AI | Aggressive caching per URL hash, rate limits, and AI once per stage version |
| Determinism breaks on library updates | Pin Rapier, version stages (`builderVersion`), and reset leaderboards per version |

---

## Part 8 — Suggested first steps
1. Scaffold the monorepo (Vite + TS + three.js + Rapier + Cloudflare Worker).
2. Save 5 sample captures (Wikipedia, Hacker News, a news site, a portfolio, google.com) as fixtures.
3. Build `stage-builder` against the fixtures, together with the stage debugger.
4. Render and roll. Iterate on feel (gravity tilt, friction, camera) before anything networked.

---

## Sources
- Saqoosha, *Case Study – Inside World Wide Maze* (web.dev, originally HTML5 Rocks): https://web.dev/case-studies/world-wide-maze
- Engadget launch coverage: https://www.engadget.com/2013-03-21-chrome-world-wide-maze-browser-game.html
- Experiments with Google entry: https://experiments.withgoogle.com/world-wide-maze
- Google Japan blog (JA): https://blog.google/intl/ja-jp/products/android-chrome-play/2013_03_chrome-experimen/
- INTERNET Watch (JA): https://internet.watch.impress.co.jp/docs/news/592683.html
- The FWA case: https://thefwa.com/cases/chrome-world-wide-maze
- Cannes Lions Interactive Silver (Party Inc.): https://www.youtube.com/watch?v=tStREdp85PQ
- Hacker News discussion: https://news.ycombinator.com/item?id=5414235
- TechZone360 (WebSocket coverage): https://www.techzone360.com/topics/techzone/articles/2013/03/26/331949-google-maze-new-fun-game-powered-html5-websocket.htm
- Back2Gaming: https://www.back2gaming.com/news/google-chrome-experiment-world-wide-maze/
