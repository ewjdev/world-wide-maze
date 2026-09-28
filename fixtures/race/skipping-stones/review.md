# Skipping Stones — curved-course review

Five compact jump pairs are offset from the original long flight axis, requiring a new heading on each approach and departure. Ground alternatives, opening and finish approaches use curves. The lower catch return is curved too.

Current course ID: `ae3a6a04b82d7548e08a88f2c1e1ca68fc178f26850e80b96d0c35c7e87bb58a`. The final stage has 36 islands, 34 rail-free bridges, and 5 physical jump ramps with the existing upward assist.

## Straight limit

The geometry audit passes with **one** long straight: `W13_2 F`, 40.0m. “Long” means more than 24m before accumulating a 20-degree heading change. The audit follows real curve geometry, island approaches, complete flight spans, every authored route, and lower catch returns. Shared corridors are deduplicated. See `straight-validation.json`.

## Measured clean runs

| Route | Seconds | Launches / clean landings | Turbos banked |
| --- | ---: | ---: | ---: |
| Hop chain (`route-0`) | 64.900 | 3 / 3 | 7 |
| Ground bypass (`route-1`) | 62.800 | 0 / 0 | 11 |
| Chain + late transfer (`route-2`) | 70.358 | 5 / 5 | 3 |
| Ground + late transfer (`route-3`) | 67.625 | 2 / 2 | 6 |
| First-stone bailout (`route-4`) | 69.000 | 1 / 1 | 10 |
| Second-stone bailout (`route-5`) | 65.725 | 2 / 2 | 9 |

All runs used ordinary bounded tilt/power inputs in real Rapier physics, crossed ordered gates, and finished without a fall or reset. A second simulation reproduced every recorded position and rotation exactly. Each finished with all three lives. Turbos accumulated under the new three-second rule, but these reference runs did not spend them.

Some deliberate jump or bailout lines run longer than the nominal 55–65-second window: Chain + late transfer (70.4s), Ground + late transfer (67.6s), First-stone bailout (69.0s), Second-stone bailout (65.7s). The fastest validated main line remains close to a minute.

## Browser and screenshots

Ground/reference `route-1` and feature `route-0` replayed in the playable browser at `http://127.0.0.1:5214/race/skipping-stones`. Both match the Node finish progress, turbo inventory, lives, and final ball position exactly, with zero JavaScript page errors. Ground and feature quality settings are recorded in the browser reports; some feature/retry runs use low rendering quality to bound headless software-rendering time. Ready, midrun, feature, and finish screenshots are saved under `screenshots/`; the eight final images were visually inspected.

## Limits

These runs establish clean-route feasibility and deterministic browser behavior, not human difficulty, optimal speed, or optimized turbo strategy. The lower recovery route has validated geometry, but clean routes do not verify interception after a missed jump. Manual practice and phone control testing remain useful. These are local development browser checks, not deployment evidence.

## Reproduction

```sh
node scripts/race-maze-build.ts --slug skipping-stones
node scripts/race-maze-verify.ts --slug skipping-stones
node scripts/race-maze-straights.ts --slug skipping-stones
node scripts/race-maze-browser.ts --base-url http://127.0.0.1:5214 --slug skipping-stones --route route-1
node scripts/race-maze-browser.ts --base-url http://127.0.0.1:5214 --slug skipping-stones --route route-0
```
