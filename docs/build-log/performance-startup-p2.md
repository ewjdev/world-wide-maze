# Performance P2 startup research and resource gate

September 27, 2026. Continues epic #19, research #30 and regression tooling #28 on the performance worktree.

- Captured 18 source-bound production startup/first-input traces: native and 6× page stress, cold/warm HTTP cache, explicit slow network, practice and learning. First audio unlock includes context creation, synthesis, buffer copy and resume. Native median 46.3 ms and stressed medians 341.1/369.1 ms; all raw profiles and outliers retained. No product audio changes.
- Compared exact synthesis on main versus a fresh worker in 12 diagnostic runs. All 18 cues/2,273,788 PCM bytes match. Native rAF gaps 32.2–35.3 → 16.7–18.7 ms, with slower total worker preparation. Page-only CPU stress is not device emulation. See [report](../launch/performance-startup-p2.md).
- Added opt-in strict resource plateau mode: every post-warmup allocation checkpoint must remain at or below its warm value; missing samples fail. Historical P1 leak waiver remains available only for reproducing old results. Current P2 staging will require strict mode.
- Validation: 25 regression-gate tests pass, including deliberately injected small leaks, intermediate peaks, historical non-attribute growth and missing samples. Collector syntax/Biome and peer review passed. No browser errors in startup or synthesis runs. Combined staging checks and physical device acceptance are recorded separately.
