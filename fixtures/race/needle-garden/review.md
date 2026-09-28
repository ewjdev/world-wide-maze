# Needle Garden revised-course review

Course: `bd933bc0fd3896d507986f73422f55f972b5d83e719e2d1d42d2012c2faf3688`

Converted the long connectors into alternating curved approaches and smaller steering islands. Separated launch and landing platforms preserve short aligned jumps while making approach and exit steering necessary. Physical sloping launch decks and rail-free roads remain.

The full-route geometric audit passes: **1 long straights**. The audit measures more than 24 metres before 20 degrees of accumulated steering and includes island approaches, complete jump spans, and recovery returns. The retained straight is 30.7m (W11_2 F).

## Physics verification

Every route uses ordinary bounded tilt input, shared target ground speed 9 m/s, launch speed 10 m/s, no turbo use, and no teleports or resets. All routes finished through the ordered gates with no falls and all expected clean landings. Independent replay matched every position and quaternion.

| Route | Time | Launches / landings |
| --- | ---: | ---: |
| Outer precision | 67.058 s | 0 / 0 |
| Needle cut | 62.292 s | 0 / 0 |
| Transfer jump | 66.342 s | 1 / 1 |
| Needle + transfer | 61.333 s | 1 / 1 |

All 23 authored restart points were individually reset and selected their intended physical layer.

## Browser evidence

Browser routes 0 and 2 passed on this exact course hash at 67.058 s and 66.342 s, with zero final pose error and no JavaScript errors. All eight screenshots were inspected: the alternating bends, raised takeoff, clear gap and landing target are visible, with legible road, ball, stacked-turbo indicator and three-life HUD. The ground route used high rendering quality; the jump route used low rendering quality after a software-renderer contention timeout. Physics inputs and results were unchanged. The final jump route reports one launch and one clean landing.

## Limits

These are controlled feasibility runs, not measured human difficulty, flow state, optimal times, or phone-controller acceptance. The added steering makes some controlled routes longer than the original 55–65 second target; the precise times above are the evidence. Deliberate missed-jump catches and recovery success rates are unmeasured. The new stacked-turbo and three-life HUD belongs to the shared Race implementation; these clean verification runs preserve all three lives.
