/**
 * Step 7: island heights. `level` is a float in ball diameters (contract v0.2, CD-2).
 *
 * R/N — the 2013 method is unknown; the 2013 stage has continuous heights of 9.3–23.2 D, the start high
 * (22.7 D) and the goal low (12.8 D), 11 of 31 static bridges flat, and 6 elevators on tiny gaps with rises of
 * 3.7 / 5.6 / 7.4 D. Our heuristic:
 *  1. A target per island: a gentle top → bottom descent across the stage, a bump for page chrome
 *     (header/nav +2, footer −2), and seeded noise.
 *  2. Walk the carved tree from the start. Each child moves toward its target, but never steeper than the ramp
 *     limit over its bridge (so every static bridge is a legal ramp). Some edges are kept flat (E ratio).
 *  3. Very short gaps may instead become elevators with a 2013 rise, when the target asks for a big change.
 *  Loop edges (easy) keep the already assigned levels: ramp if legal, elevator if short, otherwise dropped.
 * 03b: an elevator also needs a rise of at least `elevatorMinRiseD` (both platforms share one footprint, so a
 * small rise pins the ball between them, BI-3) and room for the ball beyond both platform ends
 * (`elevatorFits`, BI-2). Otherwise the edge stays a bridge (tree) or the loop is dropped.
 */
import type { Rng, Vec2 } from '@wwm/schema';
import type { Candidate } from './bridges.ts';
import { type BuildParams, D } from './params.ts';

export type LinkKind = 'bridge' | 'elevator';

export interface LevelInput {
  n: number;
  root: number;
  candidates: readonly Candidate[];
  tree: readonly number[];
  loops: readonly number[];
  parentEdge: readonly number[];
  /** Safe-spot position per island (px). */
  anchor: readonly Vec2[];
  /** Role bump per island (D). */
  roleBump: readonly number[];
  stageHeight: number;
  /** Can candidate `e` be an elevator whose lower end is on island `low`? (default: yes) */
  elevatorFits?: (e: number, low: number) => boolean;
  /** Can candidate `e` be a ramp (straight mouths)? (default: yes) */
  rampFits?: (e: number) => boolean;
}

export interface LevelResult {
  levels: number[];
  /** Link kind per carved candidate index (tree + accepted loops). */
  kinds: Map<number, LinkKind>;
  /** Loop edges that had to be dropped (height difference not traversable). */
  droppedLoops: number[];
  targets: number[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const floor2 = (v: number) => Math.floor(v * 100 + 1e-9) / 100;

function spanPx(c: Candidate): number {
  return Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
}

/** Largest legal ramp rise over a span, D (rounded down to 0.01). */
export function maxRampRise(span: number, slope: number): number {
  return floor2((slope * span) / D);
}

export function assignLevels(input: LevelInput, rng: Rng, params: BuildParams): LevelResult {
  const { n, root, candidates, tree, loops, parentEdge, anchor, roleBump, stageHeight } = input;
  const fits = input.elevatorFits ?? (() => true);
  const rampOk = (e: number, span: number) => span >= params.rampMinSpanPx && (input.rampFits?.(e) ?? true);
  const lo = params.levelMin;
  const hi = params.levelMax;
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));

  const noise = rng.fork('level-noise');
  const targets: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = (anchor[i] as Vec2)[1];
    const trend = params.levelMid + (0.5 - y / Math.max(1, stageHeight)) * (hi - lo) * params.levelTrend;
    targets.push(clamp(trend + (roleBump[i] ?? 0) + noise.range(-params.levelNoise, params.levelNoise)));
  }

  const levels = new Array<number>(n).fill(Number.NaN);
  const kinds = new Map<number, LinkKind>();
  levels[root] = round2(targets[root] as number);

  const pick = rng.fork('level-walk');
  const children: number[][] = Array.from({ length: n }, () => []);
  for (const e of tree) {
    const c = candidates[e] as Candidate;
    // the tree edge's child is the endpoint whose parentEdge is e
    const child = parentEdge[c.to] === e ? c.to : c.from;
    const parent = child === c.to ? c.from : c.to;
    children[parent]?.push(e);
  }
  const queue = [root];
  while (queue.length > 0) {
    const p = queue.shift() as number;
    const lp = levels[p] as number;
    for (const e of children[p] as number[]) {
      const c = candidates[e] as Candidate;
      const v = c.to === p ? c.from : c.to;
      const span = spanPx(c);
      const want = (targets[v] as number) - lp;
      // decisions are always drawn in the same order so tuning one knob doesn't reshuffle the others
      const rElevator = pick.next();
      const rFlat = pick.next();
      const rRise = pick.next();
      let lv = Number.NaN;
      if (
        span <= params.elevatorMaxSpanPx &&
        Math.abs(want) >= params.elevatorMinWantD &&
        rElevator < params.elevatorChance
      ) {
        const rises = params.elevatorRisesD;
        const rise = rises[Math.min(rises.length - 1, Math.floor(rRise * rises.length))] as number;
        for (const dir of [Math.sign(want), -Math.sign(want)]) {
          const cand = round2(lp + dir * rise);
          // dir > 0: the child is higher, so the parent holds the lower platform end
          if (cand >= lo && cand <= hi && rise >= params.elevatorMinRiseD && fits(e, dir > 0 ? p : v)) {
            lv = cand;
            break;
          }
        }
        if (!Number.isNaN(lv)) kinds.set(e, 'elevator');
      }
      if (Number.isNaN(lv)) {
        kinds.set(e, 'bridge');
        if (rFlat < params.flatChance || !rampOk(e, span)) lv = lp;
        else {
          const m = maxRampRise(span, params.rampSlope);
          const d = Math.sign(want) * Math.min(m, floor2(Math.abs(want)));
          lv = round2(lp + d);
          if (lv < lo || lv > hi) lv = lp;
        }
      }
      levels[v] = lv;
      queue.push(v);
    }
  }
  // islands outside the tree (should not happen after pruning) get their clamped target
  for (let i = 0; i < n; i++) if (Number.isNaN(levels[i])) levels[i] = round2(targets[i] as number);

  const droppedLoops: number[] = [];
  for (const e of loops) {
    const c = candidates[e] as Candidate;
    const d = Math.abs((levels[c.from] as number) - (levels[c.to] as number));
    const span = spanPx(c);
    const low = (levels[c.from] as number) < (levels[c.to] as number) ? c.from : c.to;
    if (
      d === 0 ||
      (rampOk(e, span) &&
        d / (span / D) <= params.rampSlope &&
        d <= maxRampRise(span, params.rampSlope) + 1e-9)
    )
      kinds.set(e, 'bridge');
    else if (span <= params.elevatorMaxSpanPx && d >= params.elevatorMinRiseD - 1e-9 && fits(e, low))
      kinds.set(e, 'elevator');
    else droppedLoops.push(e);
  }
  return { levels, kinds, droppedLoops, targets };
}
