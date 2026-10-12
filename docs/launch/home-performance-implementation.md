# Home performance implementation and review

Implemented in `codex/home-performance`, based on `7b233d54166f4df2abf65542390a4b3663a5906b`. The measured runtime is `58ef36928c1b7646d29ab0403ffff3a46135244e`, fingerprint `a8b7307d846fccd9558660720b0427b98e9214422123ee936f0998aa1af88171`. Documentation and collector-only commits do not change that fingerprint.

## Results against matched local production builds

The same headed Chromium 153 / native Metal / M5 Max / local gzip server was used for both arms. These are fresh local comparisons, separate from the original live deployment audit and Lighthouse simulation. Three trials are retained per short runtime, load/cache and early-Start profile; medians below are medians of per-run measurements, not pooled frame distributions.

| Improvement | Baseline | Candidate | Result |
|---|---:|---:|---|
| Auto title GPU p50, 1440 × 900 / DPR 2, ambient ≤30 FPS | 12.85 ms | 0.59 ms | 95.4% lower per submitted frame |
| Same title tracked renderer allocations | 220.14 MiB | 49.33 MiB | Under the proposed 60 MiB ceiling |
| Cold mobile stress: Start available | 4.04 s | 1.42 s | Meets the proposed 2 s lab budget |
| Cold mobile stress: LCP | 4.48 s | 1.88 s | Meets the proposed 2.5 s lab budget |
| Initial shell JavaScript, gzip | 592.4 KiB | 145.0 KiB | Includes initiated JavaScript resources through interactivity |
| Cached title, 60-second observation | Repeated scene drawing | 0 scene frames; 1.73% busy | Settings wake p95 50 ms over 30 changes |

Renderer counters are allocation estimates, not physical VRAM. Peaks are sampled every 100 ms; initial tier and every canvas dimension write are retained separately. GPU timestamps are sparse diagnostics. Cached idle has no submitted scene frames and therefore no GPU timestamp samples; it is not measured as zero total GPU work. The graphics and cached-rendering gains overlap.

## Loading and total time to play

Cold mobile stress means 390 × 844 CSS pixels, DPR 2, CDP CPU 6×, 1.6 Mbps, 150 ms latency. Cold and warm are separate; warm is a same-context reload. The server gzip-compresses HTML/JS/CSS/JSON/SVG identically in both arms, but does not compress WASM. Cloudflare transfer encoding and latency can differ.

| Cold profile | Start baseline → candidate | LCP baseline → candidate | FCP baseline → candidate |
|---|---|---|---|
| desktop-native | 0.07 s → 0.03 s | 0.14 s → 0.93 s | 0.10 s → 0.08 s |
| desktop-cpu6-10Mbps | 1.30 s → 0.63 s | 1.53 s → 1.91 s | 1.30 s → 0.73 s |
| mobile-cpu6-1.6Mbps | 4.04 s → 1.42 s | 4.48 s → 1.88 s | 4.05 s → 1.52 s |

LCP does not improve on the desktop profiles. The candidate's animated wordmark becomes the qualifying LCP element; the baseline commonly records the caption. All three candidate profiles are within the proposed 2.5 s LCP budget, while FCP and Start improve. JavaScript has been deferred: main-document JS through attraction preparation is about 654 KiB versus 649 KiB, not a reduction in eventual game bytes. Worker-internal imports are not fully represented in main-document Resource Timing.

| Earliest Start, sound enabled | Navigation → first playable frame, baseline → candidate | Start → play, baseline → candidate |
|---|---|---|
| desktop-native | 5.90 s → 6.11 s | 5.78 s → 6.05 s |
| desktop-cpu6-10Mbps | 7.66 s → 7.82 s | 6.14 s → 7.05 s |
| mobile-cpu6-1.6Mbps | 19.05 s → 17.50 s | 14.69 s → 15.68 s |

The mobile profile reaches play roughly 1.56 s earlier overall. Desktop total times vary by roughly 2–4%; the separate initial baseline batch is retained too. The earlier button means the wait after Start is longer on CPU/network stress: roughly 0.9–1.0 s in these matched medians. This is an explicit tradeoff, not hidden behind a loading metric. Every run confirms POWER + JUMP + tilt in the game's input recording.

**Open budget:** the first native sound-enabled gesture exceeds the proposed 100 ms feedback target in both arms (149.5 ms baseline, 171.9 ms candidate). Later native candidate trials are about 35–36 ms, desktop CPU 6× ≤57 ms, and mobile ≤49 ms. Preserve the cold outlier. The direct-play probe also observes a cold first-key audio-unlock long task; steady play and later input are separate. These are lab event/next-rAF proxies, not physical input-to-photon measurements or field INP.

## Implemented behavior

1. Auto starts at Low before the first drawing-buffer allocation. All profiles have finite pixel caps, and Auto/Low/Medium/High persist in settings in English and Japanese. Auto can recover resolution and reflections during real active play; intentional menu cadence does not drive the ladder down.
2. Home renders a lightweight title and settings before importing the game. It warms the runtime after paint and accepts one early Start intent. Intent-triggered imports start after the preparing UI paints, and physics warms in parallel after explicit Start. Shared gesture-unlocked audio survives the handoff. Settings changed during GPU initialization are reconciled. Failed module loading offers a reload that clears the browser's cached failed import.
3. The title retains its last canvas after loading, compilation, camera blends and required animations settle. Resize, visual settings, visibility resume and Start wake rendering. The input/gamepad loop and 120 Hz simulation remain intact. Preview-only cached/10/15/30 FPS modes support visual review; reduced motion forces cached mode.

The initial Auto recovery policy introduced 171–204 ms long tasks when bloom/MRT enabled, and a later 60-second diagnostic found another ~182 ms FXAA graph-rebuild pause. Auto now retains a single-color graph with both effects off throughout recovery. Manual Medium/High retain glow and FXAA. Superseded runs remain in the evidence bundle and are not used to validate the final runtime.

## Core play and Lighthouse checks

The six native 60-second fixture tours have candidate p95 frame intervals of 17.4–18.3 ms and p99 of 17.6–18.6 ms. Candidate WebGL2, CPU6 Wikipedia and CPU20 practice stress cases stay near 18.5–18.6 ms p95. The reference replay's CPU20 p95 improves from 33.4 to 18.6 ms and p99 from 34.3 to 33.3 ms, but it still has a 250 ms maximum interval and a 266 ms long task late in the run. These tails remain in the evidence; percentile budgets do not mean every frame is smooth. Native replay main-thread busy time increases from 8.18% to 11.19%, while CPU6 falls from 23.40% to 18.20% and CPU20 from 90.71% to 57.73%; the home improvements are not a universal gameplay CPU reduction.

Three pause/resume observations per short-play case complete after the steady window. Worst observed pause-to-next-rAF is 32.3 ms and resume-to-next-rAF is 13.6 ms. Sixty-second Auto CPU6 recovery reaches tier 0 in all three trials without the removed bloom/FXAA rebuild hitch; cold audio remains the separate first-input cost.

Lighthouse 13.5.0, three simulated trials per preset per arm, is retained separately:

| Preset | Performance score | LCP | TBT |
|---|---:|---:|---:|
| Mobile, baseline → candidate | 67 → 91 | 6.15 s → 2.87 s | 67.8 ms → 25.5 ms |
| Desktop, baseline → candidate | 96 → 97 | 1.20 s → 1.17 s | 0 ms → 0 ms |

Simulated mobile LCP remains above 2.5 s, although the headed mobile stress result is 1.88 s. Both are reported without treating the protocols as interchangeable. CLS remains about 0.00018 mobile / 0.00009 desktop.

## Title comparison choices

Each mode has three short trials plus one 60-second observation. Numbers here describe that long observation.

| Mode | Scene FPS | Main-thread busy | GPU p50 per submitted frame |
|---|---:|---:|---:|
| home-cached-dpr2 | 0.00 | 1.73% | Unavailable; no scene frames |
| home-ambient10-dpr2 | 9.71 | 3.23% | 0.52 ms |
| home-ambient15-dpr2 | 14.31 | 3.85% | 0.46 ms |
| home-auto-dpr2 | 27.41 | 5.30% | 0.46 ms |

## Validation and release boundary

- `pnpm check`: 1,646 passed, 43 skipped; typecheck and lint passed with existing warnings. Focused home browser tests: 3 passed. `pnpm docent:index --check` is current.
- Strict core comparator: **51/51 pass**. Both arms complete the same 5,429-tick / 1,484-score / one-saved-replay result at native, 6× and 20× CPU stress. Fifteen retries and seven fixture loads retain flat post-warm-up resource counters. High→Low retains two targets, matching fresh Low; non-target excess is 0.15 MiB, within the existing allowance. All core runs report zero browser errors.
- Default title wake: three short-window trials and a 60-second window each include 30 setting invalidations, retained separately from steady render cost.
- The primary checkout's unrelated catalog integration-test edit remains untouched.

Native rAF cadence varied around 60–120 Hz in diagnostics, so raw FPS is not used as causal proof of an optimization. The absolute interval budgets and source-bound comparisons are retained. Physical weak GPUs, Safari, thermal/battery behavior and Eric's feel/readability choice remain open device/product gates. Nominate an older integrated-GPU laptop and Android/iOS devices, then complete the device matrix and 15-minute thermal play before claiming a supported floor.

The draft PR carries the hosted preview URL, its verified exact commit and cached/10/15/30 FPS review links. CI and hosted functional results are checked separately from this local measurement bundle. The preview is assets-only and supports offline fixtures. Connected APIs and phone pairing require a separate enabled environment. Production merge/deployment are subsequent actions after review.

The companion evidence directory contains a compact per-trial summary, SHA-256 manifest and losslessly gzipped raw reports, including intermediate and rejected runs with reasons. Reproduction commands and collection order are retained there.
