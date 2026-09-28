# Sky Weave revised-course review

Course: `6e285653ecdc66b6e274ab9a757a4538942f8d1ad6daa662615fe2e898d39cba`

Converted the long connectors into alternating curved approaches and smaller steering islands. Separated launch and landing platforms preserve short aligned jumps while making approach and exit steering necessary. Physical sloping launch decks and rail-free roads remain.

The full-route geometric audit passes: **0 long straights**. The audit measures more than 24 metres before 20 degrees of accumulated steering and includes island approaches, complete jump spans, and recovery returns.

## Physics verification

Every route uses ordinary bounded tilt input, shared target ground speed 9.6 m/s, launch speed 10 m/s, no turbo use, and no teleports or resets. All routes finished through the ordered gates with no falls and all expected clean landings. Independent replay matched every position and quaternion.

| Route | Time | Launches / landings |
| --- | ---: | ---: |
| Full weave | 77.600 s | 0 / 0 |
| Upper inside | 76.258 s | 0 / 0 |
| Upper hop | 79.333 s | 2 / 2 |

All 28 authored restart points were individually reset and selected their intended physical layer.

## Browser evidence

Browser routes 0 and 2 passed on this exact course hash at 77.600 s and 79.333 s, with zero final pose error and no JavaScript errors. All eight standard screenshots plus four crossing/underpass screenshots were inspected. They show the bent roads, real launch ramps, clear airborne gap, correct finishes, three-life HUD and stacked turbo. The jump route and layer captures used high rendering quality; the ground route used low rendering quality after software-renderer contention caused an initial timeout. Physics inputs and results were unchanged. The layer captures keep the lower road and ball visible without moving the camera onto the upper bridge. The upper deck is mostly outside the lower camera framing or lost in the bright haze, so the visual cue from beneath remains weaker than the view from above.

## Limits

These are controlled feasibility runs, not measured human difficulty, flow state, optimal times, or phone-controller acceptance. The added steering makes some controlled routes longer than the original 55–65 second target; the precise times above are the evidence. Deliberate missed-jump catches and recovery success rates are unmeasured. The new stacked-turbo and three-life HUD belongs to the shared Race implementation; these clean verification runs preserve all three lives.

The actual quadratic upper and lower bridge surfaces cross at 4 m separation. Both trace passes are within 0.12 m of the crossing, with 2.537 m free height above the lower ball. The descending G3–N connector ends before the underpass. These authored layers work with existing layer-aware camera support.
