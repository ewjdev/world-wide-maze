# Switchyard revised course review

Course: `6d7015dd4bd7534c98d72dff3026f25cfc0e48a767faef277854659a84f44397`

Both junctions retain their grounded alternatives. Curved connectors replace the extended approach and exit lines, and two compact angled jumps replace the long island tongues. The low catch return bends away from the racing deck. The only remaining long straight is the last section approaching the finish.

## Straight-length acceptance

The complete authored routes, jumps, and recovery return paths have **1 long straight**. A long straight means more than 24 metres before accumulating 20 degrees of heading change (three seconds at 8 m/s). Shared portions are counted once across the whole course. The remaining span is 29.9 metres. See `straight-validation.json`.

## Physical traversal

All candidates use the same 9.4 m/s target-speed policy, bounded tilt and ordinary power inputs. Jump approaches request 10 m/s. There are no teleports, resets, gate skips, or direct velocity changes.

| Route | Seconds | Launches | Result |
| --- | ---: | ---: | --- |
| Outside / outside | 64.367 | 0 | Clean finish; exact replay |
| Inside / inside | 54.967 | 0 | Clean finish; exact replay |
| Jump / outside | 61.817 | 2 | Clean finish; exact replay |
| Outside / inside | 64.983 | 0 | Clean finish; exact replay |
| Inside / outside | 55.825 | 0 | Clean finish; exact replay |
| Jump / inside | 62.525 | 2 | Clean finish; exact replay |

Every recorded position, quaternion, gate state, and mechanic state matched a second fixed-step simulation. Expected launches and clean landings matched on every route. All authored restart points were checked against their intended physical elevation (`reset-validation.json`).

## Browser evidence

Ground route 0 and jump route 2 are the current browser acceptance pair. Their `*-browser-validation.json` files bind screenshots to the final course identity and compare progress, mechanic state, and final ball pose with the physics recording.

Both browser runs passed with exact progress and mechanic state, zero final-pose error, and no page errors. All eight current screenshots were inspected: overview, curved ground, launch feature, and finish UI are legible. The HUD displays three lives and stacked turbo inventory.

## Limits

These checks establish repeatable clean traversal and rendering, not human difficulty or optimal racing lines. No turbo was spent by this policy; the updated game still accumulates turbo charges during qualifying full-speed periods. Missed-jump catch success and route balance under aggressive turbo use need human playtesting. Course timing is about a minute, not a countdown.
