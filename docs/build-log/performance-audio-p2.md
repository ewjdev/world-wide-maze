# Performance #32 — prepare synthesized audio off the main thread

Agent: Codex (GPT-6), local tools; September 27, 2026. Start approximately 18:35 PDT. Base: accepted staging `2629523`. Status: qualified for staging review; measured product, lifecycle and full repository checks passed. Completed approximately 18:58 PDT. No deployment or main merge.

The user authorized subagents to implement remaining performance work, test each change, and admit only measured improvements to staging. This follows #30's startup investigation without replacing its historical evidence. The recording agent owns independent game recording regions; this change touches only audio implementation and the mount/dispose audio lifecycle hooks.

## Implementation and scope

A one-shot module worker prepares the unchanged 18 sound effects and rolling loop during game mounting, then transfers their Float32 buffers. It creates no AudioContext. `unlock()` creates/resumes WebAudio synchronously in the user gesture; it never synthesizes PCM. Cues copy into an AudioBuffer lazily once and release the corresponding transferred PCM. Preparation retains approximately 2.45 MB decimal PCM (2,273,788 effect bytes plus 176,400 rolling bytes) before a gesture; this trades bounded early memory and worker activity for a responsive first control. It does not reduce whole-device synthesis CPU.

Before samples arrive, or when worker construction/loading/messages/timeouts fail, cues receive a short degraded oscillator tone. At most eight fallback tones can be active; each stops after 80 ms. This is deliberate approximate feedback, not sample-exact sound. Nothing queues waiting for worker completion, so old cues never play as a burst. Only cues requested during context resume queue, at most eight with 500 ms expiry; mute, rejection and disposal clear them. Normal prepared audio remains sample-exact.

Game disposal now closes its audio owner, terminates pending synthesis, clears timers/queues and releases samples and nodes. Preparation and disposal are idempotent. No gameplay, scoring, replay, network cadence, analytics or deployment settings change.

## Evidence and attempts

- Baseline sound-muted diagnostic: 18 exact production runs on accepted runtime `36bcaafb…`, all 382 served assets verified. Uses accepted parent dist while this worktree advances; the report identifies its actual baseline source.
- Candidate v1 sound-muted diagnostic: 18 runs, zero browser errors. Preserved as intermediate evidence because final source additionally consumes transferred PCM after AudioBuffer copy.
- Sound-enabled baseline and final candidate: 18 runs each, all paired scenarios complete, zero captured browser errors. Native median first trusted key → next rAF **46.45 → 14.00 ms (69.9% lower)**; 6× practice with 10 Mbit/s/50 ms network **248.55 → 16.20 ms (93.5%)**; 6× learning **250.75 → 17.05 ms (93.2%)**. Corresponding audio unlock medians: **44.5 → 2.85 ms**, **238.2 → 5.30 ms**, **240.2 → 6.65 ms**. Native first-control cold outliers remain **156.2 / 118.8 ms** baseline/candidate; no samples excluded. The collector records `muted:false`; historical baseline source is explicitly bound through its previous verified report and every served asset is rechecked. It never describes dirty candidate source as baseline.
- Focused tests: 11 passing, including all 18 accepted PCM hashes/2,273,788 bytes and the original 176,400-byte rolling-loop hash, idempotent preparation, no pregesture context, early bounded feedback/no delayed replay, constructor/error/messageerror/timeout failures, resume queue/expiry/rejection, mute, rolling PCM, disposal and music resume. Web typecheck passes.
- Native production browser lifecycle: all five modes passed (prepared, delayed response, constructor failure, actual worker-thrown error, dispose before response), zero errors. The prepared jump schedules its exact 9,702-sample buffer; early/error paths schedule the bounded 660 Hz fallback. A real suspended context resumes on the next trusted key without losing its cue. Ten repeated same-page preparation/gesture/disposal cycles return to zero live workers and zero AudioContexts after `close()` resolves. The real worker transfers exactly 2,450,188 PCM bytes. All 18 cue hashes plus rolling-loop hash match the baseline.
- Initial lifecycle assertion falsely treated a newly available rolling-loop source as a stale one-shot cue; raw failure is preserved under `candidate-v2/lifecycle-attempt1/`. The corrected gate excludes looping sources while still rejecting any delayed one-shot. No production change was needed. A deliberate delayed-jump negative control validates that rejection separately.
- Full `pnpm check`: **passed**, 119 files / 1,394 tests; 3 files / 32 tests skipped, 148.76 seconds. Typecheck and lint passed. Its first attempt passed typecheck and stopped on formatting of the derived comparison JSON; only that summary was formatted, the log was retained, and the complete command was restarted. Original raw traces were not rewritten. `pnpm docent:index` was regenerated after the final log and `pnpm docent:index --check` passed.
- Dedicated checks: `pnpm exec vitest run apps/web/test/audio.test.ts`; `AUDIT_MUTED=0 node infra/perf/startup-p2.mjs` with the explicit baseline/candidate directories; `node infra/perf/audio-p2-summary.mjs`; `node infra/perf/audio-p2.mjs`; `AUDIT_NEGATIVE_CONTROL=1 node infra/perf/audio-p2.mjs` exited 1 **as required**, rejecting the deliberately injected delayed jump. The summary JSON is formatted with `pnpm exec biome format --write docs/launch/evidence/audio-p2/comparison.json` before repository lint.

## Reproduce and artifact identity

From this worktree, `node infra/perf/p1-build.mjs`, serve the production dist on 4321, then:

```sh
AUDIT_BASE=http://127.0.0.1:4321 AUDIT_MUTED=0 AUDIT_OUT=/tmp/audio-startup node infra/perf/startup-p2.mjs
AUDIT_BASE=http://127.0.0.1:4321 AUDIT_OUT=/tmp/audio-lifecycle node infra/perf/audio-p2.mjs
node infra/perf/audio-p2-summary.mjs
```

[Raw evidence](../launch/evidence/audio-p2/) retains both muted preliminary batches, both sound-enabled qualification batches, all profiles/outliers, lifecycle attempts and exact served asset manifests. Candidate v2 is the final runtime, not the superseded v1 bank-retention implementation. Its runtime fingerprint is `75c45a2a78253fdce9b2506dc937efbb651f034228030d641a391fb11fbef59f` (383 verified served assets); per-file source hashes and complete runtime patch are saved under `candidate-v2/`; collection occurred before the qualification commit, so its Git HEAD field identifies base `2629523` and the runtime fingerprint identifies the dirty candidate. The baseline uses accepted runtime `36bcaafb…` from immutable parent dist, whose source fingerprint matches accepted staging despite an earlier build-manifest Git HEAD. No parent files were modified.

The original #30 diagnostic prototype remains reproducible with the extracted synthesis module; its historical evidence is untouched.

## Limits

Native AudioContext creation still has cold outliers and is not moved outside user gestures. CDP page CPU stress does not throttle synthesis workers and is not a physical mobile forecast. Startup wrappers and CPU sampling add diagnostic overhead; first key to next rAF is not field INP or measured sound/display presentation. Browser node scheduling proves feedback was scheduled, not physical speaker audibility. Physical Safari/Android autoplay, sound and lower-tier-device acceptance remain pending. All timing runs, including outliers, remain in the raw evidence.

No manual human intervention during implementation. No speedup-of-engineering claim.
