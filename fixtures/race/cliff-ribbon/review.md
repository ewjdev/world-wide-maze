# Cliff Ribbon revised course review

Course: `a7bf3be33bc80b1257edcdbdd9c78cfcdba74fa62c728d258a46af655caa8f9e`

The outer ribbon and inside transfer now use curved, rail-free connectors with compact direction-change islands. Long jump tongues were replaced by short launch/landing platforms and off-axis approaches. The lower catch return also bends. The single remaining long straight is the final portion of the opening run.

## Straight-length acceptance

The complete authored routes, jumps, and recovery return paths have **1 long straight**. A long straight means more than 24 metres before accumulating 20 degrees of heading change (three seconds at 8 m/s). Shared portions are counted once across the whole course. The remaining span is 36.4 metres. See `straight-validation.json`.

## Physical traversal

All candidates use the same 9.2 m/s target-speed policy, bounded tilt and ordinary power inputs. Jump approaches request 10 m/s. There are no teleports, resets, gate skips, or direct velocity changes.

| Route | Seconds | Launches | Result |
| --- | ---: | ---: | --- |
| Outer braking turns | 64.292 | 0 | Clean finish; exact replay |
| Inside transfer | 58.983 | 0 | Clean finish; exact replay |
| Cliff hop | 64.967 | 2 | Clean finish; exact replay |

Every recorded position, quaternion, gate state, and mechanic state matched a second fixed-step simulation. Expected launches and clean landings matched on every route. All authored restart points were checked against their intended physical elevation (`reset-validation.json`).

## Browser evidence

Ground route 0 and jump route 2 are the current browser acceptance pair. Their `*-browser-validation.json` files bind screenshots to the final course identity and compare progress, mechanic state, and final ball pose with the physics recording.

Both browser runs passed with exact progress and mechanic state, zero final-pose error, and no page errors. All eight current screenshots were inspected: overview, curved ground, launch feature, and finish UI are legible. The HUD displays three lives and stacked turbo inventory.

## Limits

These checks establish repeatable clean traversal and rendering, not human difficulty or optimal racing lines. No turbo was spent by this policy; the updated game still accumulates turbo charges during qualifying full-speed periods. Missed-jump catch success and route balance under aggressive turbo use need human playtesting. Course timing is about a minute, not a countdown.
