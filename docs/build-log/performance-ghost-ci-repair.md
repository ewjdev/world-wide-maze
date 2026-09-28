# Ghost route-unmount regression repair

September 27, 2026. Performance epic #19 / ghost preparation #22, on `codex/performance-p1-staging`. This repair changes only the browser regression test and documentation; the measured game runtime is unchanged.

The first hosted staging check ([run 36353578195](https://github.com/ewjdev/world-wide-maze/actions/runs/36353578195)) passed typecheck and lint, with 1,363 tests passing, 33 skipped and one failing. The new ghost browser case timed out while polling for worker termination immediately after requesting `/about`. That route is lazy: React Router keeps the existing game mounted until the destination module is ready. A URL change is therefore not the disposal boundary. `GameApp` calls `Game.dispose()` synchronously during effect cleanup, then clears `window.__wwmGame`.

The unmodified case passed in a local `CI=true` headless run (32.43 s). To distinguish a scheduling race from missing cleanup, a temporary negative control delayed only the About route's module response by 1.5 s. The original assertion then reproduced the hosted failure, `expected false to be true` / `Matcher did not succeed in time` (32.88 s). This delay was removed from the final test.

The repaired test holds the About module with an explicit promise, requests navigation, and verifies the game and its one pending worker remain alive while that module is blocked. It then releases the module and waits for the real cleanup boundary, `window.__wwmGame === undefined`. Worker termination must already be complete at that point: an immediate assertion requires the exact state `[true]`, without another termination poll or a vacuously true empty array. A `finally` releases the held response if an assertion fails. No runtime disposal change or enlarged polling timeout was needed.

Validation:

- `CI=true pnpm exec vitest run --project @wwm/web apps/web/test/ghost.e2e.test.ts apps/web/test/ghost-client.test.ts`: all 14 tests passed in 39.47 s, including real worker/reference parity and stale same-stage response rejection.
- `pnpm --filter @wwm/web typecheck`, focused Biome and `git diff --check` passed.
- The runtime content fingerprint remains `7ec6d5eb369258f8d58e47c31222bda8ad395505dfbc13597f3bfee45509ba1e`; existing source-bound native measurements remain applicable.

Local diagnostic logs are `/tmp/wwm-ghost-ci-before.log`, `/tmp/wwm-ghost-ci-delayed-negative.log`, and `/tmp/wwm-ghost-ci-after.log`. The hosted failure was preserved at `/tmp/wwm-p1-ci-failed.log`. Focused checks establish this repair; the complete hosted staging check must still pass before final handoff. The browser and test server closed, and the shared heavy-work slot was released.

## Stale transport result repair

The subsequent hosted check ([run 36354351992](https://github.com/ewjdev/world-wide-maze/actions/runs/36354351992)) passed the repaired unmount case but failed the stale-response case: `page.waitForResponse` exceeded 30 seconds. The run again reported 1,363 passed, 33 skipped and one failed. The response subscription already preceded release of the held request. The actual race was the ranking client's independent six-second HTTP timeout: on a slow runner, the held first request aborted before the replacement ghost finished preparing, so releasing its route could no longer generate a response event.

A deterministic negative control subscribed to that first request's failure before navigation and awaited the real timeout. It observed `net::ERR_ABORTED`, then reproduced the original missing-response failure in 12.15 s (the response-wait deadline was shortened only for this negative control). Log: `/tmp/wwm-ghost-stale-negative.log`. The hosted failure is preserved at `/tmp/wwm-p1-ci-final-failed.log`.

The final test completes the actual first HTTP response and reads its body, then holds a detached browser transport result. This deliberately ignores later aborts to exercise an obsolete result that really reaches the application. Each scenario establishes a ready replacement before releasing the held result, waits for explicit JSON consumption, and inspects the next browser task after the promise chain has drained. It requires the replacement name, `ready` status and exactly one constructed ghost worker. Both valid and incompatible obsolete payloads are covered. There is no fixed delivery sleep or wait for a response event that may never occur.

Removing the first request-generation guard temporarily makes the repaired test fail: the obsolete incompatible response changes the replacement's status from `ready` to `idle` (13.52 s; `/tmp/wwm-ghost-stale-mutation.log`). This negative mutation demonstrates that the test detects stale publication rather than merely accepting an aborted request. The guard was immediately restored and the runtime file compared byte-for-byte with Git. Worker abort/disposal remains covered by the existing client unit tests and the real-browser retry/unmount case.

All 14 ghost unit/browser tests passed with `CI=true` in headless Chromium (45.46 s; `/tmp/wwm-ghost-stale-after.log`). Three further focused repetitions, each exercising both stale payloads, passed in 13.48 s, 13.58 s and 13.70 s (`/tmp/wwm-ghost-stale-repeat-{1,2,3}.log`). Web typecheck, focused Biome and whitespace checks passed. The other two new browser cases were reviewed for the same ordering issue: reference parity waits for the completed worker result, and route disposal uses the explicit unmount boundary established above. The runtime fingerprint remains `7ec6d5eb369258f8d58e47c31222bda8ad395505dfbc13597f3bfee45509ba1e`. Final full hosted CI remains required; these focused results do not relabel either failed run as green.

Parent review also refreshed the device-matrix reproduction command to use the integrated #28 build wrapper, which emits the required source/asset evidence manifest. A plain production build remains valid for playing the game but cannot supply a source-bound audit.
