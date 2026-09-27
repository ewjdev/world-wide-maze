# Flow Delta — curved-course review

The long initial, middle, and first half of the finish corridors now use alternating curves and small connecting islands. The two jumps have compact takeoff and landing islands with curved approaches. The lower recovery lane also winds through two islands. Branch approaches at G2 attach on separate sides of the island to prevent overlapping road surfaces.

Current course ID: `72a110013a88f49010b9d32f8638c1979c0d4624a4147e5239ca46a9baf16d21`. The final stage has 28 islands, 27 rail-free bridges, and 2 physical jump ramps with the existing upward assist.

## Straight limit

The geometry audit passes with **one** long straight: `D F`, 62.9m. “Long” means more than 24m before accumulating a 20-degree heading change. The audit follows real curve geometry, island approaches, complete flight spans, every authored route, and lower catch returns. Shared corridors are deduplicated. See `straight-validation.json`.

## Measured clean runs

| Route | Seconds | Launches / clean landings | Turbos banked |
| --- | ---: | ---: | ---: |
| Flow line (`route-0`) | 63.867 | 0 / 0 | 4 |
| Inside line (`route-1`) | 61.633 | 0 / 0 | 3 |
| Hop line (`route-2`) | 64.167 | 2 / 2 | 3 |
| Inside + hops (`route-3`) | 61.425 | 2 / 2 | 2 |

All runs used ordinary bounded tilt/power inputs in real Rapier physics, crossed ordered gates, and finished without a fall or reset. A second simulation reproduced every recorded position and rotation exactly. Each finished with all three lives. Turbos accumulated under the new three-second rule, but these reference runs did not spend them.



## Browser and screenshots

Ground/reference `route-0` and feature `route-2` replayed in the playable browser at `http://127.0.0.1:5214/race/flow-delta`. Both match the Node finish progress, turbo inventory, lives, and final ball position exactly, with zero JavaScript page errors. Ground and feature quality settings are recorded in the browser reports; some feature/retry runs use low rendering quality to bound headless software-rendering time. Ready, midrun, feature, and finish screenshots are saved under `screenshots/`; the eight final images were visually inspected.

## Limits

These runs establish clean-route feasibility and deterministic browser behavior, not human difficulty, optimal speed, or optimized turbo strategy. The lower recovery route has validated geometry, but clean routes do not verify interception after a missed jump. Manual practice and phone control testing remain useful. These are local development browser checks, not deployment evidence.

## Reproduction

```sh
node scripts/race-maze-build.ts --slug flow-delta
node scripts/race-maze-verify.ts --slug flow-delta
node scripts/race-maze-straights.ts --slug flow-delta
node scripts/race-maze-browser.ts --base-url http://127.0.0.1:5214 --slug flow-delta --route route-0
node scripts/race-maze-browser.ts --base-url http://127.0.0.1:5214 --slug flow-delta --route route-2
```
