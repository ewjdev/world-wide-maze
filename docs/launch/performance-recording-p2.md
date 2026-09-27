# Replay recording investigation (#26)

Research only. Production recording, score eligibility, replay schema and retention policy are unchanged. The coordinator must resolve overflow behavior with Eric before a bounded recorder ships.

The current game records all simulation ticks, including stationary ticks before the first POWER starts the timer. At 120 Hz the server's 36,000-tick verification ceiling is five minutes of simulation, not five minutes after the timer starts. The server accepts a maximum 12 MiB request body; longer replays can be unverified even below that byte limit. ReplaySchema itself does not bound client length. Result scores are separate from the input array, so an explicit overflow policy can retain scores without presenting a truncated replay as exact.

The Node probe models one newly sampled object per 60 Hz frame shared by two 120 Hz ticks, as the game currently does. It measures retained heap after explicit GC, exact UTF-8 JSON size, and serialization time. These are synthetic curves on the development Mac, not browser heap peaks or low-tier device latency. Camera heading and input changes can defeat idle compression; a stationary all-zero case is a favorable bound, not a promise about every idle session.

| Ticks | Simulated time | Estimated retained JS heap | Idle JSON | Active JSON |
| --- | --- | --- | --- | --- |
| 1,394 | 11.6 s | 88–120 KB | 86,487 B | 160,096 B |
| 7,200 | 60 s | 461–463 KB | 446,459 B | 827,482 B |
| 18,000 | 150 s | 1.15 MB | 1,116,060 B | 2,069,514 B |
| 36,000 | 300 s | 2.31 MB | 2,232,060 B | 4,138,636 B |
| 36,001 | 300.008 s | 2.31 MB | 2,232,122 B | 4,138,752 B |
| 72,000 | 600 s | 4.61 MB | 4,464,060 B | 8,277,166 B |

At 36,000 ticks serialization took 1.78 ms idle / 3.21 ms active in this run; at 72,000 it took 3.52 / 6.60 ms. Those small desktop timings do not establish harmlessness on phones or include transient JSON string, parse, network or submission allocations. Raw evidence: `docs/launch/evidence/recording-p2/curves.json`.

A research-only prototype stores three Float64 numbers and two packed boolean flags: exactly 25 bytes/tick, 900,000 backing-store bytes for 36,000 ticks. It preserves signed zero and full double precision. It round-trips all 5,429 fixture samples exactly; tests preserve explicit and implicit timerStartTick scoring, submit-envelope JSON values, button edges, retry clearing, and reject the 36,001st tick without overwriting. This is a representation proof, not a shipping cap: rejected data cannot be called an exact complete run. No full physics replay was re-run for the prototype; exact input equality supports determinism but is not a new physical playtest.

Recommended implementation after an overflow decision: allocate exact typed storage lazily in small chunks up to the existing 36,000-tick horizon. Expand to the existing InputSample[] envelope only when needed. This reduces retained objects and avoids allocating the full 900 KB for short runs, while keeping the current wire format. The measured prototype preallocates the entire buffer; lazy chunking and its transient submission peak require implementation tests. Do not use Float32 or delete idle prefixes: either can change replay physics or timer offsets. Lossless run-length encoding can make constant idle data tiny (one run in this probe), but active data had 18,000 distinct consecutive samples at 36,000 ticks and remains unbounded in the worst case. Compression alone is not a memory limit.

Two overflow policies are decision-ready:

1. Retain the local/result score; after tick 36,000 mark the run's recording unavailable/inexact and discard its replay storage, continue play, and use the existing score-only unverified submission path. No truncated exact replay or ghost. This aligns the bound with the existing server verification horizon but changes availability of long local replays/ghosts and requires Eric's approval.
2. Spill exact chunks to IndexedDB with bounded working memory, preserving longer local replay data. The server still cannot verify beyond 36,000 ticks; offline persistence, quota failure, reload lifecycle and bounded serialization need a separate implementation. Storage quotas ultimately still need a fallback policy.

The first option is recommended for its bounded complexity and explicit score preservation. Until approved, no production change is included. The eventual implementation should test tick 35,999/36,000/36,001, long pre-input idle, timerStartTick, result score retention, retry, replay/ghost availability, exact submission under the limit, unverified submission over it, and disposal of recording buffers across many stages.

Reproduce: `node --expose-gc --import tsx infra/perf/recording-p2.mjs`; tests: `node --import tsx --test infra/perf/recording-p2.test.mjs`. Set `AUDIT_OUT` to keep separate evidence runs.
