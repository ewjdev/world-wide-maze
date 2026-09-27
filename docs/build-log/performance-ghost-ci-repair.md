# Ghost route-unmount regression repair

September 27, 2026. Performance epic #19 / ghost preparation #22, on `codex/performance-p1-staging`. This repair changes only the browser regression test and documentation; the measured game runtime is unchanged.

The first hosted staging check passed typecheck and lint, with 1,363 tests passing, 33 skipped and one failing. The new ghost browser case timed out while polling for worker termination immediately after requesting `/about`. That route is lazy: React Router keeps the existing game mounted until the destination module is ready. A URL change is therefore not the disposal boundary. `GameApp` calls `Game.dispose()` synchronously during effect cleanup, then clears `window.__wwmGame`.

The unmodified case passed in a local `CI=true` headless run (32.43 s). To distinguish a scheduling race from missing cleanup, a temporary negative control delayed only the About route's module response by 1.5 s. The original assertion then reproduced the hosted failure, `expected false to be true` / `Matcher did not succeed in time` (32.88 s). This delay was removed from the final test.

The repaired test holds the About module with an explicit promise, requests navigation, and verifies the game and its one pending worker remain alive while that module is blocked. It then releases the module and waits for the real cleanup boundary, `window.__wwmGame === undefined`. Worker termination must already be complete at that point: an immediate assertion requires the exact state `[true]`, without another termination poll or a vacuously true empty array. A `finally` releases the held response if an assertion fails. No runtime disposal change or enlarged polling timeout was needed.

Validation:

- `CI=true pnpm exec vitest run --project @wwm/web apps/web/test/ghost.e2e.test.ts apps/web/test/ghost-client.test.ts`: all 14 tests passed in 39.47 s, including real worker/reference parity and stale same-stage response rejection.
- `pnpm --filter @wwm/web typecheck`, focused Biome and `git diff --check` passed.
- The runtime content fingerprint remains `7ec6d5eb369258f8d58e47c31222bda8ad395505dfbc13597f3bfee45509ba1e`; existing source-bound native measurements remain applicable.

Local diagnostic logs are `/tmp/wwm-ghost-ci-before.log`, `/tmp/wwm-ghost-ci-delayed-negative.log`, and `/tmp/wwm-ghost-ci-after.log`. The hosted failure was preserved at `/tmp/wwm-p1-ci-failed.log`. Focused checks establish this repair; the complete hosted staging check must still pass before final handoff. The browser and test server closed, and the shared heavy-work slot was released.
