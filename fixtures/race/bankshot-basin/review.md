# Bankshot Basin revised course review

Course: `d8a346e87ddd9f745d92197709384d77011ef017b7dfc6b908931f7453e1c635`

The basin now combines curved ground connectors, a real banked turn, a separate launch preparation island, and compact jump platforms. The three-jump route asks for repeated line changes. Landing islands were widened to preserve reliable physical touchdown before the next turn. Both lower recovery connectors curve. The finish approach contains the only remaining long straight.

## Straight-length acceptance

The complete authored routes, jumps, and recovery return paths have **1 long straight**. A long straight means more than 24 metres before accumulating 20 degrees of heading change (three seconds at 8 m/s). Shared portions are counted once across the whole course. The remaining span is 24.5 metres. See `straight-validation.json`.

## Physical traversal

All candidates use the same 9.6 m/s target-speed policy, bounded tilt and ordinary power inputs. Jump approaches request 10 m/s. There are no teleports, resets, gate skips, or direct velocity changes.

| Route | Seconds | Launches | Result |
| --- | ---: | ---: | --- |
| Grounded basin | 61.783 | 0 | Clean finish; exact replay |
| Banked launch | 60.392 | 1 | Clean finish; exact replay |
| Three-jump commitment | 63.233 | 3 | Clean finish; exact replay |

Every recorded position, quaternion, gate state, and mechanic state matched a second fixed-step simulation. Expected launches and clean landings matched on every route. All authored restart points were checked against their intended physical elevation (`reset-validation.json`).

## Browser evidence

Ground route 0 and jump route 2 are the current browser acceptance pair. Their `*-browser-validation.json` files bind screenshots to the final course identity and compare progress, mechanic state, and final ball pose with the physics recording.

The banked connector also has a separate ordinary-input screenshot at tick 1931 (`screenshots/route-2-bank.png`), linked to the current identity by `bank-browser-validation.json`.

Both browser runs passed with exact progress and mechanic state, zero final-pose error, and no page errors. All eight current run screenshots plus the bank screenshot were inspected: curved ground, angled launch, banked surface and finish UI are legible. The HUD displays three lives and stacked turbo inventory.

## Limits

These checks establish repeatable clean traversal and rendering, not human difficulty or optimal racing lines. No turbo was spent by this policy; the updated game still accumulates turbo charges during qualifying full-speed periods. The lower catch was also tested by an explicit reset onto R followed by ordinary inputs along curved R–Q–D and the ground finish: 40.300 seconds, correct elevation, no falls. This isolated continuation does not test a missed-jump interception or complete competitive gate history. Missed-jump catch success and route balance under aggressive turbo use need human playtesting. Course timing is about a minute, not a countdown.
