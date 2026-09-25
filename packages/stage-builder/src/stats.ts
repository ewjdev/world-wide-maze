/**
 * Scale-free statistics of a stage (lengths in ball diameters D), used to compare builder output with the
 * 2013 AID-DCC stage (docs/reference/stage-format.md §8) in the debugger, the CLI report and the tests.
 */
import { boundsOf, PX_PER_METER, rampSlope, type StageData, signedArea, type Vec2 } from '@wwm/schema';
import { polylineLength, ringLength } from './rails.ts';

export interface Dist {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

export interface StageStats {
  islands: number;
  links: number;
  isTree: boolean;
  /** Island area, D². */
  islandAreaD2: Dist;
  /** Largest island's share of the total island area. */
  largestIslandShare: number;
  /** Island bounding-box smaller side, D. */
  islandMinSideD: Dist;
  contourVertices: Dist;
  bridges: number;
  flatBridges: number;
  ramps: number;
  elevators: number;
  /** Bridge centerline length |b − a|, D. */
  bridgeLengthD: Dist;
  bridgeWidthD: Dist;
  maxRampSlope: number;
  elevatorRiseD: Dist;
  smallItems: number;
  largeItems: number;
  /** Small items per 10 D² of total island area. */
  smallPer10D2: number;
  /** Share of islands that carry at least one small item. */
  islandsWithItemsShare: number;
  /** Nearest-neighbor distance between small items, D. */
  smallSpacingD: Dist;
  restartPoints: number;
  /** Rail length / outline length. */
  railCoverage: number;
  levels: Dist;
  /** Island area share of the stage area. */
  landShare: number;
}

export function dist(values: readonly number[]): Dist {
  const v = [...values].sort((a, b) => a - b);
  const q = (p: number) =>
    v.length === 0 ? Number.NaN : (v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))] as number);
  return { n: v.length, min: q(0), p25: q(0.25), median: q(0.5), p75: q(0.75), max: q(1) };
}

const len = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function stageStats(stage: StageData): StageStats {
  const D = PX_PER_METER;
  const areas = stage.islands.map((i) => {
    let a = signedArea(i.contour);
    for (const h of i.holes) a += signedArea(h);
    return a;
  });
  const totalArea = areas.reduce((s, a) => s + a, 0);
  const small = stage.items.filter((i) => i.kind === 'small');
  const smallByIsland = new Set(small.map((i) => i.islandId));
  const spacing = small.map((p, k) => {
    let best = Number.POSITIVE_INFINITY;
    small.forEach((q, j) => {
      if (j !== k) best = Math.min(best, len(p.pos, q.pos));
    });
    return best / D;
  });
  let outline = 0;
  let rails = 0;
  for (const i of stage.islands) {
    outline += ringLength(i.contour);
    for (const h of i.holes) outline += ringLength(h);
    for (const g of i.guardrails) rails += polylineLength(g);
  }
  const ramps = stage.bridges.filter((b) => b.type === 'ramp');
  return {
    islands: stage.islands.length,
    links: stage.bridges.length + stage.elevators.length,
    isTree: stage.bridges.length + stage.elevators.length === stage.islands.length - 1,
    islandAreaD2: dist(areas.map((a) => a / (D * D))),
    largestIslandShare: totalArea > 0 ? Math.max(...areas) / totalArea : 0,
    islandMinSideD: dist(
      stage.islands.map((i) => {
        const b = boundsOf(i.contour);
        return Math.min(b.w, b.h) / D;
      }),
    ),
    contourVertices: dist(stage.islands.map((i) => i.contour.length)),
    bridges: stage.bridges.length,
    flatBridges: stage.bridges.length - ramps.length,
    ramps: ramps.length,
    elevators: stage.elevators.length,
    bridgeLengthD: dist(stage.bridges.map((b) => len(b.a, b.b) / D)),
    bridgeWidthD: dist(stage.bridges.map((b) => b.width / D)),
    maxRampSlope: ramps.reduce((m, b) => Math.max(m, rampSlope(b.a, b.b, b.levelA, b.levelB)), 0),
    elevatorRiseD: dist(stage.elevators.map((e) => e.levelHigh - e.levelLow)),
    smallItems: small.length,
    largeItems: stage.items.length - small.length,
    smallPer10D2: totalArea > 0 ? (small.length / (totalArea / (D * D))) * 10 : 0,
    islandsWithItemsShare: stage.islands.length > 0 ? smallByIsland.size / stage.islands.length : 0,
    smallSpacingD: dist(spacing.filter(Number.isFinite)),
    restartPoints: stage.islands.reduce((s, i) => s + i.restartPoints.length, 0),
    railCoverage: outline > 0 ? rails / outline : 0,
    levels: dist(stage.islands.map((i) => i.level)),
    landShare: totalArea / (stage.size.width * stage.size.height),
  };
}

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');
const fd = (x: Dist, d = 1) => `${f(x.min, d)} / ${f(x.median, d)} / ${f(x.max, d)}`;

/** Rows for a comparison table: [metric, ...one formatted value per stats object]. */
export function statsRows(list: readonly StageStats[]): [string, ...string[]][] {
  const row = (name: string, fn: (s: StageStats) => string): [string, ...string[]] => [name, ...list.map(fn)];
  return [
    row('islands', (s) => String(s.islands)),
    row('links (bridges + elevators), tree?', (s) => `${s.links}${s.isTree ? ' (tree)' : ' (+loops)'}`),
    row('island area D² min / median / max', (s) => fd(s.islandAreaD2, 0)),
    row('largest island share of land', (s) => `${f(s.largestIslandShare * 100, 0)} %`),
    row('land share of stage', (s) => `${f(s.landShare * 100, 0)} %`),
    row('island smaller side D min / median / max', (s) => fd(s.islandMinSideD)),
    row('contour vertices median', (s) => f(s.contourVertices.median, 0)),
    row('bridges flat / ramp', (s) => `${s.flatBridges} / ${s.ramps}`),
    row('elevators', (s) => String(s.elevators)),
    row('bridge length D min / median / max', (s) => fd(s.bridgeLengthD)),
    row('bridge width D min / median / max', (s) => fd(s.bridgeWidthD, 2)),
    row('max ramp slope', (s) => f(s.maxRampSlope, 3)),
    row('elevator rise D min / max', (s) =>
      s.elevators ? `${f(s.elevatorRiseD.min, 2)} / ${f(s.elevatorRiseD.max, 2)}` : '–',
    ),
    row('small items', (s) => String(s.smallItems)),
    row('small items per 10 D² of land', (s) => f(s.smallPer10D2, 2)),
    row('islands with small items', (s) => `${f(s.islandsWithItemsShare * 100, 0)} %`),
    row('small item spacing D median', (s) => f(s.smallSpacingD.median, 2)),
    row('large items', (s) => String(s.largeItems)),
    row('restart points', (s) => String(s.restartPoints)),
    row('rail coverage of outline', (s) => `${f(s.railCoverage * 100, 0)} %`),
    row('levels D min / median / max', (s) => fd(s.levels)),
  ];
}
