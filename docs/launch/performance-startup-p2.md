# Startup and first-input investigation — #30

September 27, 2026. This is a research result against qualified P1 runtime `ebd368b`, content fingerprint `7ec6d5eb369258f8d58e47c31222bda8ad395505dfbc13597f3bfee45509ba1e`. It does not change production audio, shorten the countdown, establish field INP, or certify a physical lower-tier device.

## Attributed production-build observations

The opt-in [startup collector](../../infra/perf/startup-p2.mjs) verifies all 382 served assets, wraps lifecycle/audio methods, records game phases and resource transfer sizes, and captures a CDP sampling profile. Instrumentation adds overhead; these are diagnostic measurements. The host is the same Apple M5 Max/128 GiB machine used for P1, headed Chromium with native Metal at 1440×900 and DPR 2. Analytics are off, offline gameplay retains scores locally, and no API service runs behind the static preview.

Eighteen runs cover three trials each of cold/warm practice at native speed, practice with 6× page CPU stress and an explicit 10 Mbit/s/50 ms network profile, and learning mode with 6× page CPU stress. Cold runs clear the browser HTTP cache; warm runs reload in the same context. Resource transfer sizes remain in the evidence. No request interception disables the cache. Browser/GPU caches and unrelated host activity are not fully controlled. Page CPU stress does not model mobile hardware or worker CPU.

All runs completed with zero captured browser errors. [Raw runs and profiles](evidence/startup-p2/) preserve the initial native outlier, individual phases, long tasks, exact asset identity and trusted keyboard input. The first control is Space/JUMP, followed by a second press after initialization. Input-to-next-rAF is a responsiveness diagnostic, not measured display presentation or INP.

| Scenario (six runs each) | First audio unlock, min / median / max | First key → next rAF, min / median / max | Second key → next rAF, min / median / max |
|---|---|---|---|
| Native practice | 45.1 / 46.3 / 205.5 ms | 47.2 / 48.5 / 207.9 ms | 3.1 / 12.5 / 15.7 ms |
| 6× practice, 10 Mbit/s, 50 ms | 302.0 / 341.1 / 379.4 ms | 318.3 / 357.8 / 396.6 ms | 9.8 / 14.3 / 17.4 ms |
| 6× learning | 314.2 / 369.1 / 381.8 ms | 331.2 / 387.3 / 404.3 ms | 8.8 / 10.3 / 13.5 ms |

The `AudioManager.unlock()` span includes AudioContext creation, synchronous `buildSfx()`, AudioBuffer allocation/copy, resume and initial music setup. Sampling confirms the same call subtree accounts for approximately 42–203 ms natively and 291–374 ms under stress. The first native cold outlier includes substantial self time in `unlock`, so it must not all be attributed to synthesis. Later stressed profiles show the nested bell-wave/noise/envelope calculations prominently. The unchanged second unlock returns in 0–0.5 ms.

World preparation and shader compilation occur before this gesture and are recorded separately. Representative native cold engine-load/compile spans were 105.8/81.5 ms; representative 6× slow-network spans were 594.0/424.7 ms. Compilation is nested within engine load and must not be added to it. Rapier download/WASM CPU samples are retained, but the collector does not expose a separate complete private-driver load span. Navigation-to-play includes the deliberate minimum-build presentation and countdown: the observed 4.18–5.70 seconds is not a pure loader metric. No countdown or gameplay constants changed.

## Exact synthesis prototype

Twelve diagnostic runs compare the unchanged pure `buildSfx()` on the main thread with a fresh worker: three alternating pairs at native speed and three with 6× page CPU stress. All 18 cue hashes match in every run, covering 2,273,788 PCM bytes; no browser errors occurred. [Raw prototype evidence](evidence/startup-p2/audio-spike/paired.json) includes all samples and a separately verified diagnostic asset manifest.

| Scenario | Main synthesis wall time | Worker completion wall time | Main maximum rAF gap | Worker maximum rAF gap |
|---|---|---|---|---|
| Native, three trials | 42.5–57.3 ms | 61.5–64.0 ms | 32.2–35.3 ms | 16.7–18.7 ms |
| 6× page stress, three trials | 213.8–235.2 ms | 43.7–44.5 ms | 201.6–218.6 ms | 18.1–18.7 ms |

Native worker preparation is slower overall while keeping the page responsive. The stressed worker runs on an unthrottled worker thread, so their shorter wall time is not a whole-device speedup or a mobile forecast. Main-thread long tasks occurred in two native runs (50/57 ms) and all stressed runs (215–235 ms); none occurred in the worker arms. rAF timestamp gaps are a scheduling diagnostic, not presentation latency. This isolated prototype excludes AudioContext creation, actual cue playback and game lifecycle integration; it does not establish a shipped first-control improvement.

## Bounded next decision

Test moving the unchanged sound-sample synthesis into a one-shot worker during existing world preparation, then transfer its Float32 buffers. Keep AudioContext creation/resume in the user-gesture path. The prototype must hash every cue against the existing implementation, capture main-thread responsiveness separately from total worker completion, and preserve failed/slow trials. A worker is a responsiveness option, not evidence of lower whole-device CPU or battery consumption.

Browser autoplay requirements still apply: create or resume the audio context in response to a user gesture ([MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), [Chrome Web Audio autoplay](https://developer.chrome.com/blog/web-audio-autoplay)). Typed-array data can transfer through its underlying ArrayBuffer, with ownership moving to the recipient ([MDN transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)). These references support the proposed mechanism; physical Safari/Android acceptance is still required.

Any product implementation must cover early gestures before preparation finishes, bounded queued cues, worker failure, disposal/cancellation, mute persistence, suspended/resumed contexts and first-control feedback. It must also measure remaining native AudioContext creation cost: moving synthesis alone does not eliminate that initial cold outlier. Original/learning replay and score invariants remain mandatory. This investigation does not silently replace a browser gesture with autoplay, drop the first sound, or label a prototype as shipped.

## Reproduce

```sh
node infra/perf/p1-build.mjs
pnpm --filter @wwm/web preview --host 127.0.0.1 --port 4318
AUDIT_BASE=http://127.0.0.1:4318 AUDIT_OUT=/tmp/wwm-startup-new node infra/perf/startup-p2.mjs
```

The separate synthesis prototype uses `node infra/perf/audio-spike-p2.mjs build`, followed by `AUDIT_BASE=... AUDIT_OUT=... node infra/perf/audio-spike-p2.mjs measure`. It builds temporary diagnostic entries and records a separate asset manifest. Rebuild with `p1-build.mjs` before running the core production regression collectors; never reuse diagnostic asset hashes as production-build acceptance.
