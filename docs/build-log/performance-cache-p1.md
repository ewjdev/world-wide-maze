# Bounded screenshot retention and build cancellation — P1 #23

- Agent/tool: Codex (GPT-6), shell, Vitest and Playwright/CDP in isolated `codex/performance-cache-p1` worktree.
- Started September 27, 2026, approximately 20:35 UTC. Native evidence recorded at the timestamps in `docs/launch/evidence/performance-cache-p1/worker-tour.json`.
- Instruction: execute P1 performance epic work with subagents, validate each change and integrate only demonstrated improvement into a staging branch. No P2 implementation or deployment.

## Change and measured gain

The game builder retains decoded screenshots in a 32 MiB LRU cache instead of a lifetime-unbounded Map. Retention counts the entire typed-array backing buffer. Builds/decode are serialized so only one image can be active beyond retained cache data. Images larger than the budget are built but never retained. ImageBitmap and temporary canvas storage are released explicitly. Adjacent slices reuse a decoded image when it fits; a revisited evicted page decodes again.

The real Chromium module-worker probe ran two original/candidate pairs on the same six catalog captures, followed by an adjacent Wikipedia slice, an evicted HN revisit and its repeat, then two builds of a 40 MiB synthetic screenshot. It served the unchanged original worker from base `d88697f` and current worker source through Vite. The page contained only the worker probe. All 44 stage JSON hashes matched across variants, including oversize builds.

| Metric after the six-capture tour | Original, both pairs | Candidate, both pairs |
|---|---:|---:|
| Live decoded RGBA bytes, observed with WeakRef after worker GC | 113,843,200 | 30,720,000 |
| Dedicated worker CDP backing storage bytes | 117,253,017 | 34,140,257 |
| Same-page next slice | cache hit | cache hit |
| Live decoded bytes after HN revisit | 113,843,200 | 6,215,680 |
| Live decoded bytes after repeated oversized screenshot | 155,786,240 | 6,215,680 |

Retained decoded image bytes after the normal tour fell by **79.27 MiB / 73.0%**. Counter values agreed exactly with independently observed live buffer bytes. Candidate peak retained RGBA across every tour step was 30,720,000 bytes, below the 33,554,432-byte limit. Oversized images decoded twice and were released each time. Revisit wall time was roughly 141–146 ms in these samples; this change claims a retention improvement, not a CPU-throughput gain. The eviction tradeoff is a fresh decode on returning to old pages.

Raw evidence includes dedicated worker heap/backing storage separately from page heap, and renderer-process RSS only as an aggregate proxy. It records browser/hardware, base/current commit, dirty state and SHA-256 runtime content fingerprint. Host: Apple M5 Max / 128 GiB, Chromium 153, headed native Metal; this is not low-tier mobile or thermal acceptance. The 32 MiB bound covers retained decoded RGBA, not peak decode/bitmap/canvas or total process/GPU memory: one active oversized image can exceed that bound temporarily.

## Correctness and lifecycle

`AbortSignal` now reaches fixture builds and texture fetch/decode. Every pool request settles on abort, disposal, worker error/message error, initialization failure or posting failure. A sole obsolete request terminates its worker immediately, including synchronous builder CPU work. Concurrent surviving requests continue; stale worker messages cannot resolve newer work. Disposed pools reject future builds.

Attract, normal loads and retries share serialized world installation. The registered build token owns publication and delayed BUILT transitions. Both engine/physics loads settle before a failed/aborted install unloads its partial resources and releases the queue. New bitmaps are closed on cancellation; engine-owned retry bitmaps are preserved until replacement.

Focused validation:

- 27 unit checks passed across cache/LRU/oversize, serialized service, pool settlement, texture cancellation and existing stage/catalog tests.
- 3 browser race checks passed: cancelled fixture load and cancelled retry each hold the new world load for 2.5 seconds and assert the old generation cannot trigger BUILT; final stage matches the new generation. Disposal during a delayed failing world load triggers unload and closes its fresh bitmap.
- Web typecheck passed. Full repository check result is recorded below after completion.
- Regression tooling #28 has 14 controlled tests, including source freshness, missing scenarios, GPU identity and new/worse memory retention detection.

Peer review caught an unregistered retry controller and cleanup ordering after rejected asynchronous world loads. Both were fixed and locked down by the browser regressions before acceptance. One initial browser test timed out because its serialized practice catalog entry lost reference identity; the test now switches between distinct fixture entries. No product regression was inferred from that harness error.

No human intervention, schema/physics/scoring changes, provider actions or deployments. The parent serialized heavyweight test/benchmark windows to keep measurements uncontended. Remaining P2 per-stage GPU attribute retention (#24) is explicitly untouched. Physical desktop/mobile device-floor and thermal calibration remain under #27.

## Repository validation

`pnpm check` completed September 27, 2026 at approximately 21:08 UTC. Typecheck and lint passed (32 existing warnings, four informational diagnostics). All **1,348 test assertions passed**, with 32 skipped. The command exited nonzero because the unrelated `apps/worker/test/cards.integration.test.ts` afterAll harness disposal hook exceeded 60 seconds; its 40 assertions passed. Do not call this a fully green repository check. Targeted cleanup rerun and combined staging CI remain required before final acceptance. The parent released this agent's heavy host window to the renderer rather than overlapping a retry with its measurements.

An earlier full-check attempt stopped at a test-only TypeScript mismatch (`StageImage` assigned to `ImageBitmap` in the controlled rejection test). The observation type was narrowed to its required readonly width property; the subsequent full typecheck passed. No runtime source changed for that correction.
