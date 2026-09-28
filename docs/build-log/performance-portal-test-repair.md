# P2 staging: retain real portal-crossing observations

The combined staging `pnpm check` passed typechecking/linting but its full test run ended with 1,382 passing, 32 skipped and one failure after 149.89 seconds: `portal.e2e.test.ts`, “declining a portal lets the ball roll through it again without interrupting play.” The return-crossing assertion expected distance below 0.463 m but eventually observed 32.323 m. No other case failed.

## Diagnosis

The original input path and remote poll were reproduced with a read-only observer around the original `RapierSimulation.step`. It failed again (29.982 m at timeout), while the retained real physics trace proved the second portal entry at tick 610, minimum return distance **0.033245 m** at tick 622, and no renewed portal prompt. The below-0.463 m interval lasted ticks 616–627: about 100 ms of simulation, or 50 ms of wall time at the test's existing `timeScale: 2`. Remote polling missed this transient even though movement and decline behavior were correct.

This test uses lockstep physics and remains in the `play` phase, so optional-worker sleeping and inactive render caps are outside this path. The original trace also confirms fresh ArrowDown input was consumed. [Diagnosis and full raw trace](../launch/evidence/portal-test-repair/diagnosis.json) accompany the [original failed assertion](../launch/evidence/portal-test-repair/original-poll-failure.txt) and [all physics-step samples](../launch/evidence/portal-test-repair/original-physics-trace.json.gz).

## Repair and verification

Only the test changes. A page-local observer calls the unchanged real physics step and retains the second portal sensor entry, inner crossing, then outer exit. The test still uses real ArrowDown input and the same 0.5×radius / radius+0.2 thresholds. It asserts continued play and no renewed portal prompt. Observer restoration and browser context closure happen in `finally`, including assertion failures.

All browser checks used `CI=true` with the repository's headless/software-WebGL convention:

- Entire repaired portal suite: **3 passed**, 33.88 s.
- Negative control: temporarily omitted the game’s `dismissedPortals.add(portal.id)` in the isolated repair worktree. The repaired test **failed in 9.32 s**, receiving the renewed `second.example` portal instead of `null`; this was a semantic assertion failure, not a timeout. Product source was then restored byte-for-byte.
- Post-restore focused runs: **1 passed each**, 9.40 s and 9.77 s.
- Web typecheck, changed-file Biome, and diff whitespace checks passed. Parent will rerun combined full checks and GitHub CI.

Evidence lives in `docs/launch/evidence/portal-test-repair/`. The measured product runtime remains unchanged; the prior native performance evidence is still bound to the same runtime fingerprint. No production behavior, timeout, or acceptance threshold was relaxed.

```sh
CI=true pnpm exec vitest run --project @wwm/web apps/web/test/portal.e2e.test.ts
```
