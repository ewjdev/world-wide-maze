# Performance follow-up integration

Agent: Codex with three implementation/review agents, local tools. September 27, 2026. User-authorized continuation of epic #19 in isolated worktrees, with individual measurement/test gates and staging integration only. [Result report](../launch/performance-p2-followup.md).

The previous turn committed the five pending plans as `f362b45` in the original checkout. This continuation reused the audit, audio, recording and device-tooling worktrees. No unrelated plan branch was pushed. Benchmarks, builds and full suites were serialized to avoid competing measurements.

## Qualified inputs

- Audio `81cb3a6`: 18 sound-enabled actual-product trials per arm; native first-key to next-rAF median 46.45 → 14 ms. Exact 18 cue/rolling PCM, real worker error, bounded early cues, context resume and ten disposal cycles passed. A deliberately delayed cue failed its negative-control gate. Full check 1,394 passed, 32 skipped. Merged as `93db948`.
- Device tooling `ec7e53c`: 20 dedicated tests, browser download-content verification, 1,383 passing repository tests. Explicit opt-in server verifies and pins build assets; raw capture is local and cannot certify physical identity. No product runtime change. Merged as `ea4af03`.
- Recording `44f45dc`: 126 triplets verify exact exported JSON; lossless runs reduce representative 36,000-tick active retention by 59–62%. Full check 1,391 passed, 32 skipped. An initial extension-scroll failure and successful unchanged focused/full retries remain in evidence, with no claimed root-cause fix. Merged as `16e7992`.

Independent source reviews covered ownership, exact input values, run splitting, completed submission/debug copies, worker preparation, gesture-only context creation and disposal. Initial recorder candidates were rejected for export and idle-memory regressions. The accepted recorder still has explicit short-run and transient-export costs; audio uses 2.45 MB of preparatory PCM and retains cold context-creation outliers.

Generated docent corpus conflicts were resolved by rebuilding from the merged documentation. Parent changes strengthen the staging workflow with device-tool tests and a current-runtime audio comparison. Independent review found missing-metadata and invalid-timing false positives in the initial audio comparator; explicit provenance validation, recomputed manifest hashes, exact trial coverage and paired timing validation now have 11 negative/positive tests. A stale audio candidate failed the controlled fingerprint test with exit 1 and the expected stale-source message.

## Combined qualification

Fresh production build: integration commit `16e7992d86ee8507111314753891f4d1eb85fea7`, 383 verified assets, runtime fingerprint `bc217847a194d757e51274653397bc09365f0570b4764390fd61ec73eafebe43`. All six core native modes completed without errors; all 51 strict comparison gates pass. All eighteen combined sound-enabled startup trials pass the strengthened source-bound gate: native first-key median 46.45 → 14.30 ms, 6× practice 248.55 → 17.30 ms, learning 250.75 → 17.15 ms. Cold native maximum is still 114.6 ms. All 59 dedicated tool/research tests pass. Final combined `pnpm check` passed 120 files / 1,402 tests, with three files / 32 tests skipped, in 149.44 seconds. New evidence JSON formatting preserved parsed-value hashes. Published-head CI is checked separately; epic #19 records its exact accepted commit/run, rather than treating the local pass as remote acceptance. The preview and audit browsers were stopped after collection.

## Remaining boundaries

No physical lower-tier desktop, Android or iOS acceptance is claimed. The device floor, sustained thermal/battery tests, utilization and input-to-photon evidence remain open. The total recording horizon and overflow policy remain unchanged. Main independently advanced to cost-controls `1947496`; syncing and validating that integration remains a promotion gate. This batch does not deploy or merge to main. No manual device provisioning, production traffic, telemetry addition or engineering-speedup claim.
