# Redline Relay revised-course review

Course: `b90e96c4018b581d771c5541497fac4c2a241c5c18ba468e22eda30e2f423b69`

Converted the long connectors into alternating curved approaches and smaller steering islands. Separated launch and landing platforms preserve short aligned jumps while making approach and exit steering necessary. Physical sloping launch decks and rail-free roads remain.

The full-route geometric audit passes: **1 long straights**. The audit measures more than 24 metres before 20 degrees of accumulated steering and includes island approaches, complete jump spans, and recovery returns. The retained straight is 25.6m (JL3 JT3/JT3 J).

## Physics verification

Every route uses ordinary bounded tilt input, shared target ground speed 9 m/s, launch speed 10 m/s, no turbo use, and no teleports or resets. All routes finished through the ordered gates with no falls and all expected clean landings. Independent replay matched every position and quaternion.

| Route | Time | Launches / landings |
| --- | ---: | ---: |
| Ground start / ground middle / ledge finish | 63.983 s | 0 / 0 |
| Ground start / ground middle / final hops | 66.000 s | 2 / 2 |
| Ground start / late hop / ledge finish | 66.083 s | 2 / 2 |
| Ground start / late hop / final hops | 68.075 s | 4 / 4 |
| Early hop / ground middle / ledge finish | 65.767 s | 2 / 2 |
| Early hop / ground middle / final hops | 67.767 s | 4 / 4 |
| Early hop / late hop / ledge finish | 67.917 s | 4 / 4 |
| Early hop / late hop / final hops | 69.950 s | 6 / 6 |

All 39 authored restart points were individually reset and selected their intended physical layer.

## Browser evidence

Browser routes 0 and 7 passed on this exact course hash at 63.983 s and 69.950 s, with zero final pose error and no JavaScript errors. All eight screenshots were inspected: the alternating bends and physical launch ramps are visible, the road and ball remain legible, the HUD shows three lives and stacked turbo (four charges on the ground route feature capture), and the final six-jump route reports six clean landings.

## Limits

These are controlled feasibility runs, not measured human difficulty, flow state, optimal times, or phone-controller acceptance. The added steering makes some controlled routes longer than the original 55–65 second target; the precise times above are the evidence. Deliberate missed-jump catches and recovery success rates are unmeasured. The new stacked-turbo and three-life HUD belongs to the shared Race implementation; these clean verification runs preserve all three lives.

The recovery island was moved to an exposed lower position and its return curved around the jump infrastructure to remove collider conflicts. Whether a missed jump naturally reaches that island is not established by clean-run testing.
