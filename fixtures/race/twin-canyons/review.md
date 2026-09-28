# Twin Canyons — curved-course review

Both canyon alternatives use compact jump pairs connected by alternating curves. The parallel ground lanes and opening corridor wind through smaller islands. The lower catch returns through a separate four-curve lane.

Current course ID: `10c24640f869462867352ffc2d3ecd79e9d7feebecae6e7fa4233f545743ee2a`. The final stage has 36 islands, 33 rail-free bridges, and 4 physical jump ramps with the existing upward assist.

## Straight limit

The geometry audit passes with **one** long straight: `W11_2 F`, 31.0m. “Long” means more than 24m before accumulating a 20-degree heading change. The audit follows real curve geometry, island approaches, complete flight spans, every authored route, and lower catch returns. Shared corridors are deduplicated. See `straight-validation.json`.

## Measured clean runs

| Route | Seconds | Launches / clean landings | Turbos banked |
| --- | ---: | ---: | ---: |
| Save for canyon two (`route-0`) | 64.783 | 2 / 2 | 7 |
| Spend at canyon one (`route-1`) | 63.358 | 2 / 2 | 7 |
| Ground both (`route-2`) | 60.458 | 0 / 0 | 10 |
| Both canyon hops (`route-3`) | 66.875 | 4 / 4 | 4 |

All runs used ordinary bounded tilt/power inputs in real Rapier physics, crossed ordered gates, and finished without a fall or reset. A second simulation reproduced every recorded position and rotation exactly. Each finished with all three lives. Turbos accumulated under the new three-second rule, but these reference runs did not spend them.

Some deliberate jump or bailout lines run longer than the nominal 55–65-second window: Both canyon hops (66.9s). The fastest validated main line remains close to a minute.

## Browser and screenshots

Ground/reference `route-2` and feature `route-3` replayed in the playable browser at `http://127.0.0.1:5214/race/twin-canyons`. Both match the Node finish progress, turbo inventory, lives, and final ball position exactly, with zero JavaScript page errors. Ground and feature quality settings are recorded in the browser reports; some feature/retry runs use low rendering quality to bound headless software-rendering time. Ready, midrun, feature, and finish screenshots are saved under `screenshots/`; the eight final images were visually inspected.

## Limits

These runs establish clean-route feasibility and deterministic browser behavior, not human difficulty, optimal speed, or optimized turbo strategy. The lower recovery route has validated geometry, but clean routes do not verify interception after a missed jump. Manual practice and phone control testing remain useful. These are local development browser checks, not deployment evidence.

## Reproduction

```sh
node scripts/race-maze-build.ts --slug twin-canyons
node scripts/race-maze-verify.ts --slug twin-canyons
node scripts/race-maze-straights.ts --slug twin-canyons
node scripts/race-maze-browser.ts --base-url http://127.0.0.1:5214 --slug twin-canyons --route route-2
node scripts/race-maze-browser.ts --base-url http://127.0.0.1:5214 --slug twin-canyons --route route-3
```
