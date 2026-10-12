# Home page performance execution plan

Status: runtime implementation and matched local evidence completed October 9, 2026; hosted review preparation is in progress. See [implementation results](home-performance-implementation.md) and [raw evidence](evidence/home-performance-2026-10-09/README.md). This plan retains its original proposed budgets. Cold native first-feedback and early-Start-to-play budgets remain open; physical-device and visual acceptance, production merge and deployment remain pending.

Make the home page responsive before the full game loads, give Auto a bounded graphics cost from its first allocation, and avoid repeatedly drawing a settled title scene. Implement graphics limits first, progressive loading second, and idle rendering third. Measure each against a fresh baseline, then give Eric a hosted preview to choose the visual treatment and judge playability.

## Evidence and success targets

The October 9 live audit used headed Chromium 153 on an M5 Max with native Metal. Values below are medians of three per-run measurements. They identify opportunities; they do not establish an accepted minimum device. The live deployment did not expose an exact commit, so local HEAD `7b233d54166f4df2abf65542390a4b3663a5906b` must not be presented as its deployed SHA.

| Priority | Measured baseline | Proposed engineering target |
|---|---|---|
| 1. Bound graphics immediately | Auto title at 1440 × 900 CSS pixels, DPR 2: GPU p50 13.11 ms, 47 draws, 220.14 MiB tracked renderer allocations. Existing Low: 0.52 ms, 22 draws, 49.51 MiB. | Auto and Low title: at least 80% less GPU time than the matched baseline, tracked allocations ≤60 MiB at that viewport, and no initial allocation of the expensive high profile. |
| 2. Load an interactive title first | Cold 390 × 844 / DPR 2 / CPU 6× / 1.6 Mbps / 150 ms latency: LCP 4.764 s, Start available 4.301 s, attraction prepared 8.190 s. Home downloads about 662 KiB compressed JavaScript. | Same headed profile: LCP ≤2.5 s, Start accepts intent ≤2 s, initial shell JavaScript ≤250 KiB compressed. Deferred game loading must not worsen total time to actual control. |
| 3. Stop settled title rendering | Auto title main-thread busy time 5.93%. A diagnostic that suppressed engine frames reached 1.76%, while retaining the high profile's allocations. | Cached title: no scene submissions after settlement; native reference main-thread busy time ≤2%; visible response to wake or Start ≤100 ms at p95. Compare 10/15/30 FPS alternatives for Eric's review. |

Renderer allocation estimates are not physical VRAM or process memory. GPU p95 came from sparse timestamp samples and is diagnostic. The frozen measurement was an experiment, not an implemented scheduler. Savings from graphics and idle rendering overlap and must not be added together.

Gameplay targets follow the existing [device matrix](performance-device-matrix.md): aim for 60 FPS, with a proposed lower-tier fallback of p95 frame interval ≤33.3 ms and p99 ≤50 ms after warm-up, plus local POWER/JUMP/pause response ≤100 ms at p95. Use 33.3 ms rather than the assessment's looser 40 ms screening tolerance. These remain proposed product budgets until Eric accepts the physical device floor. Record submitted frames separately from input-loop rAF callbacks; idle title FPS is not a gameplay acceptance metric.

## Implementation sequence

Use one isolated worktree and branch, suggested name `codex/home-performance`, with one reviewable commit per stage. Preserve the current checkout's unrelated catalog integration-test edit. Keep existing visual design, stage geometry, scoring, input semantics and 120 Hz simulation as invariants.

| Stage | Main deliverable | Dependency and completion gate |
|---|---|---|
| 0 | Reproducible baseline and additional probes | Required before changing runtime code. |
| 1 | Bounded graphics policy and graphics preference | Initial and steady graphics targets pass; transition resources remain bounded. |
| 2 | Lightweight title with progressive game loading | Loading and early-Start targets pass without moving a regression into first play. |
| 3 | Settled-title rendering policy and comparison variants | Idle and wake targets pass; transitions and pending work still complete. |
| 4 | Combined evidence and hosted review preview | Correctness, resource and regression checks pass together. Eric evaluates feel and visuals. |

Stage 2 has the largest implementation uncertainty because the existing title, settings and game context share the full game module graph. Stage 3 depends on an explicit animation-settlement contract. Evaluate each stage before expanding its scope; retain the previous passing commit as the rollback point.

### Stage 0 Establish a fresh comparison

1. Create the isolated checkout from the current agreed baseline. Record its SHA and runtime fingerprint. Build and serve production assets using `infra/perf/p1-build.mjs`; verify the actual served asset hashes before timing.
2. Port the October audit's runtime, startup and play probes into opt-in `infra/perf/` tooling with configurable `AUDIT_BASE` and `AUDIT_OUT`. Retain the original audit output. Each new collection uses a fresh directory and records browser, backend, hardware, viewport, DPR, network, cache, quality, fixture and trial order.
3. Collect three trials for native desktop DPR 1/2, desktop CPU 6× with 10 Mbps / 100 ms, and mobile viewport CPU 6× with 1.6 Mbps / 150 ms. Alternate baseline and candidate order for comparisons. Keep cold and warm results separate, including outliers and invalid runs with their reasons.
4. Add the measurements missing from the audit: renderer allocation peak from construction onward; first shell interaction; early Start before engine/attraction readiness; Start through first visible playable frame and first successful POWER/JUMP; actual GPU scene submissions; title settlement and wake response. Attribute download, compilation, worker preparation and rendering separately.
5. Establish the first-control baseline before choosing a loading policy. The candidate's navigation-to-control and early-Start-to-control medians and p95 must not regress beyond measurement noise; investigate differences using the repository comparator's review threshold rather than silently moving startup work behind Start.

Early Start should be tested as soon as the button appears, during deferred import, during worker preparation and after readiness. Existing audit clicks occurred after attraction preparation and cannot prove these paths work. Include a sound-enabled first gesture; reject measurements contaminated by unrelated gestures.

**Deliverable:** baseline manifest, raw measurements, summary and missing-metric probes. Diagnostics remain outside the normal production module graph; no new always-on telemetry is needed.

### Stage 1 Bound graphics from the first frame

Primary files: `packages/engine/src/quality.ts`, `packages/engine/src/engine.ts`, `apps/web/src/game/game.ts`, `apps/web/src/ui/Settings.tsx`, and corresponding English/Japanese strings and preference storage.

1. Separate the saved graphics preference from the effective render profile for a game phase. Start Auto's title with the existing Low feature set: no bloom, FXAA or recurring environment-map updates; retain the rich background and required gameplay objects; cap the drawing buffer at 1920 × 1080 pixels. Apply it before postprocessing targets are constructed.
2. Keep every graphics profile finite. Start with a proposed 2560 × 1440 ceiling for High and Medium, and existing smaller Low/minimum-tier ceilings. Measure large-window and DPR changes before accepting these caps; the ≤60 MiB target applies to the specified Auto/Low title case, not every scene or manual High.
3. Initialize Auto's first gameplay session conservatively, then let the existing elapsed-time ladder recover during real active play. Preserve hysteresis and manual overrides. Do not reset the ladder on every phase change or treat an intentional 30/15 FPS menu cadence as rendering pressure against the ladder's 45 FPS threshold.
4. Expose Auto, Low, Medium and High in settings with a validated persisted preference and an invalid-storage fallback. Keep the shell and game settings consistent. Manual High remains an explicit choice within its pixel cap; Auto and Low are the performance-target paths.
5. Preserve disposal and asynchronous compilation guards when profiles change. Test resize, DPR changes, High→Low→High, transitions into play, hidden/resume and disposal while compilation is pending. Do not leave the high profile's unused targets allocated after a downgrade.

**Verification:** extend the existing quality tests in `packages/engine/test/index.test.ts` for initial Auto policy, finite pixel caps, recovery, suspended menu timing and manual overrides. Add integration coverage for first-allocation policy, preference round trips and transition cleanup. Measure GPU time with the same instrumented scene and supported backend, then repeat without invasive profiling to check instrumentation effects.

**Exit gate:** matched Auto/Low title GPU p50 improves ≥80%, steady tracked allocations ≤60 MiB at 1440 × 900 / DPR 2, and construction never instantiates the former high profile. Measure absolute peaks separately from steady values. Gameplay, geometry and replay remain unchanged.

### Stage 2 Make the title interactive before loading the game

Primary files: `apps/web/src/routes.tsx`, `apps/web/src/ui/GameApp.tsx`, `apps/web/src/ui/Screens.tsx`, shared title/settings components, and `apps/web/src/game/game.ts` startup and attraction cancellation.

1. Introduce a small home route component with the existing title, navigation, language, sound preference and settings. Extract presentational parts with explicit props; importing the current `Screens.tsx` or game context wholesale would pull the game graph back into the shell.
2. Render a lightweight background immediately. Compare a cheap CSS treatment with a cached image of the existing scene if needed. Keep a stable layout and existing design identity. Check the candidate's actual LCP element and image/font bytes rather than measuring only JavaScript.
3. Load the full game dynamically after shell paint or on Start. Test both idle preparation and intent-triggered preparation on the slow profile; select the strategy that preserves immediate response and total time to control. Background preparation must yield to user intent and must not recreate the current heavy startup burst immediately after first paint.
4. Accept Start once the shell is interactive. Paint onboarding or a clear preparing state within 100 ms at p95 while imports, engine preparation or workers finish. Carry one pending start intent into the mounted game; repeated clicks cannot create duplicate games, workers, stages or recordings. Preserve keyboard focus and sound-unlock behavior across the handoff.
5. Cancel attraction work when play takes priority. Cover navigation away, failed imports, failed workers, retry, disposal and returning home. Maintain the existing abort/phase checks around `#loadAttract`; a late title stage must never replace an active play stage.
6. Preserve direct `/play/:stageId`, `/play/local`, `/p/:code`, race and other routes. Keep the phone-controller route independent of the game runtime. Confirm language, reduced motion, graphics preferences and normal analytics consent survive the shell handoff.

**Verification:** inspect the production import graph and network requests for a genuinely smaller shell. Count all JavaScript required through shell interactivity, including automatically initiated dependencies, using a consistent compression method. Report deferred bytes and eventual totals separately. Exercise early Start at every loading milestone, offline/error/retry, navigation and sound-enabled first interaction.

**Exit gate:** under the same cold headed mobile stress profile, LCP ≤2.5 s, Start accepts intent ≤2 s, shell JavaScript ≤250 KiB compressed, visible feedback ≤100 ms at p95, and first-control timings do not regress against Stage 0. Also rerun Lighthouse as a separate simulated benchmark; do not mix its numbers with headed throttling.

### Stage 3 Render the title only while it needs frames

Primary files: `apps/web/src/game/render-cadence.ts`, `apps/web/src/game/game.ts`, and the engine's animation/readiness contract. Existing tests live in `apps/web/test/render-cadence.test.ts`.

1. Add an explicit settled/needs-frame signal for the title. Complete camera blends, stage preparation, shader preparation and pending animations before entering idle. A fixed timeout alone is insufficient: some engine-frame work completes promises used by stage transitions.
2. Retain the last canvas image once the title settles and skip scene submissions. Initially keep the existing input/game loop so gamepad detection, connection handling and pending intents remain responsive. Further polling reduction is optional only after a measured need; it is not required for the first implementation.
3. Invalidate the cached title on stage completion, resize/DPR change, graphics or visual-setting changes, relevant camera/scene changes, and visibility resume. Start and phase changes wake immediately. Reset timing so an idle gap cannot become a simulation jump or a large animation delta.
4. Preserve the current full-rate transition window and active gameplay cadence. Preserve hidden-tab cancellation. Do not apply cached-title behavior to playing, falling or unresolved loading transitions.
5. Provide preview-only comparison modes: cached title and bounded-quality ambient animation at 10, 15 and 30 FPS. Respect reduced motion. Use measurements to identify eligible modes, then let Eric choose the visual treatment; do not automatically declare the cheapest variant the best experience.

**Verification:** add cadence tests for settlement, invalidation, immediate wake, pending animations, one active loop and visibility resets. Measure a 60-second settled title in each variant, then Start, settings, resize and background/resume. Count actual scene submissions; a continuing input rAF loop must not be reported as scene FPS.

**Exit gate:** cached mode has zero scene submissions after settlement, native reference main-thread busy time ≤2%, wake/Start feedback ≤100 ms at p95, and no stuck transition or unresolved stage operation. Measure the combined Low-plus-cached result rather than adding the separate audit savings. Ambient modes have their own measured cost and remain review choices.

## Combined validation and review

Run the three changes together on the production build and retain a summary for each milestone. Core reproduction commands already exist:

```sh
node infra/perf/p1-build.mjs
pnpm --filter @wwm/web preview --host 127.0.0.1 --port 4318
```

While that server runs, collect each mode into a fresh output directory:

```sh
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT=/tmp/wwm-home-perf-candidate-unique node infra/perf/audit-2026-09.mjs frames
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT=/tmp/wwm-home-perf-candidate-unique node infra/perf/audit-2026-09.mjs gpu
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT=/tmp/wwm-home-perf-candidate-unique node infra/perf/audit-2026-09.mjs replay
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT=/tmp/wwm-home-perf-candidate-unique node infra/perf/audit-2026-09.mjs lifecycle
```

Replace `candidate-unique` with a new run identifier; never overwrite accepted baseline evidence. The new home/startup probes added in Stage 0 supplement these collectors.

| Gate | Required evidence |
|---|---|
| Repository correctness | `pnpm check` and `pnpm docent:index --check`; focused quality, cadence and loading tests pass. |
| Simulation and replay | Established reference: 5,429 ticks, score 1,484, one saved replay at native / 6× / 20× CPU stress; unchanged physics, inputs and recording. |
| Normal and large stages | Same input/camera workload on practice, HN, GOV.UK, MDN, gallery and a Wikipedia slice, 60 seconds each; required objects readable at every candidate tier. |
| Resources | 15 retries, fixture tour and route disposal; strict post-warm-up resource plateau from `performance-regression.md`, including intermediate checkpoints. High→Low leaves no extra render targets relative to fresh Low; retain the existing allowance only for non-target state. |
| Frame and interaction regressions | Matched p50/p95/p99, missed frames, long tasks, first-control and POWER/JUMP/pause timings. Investigate candidate p95 beyond baseline ×1.2 +2 ms; that review tolerance does not replace product targets. |
| Loading and idle | Cold/warm profiles, peak allocations, early Start, 60-second title variants, resize, background/resume and settings round trips. |
| Backend coverage | Native reference GPU plus WebGL2 fallback; physical Safari and weaker hardware recorded separately. Unsupported GPU timestamps are unavailable, not zero. |

The existing performance-staging workflow is restricted to `codex/performance-p1-staging`. A new branch will not automatically receive that workflow's gates. Reuse its comparator locally and either adapt the workflow narrowly for this branch or attach equivalent evidence to the PR; confirm which checks actually ran.

### Hosted preview and Eric's review

After the combined gates pass, prepare a draft PR and an isolated assets-only preview using the existing branch `workflow_dispatch` flow in `.github/workflows/ci.yml` (`deploy_preview`, a descriptive `preview_name`). Verify the returned preview URL and `/api/health` against the exact candidate SHA. Attach the evidence and identify cached/10/15/30 FPS comparison links clearly. Do not reuse an old preview as proof of a new build.

Eric's review should cover:

- Cold launch and immediate Start: the page responds and preparation communicates progress.
- Cached versus ambient title: first impression, motion, sharpness, contrast and scene identity.
- Low and Auto gameplay: marble tracking, portals, locks, HUD, POWER/JUMP, camera transitions and quality recovery.
- Settings, keyboard/gamepad/touch, sound, language, resize and background/resume.

Nominate an available older integrated-GPU laptop and available Android/iOS phones before claiming a supported hardware floor. Run the device matrix, including 15-minute thermal play. The assets-only preview supports offline fixture review; connected pairing and dynamic APIs require a separate enabled environment. Direct phone gameplay and phone-controller use remain separate acceptance rows.

### Completion and release boundary

The implementation is review-ready when the measured gates pass, evidence matches the candidate source, the preview is usable, and Eric can compare the visual modes. It is accepted for release after Eric chooses the title behavior and the nominated device results satisfy the agreed floor. Record any unresolved device row explicitly.

Production merge and deployment are subsequent release actions. Recheck the exact PR head, CI and deployment workflow, then verify deployed assets and rerun the critical cold-start/Start/idle smoke checks. A merged PR or local passing build does not establish production performance. Roll back to the previous passing implementation if combined loading, first-control, resource or gameplay behavior regresses.

## Evidence references

- October 9 companion assessment and raw artifacts: local folder `wwm-home-performance` in this chat's visualization output; `summary.json`, `runtime.json`, `startup.json`, `play.json`, Lighthouse reports and `live-asset-manifest.json`. Preserve this bundle and include its manifest when importing evidence into the implementation PR.
- [Performance device matrix](performance-device-matrix.md): proposed physical-device budgets, scenarios and acceptance rows.
- [Performance regression checks](performance-regression.md): source binding, replay/resource gates and comparator semantics.
- [Device capture guide](performance-device-capture.md): portable collection and incomplete-evidence handling.

This planning change adds no game code and makes no claim that the proposed improvements have shipped.
