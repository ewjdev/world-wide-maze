/**
 * Dev: builder geometry statistics relevant to playability, over captures × slices × easy/normal × seeds 1–3.
 *   node packages/solver/scripts/geomstats.ts
 */
import { distanceToPolygonEdge, pointInPolygon, type StageData, sliceCount } from '@wwm/schema';
import { buildStage } from '@wwm/stage-builder';
import { listCaptureSlugs, loadCapture } from '@wwm/stage-builder/node';
import { BALL_RADIUS_PX, ELEVATOR_MIN_RISE_M } from '../src/nav.ts';

let stages = 0;
let elevators = 0;
const lowRise: string[] = [];
let bridges = 0;
let deepEnds = 0;
const deepByDiff: Record<string, number> = {};
for (const slug of listCaptureSlugs()) {
  const { capture, image } = loadCapture(slug);
  for (let slice = 0; slice < sliceCount(capture); slice++)
    for (const difficulty of ['easy', 'normal'] as const)
      for (const seed of [1, 2, 3]) {
        const s: StageData = buildStage({ capture, image, sliceIndex: slice, seed, difficulty }).stage;
        stages++;
        const islands = new Map(s.islands.map((i) => [i.id, i] as const));
        for (const e of s.elevators) {
          elevators++;
          const rise = e.levelHigh - e.levelLow;
          if (rise < ELEVATOR_MIN_RISE_M)
            lowRise.push(
              `${slug} s${slice} ${difficulty} seed ${seed} elevator ${e.id} rise ${rise.toFixed(2)} D`,
            );
        }
        for (const b of s.bridges) {
          bridges++;
          const len = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]) || 1;
          const nx = (-(b.b[1] - b.a[1]) / len) * (b.width / 2);
          const ny = ((b.b[0] - b.a[0]) / len) * (b.width / 2);
          for (const [p, id] of [
            [[b.a[0] + nx, b.a[1] + ny], b.from],
            [[b.a[0] - nx, b.a[1] - ny], b.from],
            [[b.b[0] + nx, b.b[1] + ny], b.to],
            [[b.b[0] - nx, b.b[1] - ny], b.to],
          ] as const) {
            const isl = islands.get(id);
            if (!isl) continue;
            // A deck corner deeper than a ball radius inside its island: that side rail stands on the island
            // (slanted island edge at the mouth), a wall the ball can't pass next to the deck.
            const q: [number, number] = [p[0], p[1]];
            if (
              pointInPolygon(q, isl.contour, isl.holes) &&
              distanceToPolygonEdge(q, isl.contour, isl.holes) > BALL_RADIUS_PX
            ) {
              deepEnds++;
              deepByDiff[difficulty] = (deepByDiff[difficulty] ?? 0) + 1;
            }
          }
        }
      }
}
console.log(`stages ${stages}, elevators ${elevators}, bridges ${bridges}`);
console.log(`elevators rising < ${ELEVATOR_MIN_RISE_M} D (ball pinned between platforms): ${lowRise.length}`);
for (const l of lowRise) console.log(`  ${l}`);
console.log(
  `bridge endpoints > ${BALL_RADIUS_PX} px inside their island (side rails stand on the island): ${deepEnds}`,
  deepByDiff,
);
