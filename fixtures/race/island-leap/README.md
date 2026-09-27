# Island Leap

A six-island, owned HTML experiment with three legal routes sharing a gate before the choice and gates after the merge. Terrain polygons are extracted from the actual browser screenshot/DOM. The dedicated authoring builder adds validated connectors and levels, selectively cuts flight-corridor rails, and includes all final stage geometry, mechanic settings, gates, source hash and texture hash in the course identity.

- Safe route: turn right off the runway, follow narrower protected connectors, turn left onto the far island.
- Near route: roll up the short ramp without pressing Jump. The lip launches automatically; land on island 2 and roll across its narrow connector to the far island.
- Far route: earn turbo by sustaining forward speed, activate near the launch lip, clear island 2 completely and land on island 3.

The runway's reference speed is 10 m/s; earning charge requires 360 uninterrupted qualifying physics ticks at >= 90% of that speed. The uphill ramp rises 1.5 m over 10 m; its open lip applies an 18 m/s upward assist. Turbo adds 12 m/s up to 26 m/s, and a qualifying landing adds 1.5 m/s. These are the experimental Race rules, not changes to Original/Education physics.

Rebuild the real browser capture and course from repository root:

```
node scripts/race-stunt-capture.ts
node scripts/race-stunt-verify.ts
```

`--build-only` reuses the saved capture. Browser capture requires the existing Playwright Chromium installation. `*-inputs.json` contains exact consumed player inputs, `*-trace.json` contains every real physics pose/velocity, and `*-validation.json` records ordered gates, contact/launch/landing events and replay verification. The verifier does not teleport the ball or supply simulation velocity: only normal steering input plus the recorded turbo button.

Current automated results: safe 29.850 s; near 11.092 s; far 10.375 s. All have zero falls and replay identically in a fresh simulation. The far trajectory has at least 2.503 m ball-bottom clearance above island 2 throughout its footprint, never contacts that island, and lands on island 3. These establish feasibility and deterministic replay; human route readability, fun, and difficulty need playtesting.
