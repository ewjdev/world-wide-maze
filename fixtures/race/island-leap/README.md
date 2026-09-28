# Island Leap

An eight-island, owned HTML course with three legal racing routes and a lower recovery route. Terrain polygons come from the actual browser screenshot/DOM. The authoring builder adds validated connectors and levels, cuts flight-corridor rails, and includes all final geometry, mechanics, gates, source hash and texture hash in the course identity.

- Ground (`safe` in fixtures): turn right off the runway, follow the shorter, wider connectors, then carry speed through the shared exit. Save turbo for the finishing straight.
- Near: take the first ramp without spending turbo, land on island 2, climb a second small ramp to island 6 and automatically hop onto the shared exit island. Two clean landings reward maintained momentum.
- Far: aim toward the offset island 3 and use turbo at the first lip to clear island 2. After landing, turn right onto the exit connector. The jump alone cannot reach the finish.
- Recovery: an under-speed first launch can land on lower island 7. Follow its uphill return ramp toward ground island 4 and continue through the normal merge. It does not award a clean-landing bonus and does not reset or teleport the ball.

The runway's reference speed is 10 m/s; charge requires 360 qualifying grounded forward ticks at >=90% of that speed. The first rising ramp climbs 1 m over about 6.67 m, with a 23 m/s upward launch assist at its lip. The second climbs 0.5 m over about 3.70 m, with a 12 m/s assist. Turbo adds 12 m/s up to 26 m/s, and a qualifying landing adds 1.5 m/s. These are explicit Race arcade rules, not changes to Original/Education physics or claims of passive ramp ballistics.

Reproduce from the repository root:

```
node scripts/race-stunt-capture.ts
pnpm exec biome check --write apps/web/public/race/island-leap/course.json scripts/race-stunt-policy.ts
node scripts/race-stunt-verify.ts
node scripts/race-stunt-balance.ts
```

`--build-only` reuses the saved capture. Browser capture requires the existing Playwright Chromium installation. The frozen course identity also needs updating in `apps/web/src/race/courses.ts` after a deliberate rebuild changes it. Format the driving policy before regenerating the balance report, whose freshness checks include its source hash.

`*-inputs.json` contains consumed player inputs; `*-trace.json` contains physics poses/velocities; `*-validation.json` records ordered gates, contact and mechanic events, and replay evidence. The shared adaptive route driver uses the same 10 m/s handling target, tilt limits and 26 m/s turbo headroom on every route. Each route can spend turbo where it is useful. The scripts never teleport or inject physical state.

Current clean candidate lines: ground **13.633 s**, near **13.900 s**, far **12.983 s**. All finish without falls and reproduce the recorded ball positions at every replay tick. Far clears the near island with at least **3.838 m** beneath the ball. These are policy-specific examples, not globally optimal routes or human difficulty measurements. The independent balance report covers varied steering, speed and turbo inputs and distinguishes intended-route completion from falling back to another branch. Human route discovery, physical-phone feel and flow still need playtesting.
