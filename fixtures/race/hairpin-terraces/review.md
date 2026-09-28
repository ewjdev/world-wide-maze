# Hairpin Terraces — curved-course review

Repeated straight hairpin lanes now bend through intermediate islands. The overall footprint is 20% smaller to offset the added steering time. The two jumps have compact landing islands and curved approach/exit connectors. Gate-island branch fans are separated, G2 has a wider apron, and the gate normals accept the new approach directions.

Current course ID: `81edf424d88687f984f9383e04083d25588e4cefa25f2617f4e5f557c031a693`. The final stage has 29 islands, 28 rail-free bridges, and 2 physical jump ramps with the existing upward assist.

## Straight limit

The geometry audit passes with **one** long straight: `W6_2 F`, 32.2m. “Long” means more than 24m before accumulating a 20-degree heading change. The audit follows real curve geometry, island approaches, complete flight spans, every authored route, and lower catch returns. Shared corridors are deduplicated. See `straight-validation.json`.

## Measured clean runs

| Route | Seconds | Launches / clean landings | Turbos banked |
| --- | ---: | ---: | ---: |
| Outer turns (`route-0`) | 62.017 | 0 / 0 | 4 |
| Apex cuts (`route-1`) | 61.250 | 0 / 0 | 4 |
| Diagonal hop pair (`route-2`) | 62.908 | 2 / 2 | 3 |

All runs used ordinary bounded tilt/power inputs in real Rapier physics, crossed ordered gates, and finished without a fall or reset. A second simulation reproduced every recorded position and rotation exactly. Each finished with all three lives. Turbos accumulated under the new three-second rule, but these reference runs did not spend them.



## Browser and screenshots

Ground/reference `route-0` and feature `route-2` replayed in the playable browser at `http://127.0.0.1:5214/race/hairpin-terraces`. Both match the Node finish progress, turbo inventory, lives, and final ball position exactly, with zero JavaScript page errors. Ground and feature quality settings are recorded in the browser reports; some feature/retry runs use low rendering quality to bound headless software-rendering time. Ready, midrun, feature, and finish screenshots are saved under `screenshots/`; the eight final images were visually inspected.

## Limits

These runs establish clean-route feasibility and deterministic browser behavior, not human difficulty, optimal speed, or optimized turbo strategy. The lower recovery route has validated geometry, but clean routes do not verify interception after a missed jump. Manual practice and phone control testing remain useful. These are local development browser checks, not deployment evidence.

## Reproduction

```sh
node scripts/race-maze-build.ts --slug hairpin-terraces
node scripts/race-maze-verify.ts --slug hairpin-terraces
node scripts/race-maze-straights.ts --slug hairpin-terraces
node scripts/race-maze-browser.ts --base-url http://127.0.0.1:5214 --slug hairpin-terraces --route route-0
node scripts/race-maze-browser.ts --base-url http://127.0.0.1:5214 --slug hairpin-terraces --route route-2
```
