# Phase 25 — Island Leap, earned turbo and landing boosts

Date: 2026-09-27 (America/Los_Angeles). Codex with parallel domain, course and controller/browser agents. Same isolated `codex/race-mode` worktree; baseline commit `50a1fc4` preserved. User approved moving forward with the recommended jump/boost experiment. No deployment or remote data changes.

## Result

Island Leap is the fourth Race course. Its six islands offer a safe ramp route, an ordinary automatic launch to a near island, and a player-triggered turbo jump that clears that island to land farther ahead. Shared merge gates make all routes legal. The launch corridor has exposed edges; the safe branch uses narrow ramps. Existing courses and Original/Education are unchanged.

Three seconds of grounded forward speed earns one stored turbo; T/on-screen/phone activation is recorded at a fixed physics tick. Automatic launch and clean-landing effects use the same deterministic runtime in play and replay. A clean landing earns a modest capped burst. Physics uses a new bounded velocity-delta method; it does not teleport or reset angular/contact state.

## Geometry and replay evidence

Frozen course ID: `1aeacba92c35250d3e547a9d86af8e300b26bcb8e218cd6cda94baaeef47a690`.

| Route | Finish ticks | Time | Launch / rewarded landing |
| --- | ---: | ---: | --- |
| Safe ramps | 3582 | 29.850 s | 0 / 0 |
| Near island | 1331 | 11.092 s | 1 / 1, island 2 |
| Turbo island skip | 1245 | 10.375 s | 1 / 1, island 3 |

The boosted ball's bottom clears the intermediate island by at least **2.503 m** over its footprint. All routes finish with no falls or practice reasons, and every recorded ghost pose matches a fresh simulation. These use exact synthetic input streams and prove mechanics/geometry, not human skill or flow.

Owned HTML, capture, textures, authoring provenance, route inputs, traces and verification reports: `fixtures/race/island-leap/`. Public assets are frozen separately. Reproduction: `node scripts/race-stunt-capture.ts --build-only`, `node scripts/race-stunt-verify.ts`; format regenerated public JSON with Biome before repository checks.

## Review fixes

- Initial ordinary launch landed on a connecting bridge; widened the near island and tuned turbo so ordinary/boosted receiving islands differ.
- Landings require forward alignment and no hard bump. Same-island hops and repeated launch crossings cannot farm rewards.
- Stopped or capped turbo requests now preserve charge; phone request deduplication was adjusted so a rejected request does not permanently disable that charge.
- Source changes/recovery discard pending phone requests. V1 inputs and old course compatibility remain intact; stunts write bounded v2 inputs with turbo bit 2 and rules v2.
- Review caught Turbo replacing the required phone POWER control. The corrected layout retains POWER and JUMP and adds Turbo separately; binary POWER behavior is explicitly checked.
- An initial whole-workspace lint run found only new public course JSON formatting; corrected before the final check. Existing unrelated style advisories remain separate.

## Validation

Focused domain tests cover original parity, v1/v2 flags, launch/turbo/landing full-pose replay, held-button edges, no-op activation, recovery high-water anti-farming and same-island rejection. Builder tests check actual source/rebuild provenance; route tests cover all three alternatives. Browser tests distinguish mocked phone transport from physical device use.

## Limits

This is a short jump experiment, not a full difficult-course collection. Launches use an explicit upward assist. No curved or banked ramps, generalized branching generator, cloud ghosts, leaderboard, or additional momentum/precision/corner reward systems were added. Physical phone handling, comfort, human route readability and flow remain hands-on review gates. Existing timing/performance evidence is not automatically transferred to the changed course; any new measurements are identified separately.

## Browser and independent review evidence

- Three dedicated browser tests passed: phone capability/calibration/actual touch + binary POWER; safe/near/far completion, persistent v2 inputs and ghost pose equality; real ArrowUp charging and T activation plus mobile layout.
- All route browser times match the headless physics reports. The far recording includes exactly one turbo request. It survives reload and reproduces the finish pose with a ghost.
- The airborne capture visibly shows the ball clearing the near island with the far target ahead. Mobile ready and phone control views were inspected; POWER/JUMP remain reachable beside the separate Turbo action.
- Independent read-only reviewer disposition: **ship**, no material visual or replay/lifecycle defects identified in the supplied screenshots and code. A general reviewer supplied the unavailable dedicated Impeccable reviewer role. Physical-phone feel and human route discovery remain unverified.
- Images: [airborne](stunt-review/airborne.png), [mobile ready](stunt-review/mobile-ready.png), [far finish](stunt-review/far-finish.png), [phone controls](stunt-review/phone.png).

The first complete regression run passed 1,260 tests but failed the generated docent corpus freshness check after build-log changes. The required local corpus regeneration is included; this is generated documentation data, not a new worker behavior or deployment.

## Final handoff checks

- `pnpm check`: passed typecheck, lint and tests; **100 test files passed, 1,261 tests passed, 40 skipped** (158.70 seconds for the test phase).
- Existing Race browser regression: **5/5 passed**, including saved ghosts, retry/pause, mobile catalogue, real keyboard controls, Original/Education entry and flag-off history preservation.
- Dedicated stunt browser checks: **3/3 passed**, as described above.
- Race-enabled and Race-disabled production builds succeeded; only the existing bundle-size warning remained.
- Production preview at `http://127.0.0.1:5200/race/island-leap`: real keyboard input earned a charge, the actual Turbo button consumed it, and Escape paused; no page errors. This smoke check used no injected input trace.
- Persisted screenshot review and independent code/visual review completed. The next gate is the user's hands-on assessment of fun, difficulty and flow.

The documentation corpus is regenerated once more after this final record, with its focused freshness test rerun before committing.
