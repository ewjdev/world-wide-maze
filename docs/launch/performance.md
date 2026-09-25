# Performance report (Phase 12, local measurements)

**Everything in this report was measured on one machine, locally, on 2026-09-25**, against the production build
served the way it will be deployed (Workers static assets + the API Worker, `wrangler dev --env staging`,
workerd 1.20260923.1). Nothing was measured on Cloudflare's network: **local numbers are not production
numbers.** Where a figure is a proxy, an estimate, or missing, it says so. Raw data: `docs/launch/evidence/`.

| | |
|---|---|
| Machine | Apple MacBook Pro, **Apple M5 Max** (40-core GPU), 128 GB, macOS 26.6.2; window on a 60 Hz display |
| Browser | Chromium 153 (Playwright's Chrome for Testing), **headed**, ANGLE/Metal, WebGPU backend (`ANGLE Metal Renderer: Apple M5 Max`) |
| Network | loopback (localhost); the capture tests fetch real public sites over the author's home connection |
| Build | `vite build` of this branch; Worker from `apps/worker` (same code as deploy) |

## Not measured (needs people or hardware — see checklist.md)
- **Integrated-GPU and midrange desktops.** Only the M5 Max was available. The throttled runs below are a *CPU*
  proxy; nothing here slows the GPU, so they say nothing about a weak GPU.
- **Controller-to-visible-motion latency** (camera-filmed, same Wi-Fi and cross-region) — needs a phone, a
  high-speed camera and a person. The only real-phone data is Phase 06's relay RTT (iPhone 17 Pro through a
  cloudflared tunnel: p50 23 ms, p95 102 ms; docs/build-log/phase-06-device-test.md). WebRTC recommendation:
  not yet evaluable without the filmed number.
- **Time-to-first-control for 5 fresh users** — needs 5 people.
- **Anything on Cloudflare's edge** (cold starts, Browser Run in production, real DO placement).

## 1. Frame-time distribution while playing (M5 Max, 60 Hz display)
Method (`infra/perf/frames.mjs`): each stage is deep-linked (`/play/<ref>`; the fixture captures are built into
stages in the browser), intro skipped, then the ball is driven with the arrow keys for 20 s while a
`requestAnimationFrame` recorder logs every frame interval. The engine's quality tier is sampled each second.
Viewport 1440×900, DPR 1. "Late" = an interval over 25 ms (1.5 vsyncs); at 60 Hz the intervals scatter around
16.7 ms, so p95 ≈ 18.5 ms is vsync jitter, not dropped frames.

| Stage | Frames | Mean fps | p50 ms | p95 ms | p99 ms | Max ms | Late >25 ms | >50 ms | Tier | Draw calls |
|---|---|---|---|---|---|---|---|---|---|---|
| practice (handmade-simple) | 1209 | 59.7 | 16.7 | 18.4 | 18.6 | 132.2 | 0.1 % | 0.1 % | 0 | 45 |
| Hacker News | 1208 | 60.0 | 16.7 | 18.3 | 18.6 | 32.2 | 0.1 % | 0 % | 0 | 45 |
| GOV.UK | 1208 | 60.0 | 16.7 | 18.2 | 18.6 | 18.7 | 0 % | 0 % | 0 | 45 |
| MDN (dark docs) | 1207 | 60.0 | 16.7 | 18.2 | 18.6 | 33.4 | 0.1 % | 0 % | 0 | 45 |
| Wikimedia Commons POTD | 1208 | 60.0 | 16.7 | 18.2 | 18.5 | 33.4 | 0.1 % | 0 % | 0 | 44 |
| **Wikipedia "Labyrinth", slice 4 of 4** (6,000 px page) | 1209 | 60.0 | 16.7 | 18.3 | 18.6 | 33.4 | 0.1 % | 0 % | 0 | 43 |

The quality ladder never left tier 0 (full quality). The single 130 ms+ frame on the practice stage is at the
start of recording. Retina (DPR 2, 2880×1800 render) on three of the stages: 59.5–59.9 fps, p99 18.6–18.7 ms, tier 0
(`evidence/frames-dpr2-throttle20.json`). Deep link → playing took 4.2–4.7 s (includes building the stage from
the capture in a Web Worker).

## 2. Throttled runs — a CPU proxy for slower machines, not a real low-end GPU
DevTools CPU throttling (`Emulation.setCPUThrottlingRate`) on the same M5 Max. The GPU runs at full speed.

| Throttle | Stages | Mean fps | p99 ms | Max ms | Late >25 ms | Tier |
|---|---|---|---|---|---|---|
| ×4 | all 6 | 59.6 | 18.6–18.7 | 148–151 | 0.1 % | 0 |
| ×6 | all 6 | 59.3–59.4 | 18.6–18.7 | 231–249 | 0.1–0.2 % | 0 |
| ×20 (DPR 2) | practice, HN, Wikipedia slice 4 | 55.9–56.4 | 32.8–33.3 | 816–833 | 1.2–1.5 % | 0 |

Even at ×20 CPU the game held ~56 fps with 1–1.5 % late frames and a few one-off hitches (≈ 0.8 s, likely GC/
compilation under throttling); the ladder didn't trigger because its window average stayed near 60. Phase 04 had
to use ×60 to see the ladder step down. **Conclusion: on this machine the frame budget is GPU-bound, and the real
open question — an integrated GPU — is untested.**

## 3. Stage build latency, cold and warm (local capture path)
Method (`tests/load/builds.mjs latency`): `wrangler dev` (top-level config, `BUILD_LIMIT_PER_HOUR` raised) with
Browser Run's **local** Chrome, the real stage builder and solver, real sites over the internet, one URL at a
time. Cold = `POST /api/stages` → SSE `done` (slice 0 stored, empty cache). Warm = the same POST again (KV run
cache hit).

| | n | p50 | p95 | max |
|---|---|---|---|---|
| **Cold** (slice 0 ready) | 21 of 24 succeeded | **4.5 s** | **8.6 s** | 12.5 s (Wikipedia "Marble (toy)") |
| Warm, measured right after each cold build | 21 | 66 ms | 189 ms | — |
| **Warm, measured at rest** (second pass) | 21 | **2.3 ms** | **3.9 ms** | — |

Failures (3 of 24): w3.org answered HTTP 403 (`CAPTURE_BLOCKED`), bbc.co.uk/news "could not load the page"
(`CAPTURE_BLOCKED`), gnu.org `CAPTURE_TIMEOUT` (20 s). The slow warm hits in the first pass happen while the same
run's later slices are still building in the local process; at rest a cache hit is 2–4 ms. Per-URL rows:
`evidence/build-latency.json`. **Production Browser Run timings will differ** (Phase 07 measured the local
Browser Run proxy as slower than direct Chromium because textures cross the CDP socket).

Observed issue for Phase 07: after a failed build, a retry within 120 s gets the same failed `jobId` (the in-flight
dedupe key isn't cleared on error), so the user sees the same error again.

## 4. Bundle (task 2)
`node infra/scripts/bundle-report.mjs` (sizes in KiB; gzip level 9 / brotli computed by the script; Cloudflare
compresses static assets on the fly).

| | Before (main, `vite build`) | After (this branch) |
|---|---|---|
| Entry chunk loaded by **every** route | `index` 1,459 kB (440 kB gz) — three.js, engine, game, controller, /about | `index` 5.6 KiB + `vendor-react` 297 KiB (95 KiB gz) |
| Phone controller `/c/:code` total transfer | ≥ 440 kB gz of JS (the whole entry chunk) | **147 KiB** (Lighthouse), no three.js, no Rapier |
| Rapier copies in `dist` | 2 chunks (deterministic 2.9 MB + standard 2.9 MB) + both inlined in the physics worker (5.9 MB) | 1 chunk (2.8 MB, 1.07 MB gz) + worker 2.9 MB (only with `?physics=worker`) |
| Rapier copies loaded on the default game path | 1 (code inspection: the worker chunk is requested only with `?physics=worker`) | 1 (verified: `evidence/route-chunks.txt`) |

What changed: every page is a lazy route (`apps/web/src/routes.tsx`); `vendor-three` and `vendor-react` are
stable chunks; `@dimforge/rapier3d-compat` (the non-deterministic build, used only by the physics package's Node
benchmark) is aliased to a stub in the web build. On the default (lockstep) path the physics worker chunk is never
requested. Game route JS, gzip: vendor-react 95 + GameApp 56 + vendor-three 241 + engine 23 + schema/zod 27 +
physics 11 + **Rapier 1,069** KiB. Rapier's inlined base64 WASM was then the dominant download (done in 12b, below).
i18n (en + ja strings) is ~18 KiB raw inside GameApp; not worth a separate request.

**Phase 12b task 5: Rapier as a `.wasm` asset, loaded only when a stage loads.** A Vite plugin
(`rapierWasmAsset` in `apps/web/vite.config.ts`, page + physics-worker bundles) rewrites the compat package's one
`init()` argument (the 2.7 MB base64 literal) to the URL of the package's byte-identical
`dist/rapier_wasm3d_bg.wasm`, emitted as a hashed asset; wasm-bindgen then fetches it with
`WebAssembly.instantiateStreaming` (served as `application/wasm`; the CSP's `'wasm-unsafe-eval'` covers it). Node
and workerd (`loadRapier({ wasmModule })`) still use the untouched package. The game now creates its physics driver
when the first stage starts building (`#ensureDriver` in `apps/web/src/game/game.ts`, in parallel with the build),
so the title/attract (`/`) never downloads Rapier. Measured on `vite preview` builds with Playwright (every
same-origin response, gzip level 9 / brotli computed per body; `infra/perf/transfer.mjs`, same logic as
`infra/perf/requests.mjs`):

| KiB | Before (12b) | After (12b) |
|---|---|---|
| `/` (title + attract stage): JS gz / all transfer gz | 1,598 / 1,681 (Rapier included) | **529 / 612** (no Rapier) |
| `/play/practice` to phase `play` (lockstep, default): all transfer gz | 1,625 | **1,334** |
| `/play/practice?physics=worker` to `play`: all transfer gz | 1,664 | **1,372** |
| Rapier on the game path, raw / gz / br | `rapier` chunk 2,822 / 1,069 / 786 | `.wasm` 2,000 / 750 / 549 + `rapier` glue chunk 154 / 28 / 24 |
| Physics worker chunk (only `?physics=worker`), raw / gz | 2,949 / 1,108 | 281 / 67 (+ the same `.wasm`) |

Rapier on the game path: 1,069 → 778 KiB gz (−27 %), 786 → 572 KiB br; the WASM compiles while it streams instead
of after a base64 decode on the main thread.

## 5. Core Web Vitals (lab) — Lighthouse 12.8.2
`node infra/perf/lighthouse.mjs` against the local production build. Mobile = Lighthouse default (Moto G Power
emulation, simulated slow 4G, 4× CPU); desktop preset. **Lab data only** (no field data exists for an undeployed
site); INP needs real interactions, so TBT is its lab proxy. The select screen is a state inside `/`, not a URL,
so it isn't separately auditable here.

| Page | Preset | Perf | LCP | FCP | TBT | CLS | Transfer | A11y | Best pr. |
|---|---|---|---|---|---|---|---|---|---|
| `/` (title, attract mode) | mobile | 77 | 4.39 s | 3.41 s | 70 ms | 0 | 1,940 KiB | 100 | 96 |
| `/` | desktop | 92 | 1.86 s | 0.73 s | 0 ms | 0 | 1,940 KiB | 100 | 96 |
| `/about` | mobile | 77 | 4.06 s | 3.99 s | 0 ms | 0.018 | 488 KiB | 100 | 100 |
| `/about` | desktop | 98 | 0.85 s | 0.82 s | 0 ms | 0.043 | 488 KiB | 100 | 100 |
| `/c/123456` (phone controller) | mobile | 98 | 2.13 s | 1.82 s | 0 ms | 0 | 147 KiB | 100 | 96 |
| `/c/123456` | desktop | 100 | 0.49 s | 0.41 s | 0 ms | 0 | 147 KiB | 100 | 96 |
| `/log` | mobile | 69 | 4.23 s | 4.00 s | 0 ms | 0.167 | 529 KiB | 100 | 100 |
| `/log` | desktop | 89 | 0.86 s | 0.84 s | 0 ms | 0.204 | 529 KiB | 100 | 100 |

Findings (Phase 12 run): "Best practices" 96 on `/` and `/c` was the DevTools issue raised by zod's
`new Function` feature probe being blocked by the CSP (see §6). `/log` had a CLS of 0.17–0.20. Mobile LCP ≈ 4 s on
the showcase pages is font + CSS loading under slow 4G.

**Phase 12b re-run** (same machine, same script, `evidence/lighthouse-12b.json`), after zod jitless (contracts
v0.2.7), Rapier deferred to stage load (§4) and metric-matched fallback fonts on the showcase pages:

| Page | Preset | Perf | LCP | FCP | TBT | CLS | Transfer | A11y | Best pr. |
|---|---|---|---|---|---|---|---|---|---|
| `/` (title, attract mode) | mobile | 74 | 4.40 s | 3.41 s | 79 ms | 0 | **874 KiB** | 100 | **100** |
| `/` | desktop | 98 | 0.99 s | 0.76 s | 0 ms | 0 | **874 KiB** | 100 | **100** |
| `/about` | mobile | 77 | 4.07 s | 3.99 s | 0 ms | 0 | 488 KiB | 100 | 100 |
| `/about` | desktop | 99 | 0.86 s | 0.82 s | 0 ms | 0.006 | 488 KiB | 100 | 100 |
| `/c/123456` (phone controller) | mobile | 98 | 2.13 s | 1.82 s | 0 ms | 0 | 147 KiB | 100 | **100** |
| `/c/123456` | desktop | 100 | 0.49 s | 0.41 s | 0 ms | 0 | 147 KiB | 100 | **100** |
| `/log` | mobile | **86** | 3.32 s | 3.09 s | 0 ms | **0.063** | 539 KiB | 100 | 100 |
| `/log` | desktop | **99** | 0.86 s | 0.84 s | 0 ms | **0.003** | 539 KiB | 100 | 100 |

- **`/log` CLS cause** (found with a `layout-shift` observer, `evidence/cls-csp-12b.txt`): not the images (they are
  lazy and far below the fold) but the **web-font swap**. fontsource declares `font-display: swap`; Georgia is
  wider than Newsreader at the page's optical sizes, so the lede re-wrapped by one line (33 px) when Newsreader
  arrived and pushed everything below it, and the nav changed width with Instrument Sans. **Fix**
  (`apps/web/src/pages/about/showcase.css`): `"Newsreader Fallback"` = `local(Georgia)` with `size-adjust: 92%`,
  `ascent-override: 80.4%`, `descent-override: 28.3%`, and `"Instrument Sans Fallback"` = `local(Arial)` with
  `size-adjust: 101.7%`, `ascent-override: 95%`, `descent-override: 24.5%`, placed in the font stacks right after
  the web fonts. Tuned by comparing every text block's box with the web fonts blocked vs loaded (1350 px and 412 px
  wide): identical line counts afterwards. The remaining 0.063 on mobile is one paragraph during a transient state
  where only some of Newsreader's subset files have arrived (below the 0.1 "good" threshold). Fallback metrics only
  apply where Georgia/Arial exist (macOS, Windows, iOS); Android falls through to its own serif unchanged.
- `/` transfer 1,940 → 874 KiB: Rapier is no longer downloaded for the title/attract screen (§4).
- "Best practices" is 100 everywhere: the zod `eval` probe is gone (§6).
- Not fixed, found on the way: `/making` has CLS ≈ 0.07 (412 px) / 0.14 (1350 px) from its chip row re-wrapping and
  the demo canvas resizing after load (Phase 10 page; not in the Lighthouse set). Tracked in
  docs/build-log/phase-12.md "open".

## 6. Security headers and CSP check
Method: `infra/perf/frames.mjs` registers a `securitypolicyviolation` listener on every page and stage run;
`infra/scripts/smoke.mjs` checks the headers.
- Pages `/`, `/about`, `/making`, `/log`, `/c/:code`, `/p/:code` and all 6 stage runs: **no console errors**, and
  (Phase 12) **one CSP report per page load**: `script-src eval` from zod's `allowsEval` probe (`new Function('')` in a
  try/catch; zod then uses its interpreted path, so behaviour is unchanged).
- **Phase 12b: fixed.** `@wwm/schema` now calls `z.config({ jitless: true })` (contracts v0.2.7, CCR-12-1), which
  skips the probe. Production build, `securitypolicyviolation` listener: **0 reports** on `/`, `/c/123456`, `/about`,
  `/log`, `/making` at 1350 px and 412 px (`evidence/cls-csp-12b.txt`); Lighthouse "Best practices" 100 on `/` and
  `/c` (was 96). Unit test: `packages/schema/test/limits.test.ts` spies on the `Function` constructor while parsing.
- The strict policy (`style-src 'self'` without `'unsafe-inline'`, `script-src 'self' 'wasm-unsafe-eval'`) caused
  no other violation, including WebGPU rendering, the builder and physics workers, fonts and textures.
- Smoke test of the staging config (stats gate on 404, cross-site POST 403, API CSP): 7/7 PASS
  (`evidence/smoke-local.txt`).

## 7. Load tests (task 4) — local only
### 7.1 Rooms relaying 60 Hz input (`tests/load/rooms.mjs`)
Node load generator (built-in WebSocket) and `wrangler dev --env staging` on the same machine. Per room: one host
and one controller socket, 12-byte INPUT frames at 60 Hz, host `state` at 4 Hz, pings answered. Relay latency =
controller send → host receive (same clock). `--spoof-ips` gives each room its own `cf-connecting-ip` so the
per-IP room limits don't cap the test (only possible locally).

| Rooms | Duration | Frames sent | Delivered in run | Relay latency p50 / p95 / p99 | Relay rate-cap drops |
|---|---|---|---|---|---|
| 25 | 20 s | 30,000 | 100 % | 1.6 / 56 / 88 ms | 0 |
| 50 | 20 s | 60,000 | 100 % | 5.0 / 104 / 184 ms | 0 |
| 100 | 20 s | 120,000 | 100 % | 4.5 s / 8.8 s / 9.2 s | 0 |
| 200 (run 1) | 30 s | 360,000 | 33.8 % within run + 1 s | 10.1 s / 19.7 s / 20.7 s | — |
| 200 (run 2) | 30 s | 360,000 | 100 % (eventually) | 33 s / 63 s | 0 |

All 200 rooms were created and all 400 sockets opened and stayed open; the Room DO's new rate cap dropped nothing
(60 Hz is well under its 150/s budget). **The local limit is the single workerd process on one machine**, which
saturates between 50 and 100 rooms (≈ 6,000–12,000 relayed frames/s in and out); beyond that, frames queue.
On Cloudflare each room is its own Durable Object, placed near its first client, so this local ceiling says
nothing about production capacity. **The 200-room test must be re-run against staging** (the script takes any
base URL; without `--spoof-ips` a single load generator is limited to 30 rooms per minute by design, see below).

Rate limit check (no spoofing): 40 room creations in 1 s from one IP → **30 created, 10 × 429** with
`Retry-After: 60` (`evidence/load-rooms-ratelimit.txt`).

### 7.2 Burst of 50 concurrent new-URL builds (`tests/load/builds.mjs burst`)
50 distinct URLs on a local fixture site (so no real site is hammered), `wrangler dev` with that loopback host
allowed, local Browser Run Chrome, real builder.

| Config | POST results | Job outcomes | Time to `done` p50 / p95 |
|---|---|---|---|
| Default limits (10 builds / hour / IP) | **10 × 202, 40 × 429** `RATE_LIMITED` "at most 10 new builds per hour" | 10 done | 11.4 s / 18.6 s |
| Per-IP limit raised to 1000 (exercises the browser semaphore, `BROWSER_MAX_CONCURRENCY` = 2) | 50 × 202 | **10 done, 40 × `CAPTURE_TIMEOUT`** | 11.7 s / 19.7 s |

The per-IP limit degrades as designed. The semaphore run exposed a real issue (Phase 07, `pipeline.ts`): the
20 s capture budget started **before** waiting for a browser slot, so queued jobs timed out with `CAPTURE_TIMEOUT`
("capture exceeded its time budget") instead of waiting or failing with `RATE_LIMITED`. With 2 slots and ~4 s per
capture, only ~10 of a 50-job burst could finish inside 20 s. In the UI all of these land on the build-error screen
with the featured stages as alternatives (covered by the e2e test "build failure → fallback screen → curated
alternative plays"). The new global cap (`GLOBAL_BUILD_LIMIT_PER_HOUR`) wasn't reached in this test.

**Phase 12b fix and re-run.** The job now waits for a browser slot first (it stays `queued`; after 45 s without a
slot it ends with `RATE_LIMITED` "all capture browsers are busy"), and the capture (20 s) and slice-0 (30 s)
budgets start once the slot is held. A job that fails before `done` also deletes its own `job:<key>` dedupe entry,
so a retry starts a fresh job. Same machine and command, per-IP limit 1000, `BROWSER_MAX_CONCURRENCY` = 2, plus
`--retry-failed 5` (re-POST 5 failed URLs right after the burst), run once on the old `pipeline.ts` and once on the
new one (`evidence/load-builds-semaphore-12b-{before,after}.json`):

| `pipeline.ts` | Job outcomes (50 × 202) | `done` p50 / p95 | Retry of 5 failed URLs |
|---|---|---|---|
| before (Phase 12) | 10 done, **40 × `CAPTURE_TIMEOUT`** | 12.3 s / 20.5 s | **5 of 5 got the failed job back** (replayed `CAPTURE_TIMEOUT`) |
| after (12b) | **27 done**, 23 × `RATE_LIMITED` "all capture browsers are busy", **0 × `CAPTURE_TIMEOUT`** | 25.1 s / 45.8 s | 5 of 5 fresh jobs, **5 done** |

Worker log for the "after" run: queue wait p50 18 s, max 43.5 s; capture itself p50 3.0 s, max 3.6 s (it never came
near its 20 s budget). Throughput is bounded by the 2 local browser slots (≈ 0.5 captures/s); the 45 s queue limit
turns the rest into a clear, retryable busy error. On Browser Run the slot count is the account's concurrency
limit.

### 7.3 Kill switch
With KV `kill:capture` set: a cached URL still returns its run (200), a new URL gets `429 RATE_LIMITED`
"building new sites is paused right now; play a featured site" with `Retry-After: 3600`, `/api/curated` still
answers (`evidence/kill-switch.txt`).

## 8. Reproduce
```sh
pnpm --filter @wwm/web build
(cd apps/worker && npx wrangler dev --env staging --port 8899)          # production-like build + headers
node infra/perf/frames.mjs http://localhost:8899 --throttle 1,4,6       # §1–2, §6
node infra/perf/lighthouse.mjs http://localhost:8899                    # §5
node infra/perf/requests.mjs http://localhost:8899                      # §4 chunk check
node tests/load/rooms.mjs http://localhost:8899 --rooms 200 --spoof-ips # §7.1
(cd apps/worker && npx wrangler dev --port 8898 --var DEV_ALLOWED_HOSTS:127.0.0.1:8897)
node tests/load/builds.mjs burst http://localhost:8898 --retry-failed 5 # §7.2 (add --var BUILD_LIMIT_PER_HOUR:1000)
node tests/load/builds.mjs latency http://localhost:8898                # §3 (raise BUILD_LIMIT_PER_HOUR)
node infra/scripts/bundle-report.mjs                                    # §4
node infra/perf/transfer.mjs http://localhost:4311                      # §4 12b (vite preview of a build)
```
