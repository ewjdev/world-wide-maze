# Final browser acceptance captures

Unedited screenshots from the final local elevation profile and course assets on 2026-09-27. Captured by the three `apps/web/test/race*.e2e.test.ts` suites against `http://127.0.0.1:5214`.

```sh
WWM_RACE_E2E_BASE=http://127.0.0.1:5214 WWM_RACE_SHOTS=/tmp/race-acceptance \
  pnpm exec vitest run apps/web/test/race.e2e.test.ts \
  apps/web/test/race-stunts.e2e.test.ts apps/web/test/race-elevation.e2e.test.ts
```

Ten tests passed; one optional test skipped. Recorded ordinary inputs drive the playable Race session. Phone transport and device orientation are simulated; this does not certify physical-phone acceptance. Per-course high-quality traversal screenshots and compatibility-checked proofs are in the parent course directories and `../../review.html`.

The separate `../progress/` directory records earlier development checkpoints. It is not final-profile verification evidence.
