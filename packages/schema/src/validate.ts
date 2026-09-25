/**
 * Parsing (structure) and `validateStage` (semantics) for contract data.
 *
 * `validateStage` implements every invariant of contracts §3 plus the §9 consistency rules. Each failure has
 * a stable `code` so tests and tools can match on it:
 *
 * | code                      | rule |
 * |---------------------------|------|
 * | `schema`                  | structural (Zod) failure |
 * | `duplicate-id`            | island / bridge / elevator / item ids must be unique within their list |
 * | `unknown-island`          | every island reference (bridge, elevator, item, start, goal) must exist |
 * | `slice-invalid`           | `source.slice.index` < `source.slice.count` |
 * | `out-of-bounds`           | §3: all geometry lies within `size` (contours, holes, rails, restart points, bridge/elevator endpoints, items, start, goal) |
 * | `contour-degenerate`      | contour has < 3 points or zero area |
 * | `contour-orientation`     | contour must have positive signed area (`isCCW`, §9) |
 * | `contour-self-intersection` | contour / hole rings must be simple |
 * | `hole-orientation`        | holes must have the opposite orientation (negative signed area) |
 * | `hole-outside`            | holes must lie inside their contour |
 * | `unreachable-island`      | §3: every island reachable from the start island via bridges + elevators |
 * | `goal-on-start-island`    | §3: goal on a different island from start unless there is only 1 island |
 * | `bridge-too-narrow`       | §3: bridge width ≥ MIN_BRIDGE_WIDTH_PX |
 * | `bridge-self-loop`        | bridge from === to |
 * | `bridge-crosses-island`   | §3: a bridge's swept rectangle must not overlap islands it doesn't connect |
 * | `bridge-endpoint-off-island` | `a` / `b` must lie on (within ENDPOINT_TOLERANCE_PX of) the from / to island |
 * | `bridge-level-mismatch`   | levelA / levelB must equal the from / to island levels |
 * | `bridge-type-mismatch`    | §3: 'ramp' iff levelA ≠ levelB |
 * | `ramp-too-steep`          | §3: |Δlevel·LEVEL_HEIGHT_M| / (|b−a| / PX_PER_METER) ≤ MAX_RAMP_SLOPE |
 * | `bridge-mouth-blocked`    | rails need gaps at bridge mouths: the bridge's walkable lanes must not cross a guardrail of its endpoint islands |
 * | `elevator-too-narrow`     | elevator width ≥ MIN_BRIDGE_WIDTH_PX (same footprint convention as a bridge) |
 * | `elevator-self-loop`      | islandFrom === islandTo |
 * | `elevator-level-mismatch` | levelLow < levelHigh, levelLow = islandFrom's level (from = lower island), levelHigh = islandTo's level |
 * | `elevator-endpoint-off-island` | `a` (lower platform) / `b` (upper) must lie on (within ENDPOINT_TOLERANCE_PX of) islandFrom / islandTo |
 * | `elevator-crosses-island` | the elevator footprint must not overlap islands it doesn't connect |
 * | `elevator-mouth-blocked`  | rails need gaps at elevator mouths too |
 * | `too-many-large-items`    | §3: at most MAX_LARGE_ITEMS large items |
 * | `item-outside-island`     | §3: items inside their island, ≥ ITEM_EDGE_CLEARANCE_PX from any edge |
 * | `restart-outside-island`  | §3: restart points inside their island, ≥ BALL_RADIUS_PX from any edge |
 * | `start-outside-island`    | start inside its island, ≥ BALL_RADIUS_PX from any edge |
 * | `goal-outside-island`     | goal position inside its island |
 */
import type { z } from 'zod';
import {
  BALL_RADIUS_PX,
  ENDPOINT_TOLERANCE_PX,
  ITEM_EDGE_CLEARANCE_PX,
  LEVEL_HEIGHT_M,
  MAX_LARGE_ITEMS,
  MAX_PORTALS,
  MAX_RAMP_SLOPE,
  MIN_BRIDGE_WIDTH_PX,
  PX_PER_METER,
} from './constants.ts';
import {
  bridgeRect,
  distanceToPolygonEdge,
  offsetSegment,
  pointInPolygon,
  pointInRing,
  ringSelfIntersects,
  ringsOverlap,
  segmentIntersectsPolyline,
  signedArea,
} from './geometry.ts';
import type { CaptureBundle, ControlMessage, Island, StageData, Vec2 } from './types.ts';
import { CaptureBundleSchema, ControlMessageSchema, StageDataSchema } from './zod.ts';

export interface StageValidationError {
  code: string;
  message: string;
  /** JSON-pointer-ish location, e.g. `bridges[2].width`. */
  path?: string;
}

export interface StageValidationResult {
  ok: boolean;
  errors: StageValidationError[];
}

/** Thrown by the `parse*` helpers. `issues` is the flattened Zod issue list. */
export class SchemaError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(what: string, issues: { path: string; message: string }[]) {
    super(`Invalid ${what}: ${issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; ')}`);
    this.name = 'SchemaError';
    this.issues = issues;
  }
}

function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({
    path: i.path
      .map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`))
      .join('')
      .replace(/^\./, ''),
    message: i.message,
  }));
}

/** Parse unknown JSON into a `CaptureBundle`, throwing `SchemaError` on structural problems. */
export function parseCapture(input: unknown): CaptureBundle {
  const r = CaptureBundleSchema.safeParse(input);
  if (!r.success) throw new SchemaError('CaptureBundle', formatIssues(r.error));
  return r.data;
}

/** Parse unknown JSON into `StageData` (structure only; call `validateStage` for invariants). */
export function parseStage(input: unknown): StageData {
  const r = StageDataSchema.safeParse(input);
  if (!r.success) throw new SchemaError('StageData', formatIssues(r.error));
  return r.data;
}

/** Parse a JSON text frame from the room socket. Returns null on malformed or unknown messages. */
export function parseControlMessage(text: string): ControlMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const r = ControlMessageSchema.safeParse(json);
  return r.success ? r.data : null;
}

/** Ramp slope (rise over horizontal run, both in meters) of a bridge-like span. Infinity for a zero-length rise. */
export function rampSlope(a: Vec2, b: Vec2, levelA: number, levelB: number): number {
  const rise = Math.abs(levelA - levelB) * LEVEL_HEIGHT_M;
  if (rise === 0) return 0;
  const run = Math.hypot(b[0] - a[0], b[1] - a[1]) / PX_PER_METER;
  return run === 0 ? Number.POSITIVE_INFINITY : rise / run;
}

/** Tolerance for float comparisons of slopes and bounds. */
const EPS = 1e-9;

/**
 * Validate a stage: structure first (Zod), then every semantic invariant. Accepts `unknown` so it can be
 * used directly on fetched JSON. Never throws.
 */
export function validateStage(input: unknown): StageValidationResult {
  const parsed = StageDataSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: formatIssues(parsed.error).map((i) => ({ code: 'schema', message: i.message, path: i.path })),
    };
  }
  const stage = parsed.data;
  const errors: StageValidationError[] = [];
  const err = (code: string, message: string, path?: string) =>
    errors.push(path === undefined ? { code, message } : { code, message, path });

  // --- ids & references ---------------------------------------------------------------------------
  const islandById = new Map<number, Island>();
  const checkUnique = (list: { id: number }[], name: string) => {
    const seen = new Set<number>();
    list.forEach((x, i) => {
      if (seen.has(x.id)) err('duplicate-id', `duplicate ${name} id ${x.id}`, `${name}[${i}].id`);
      seen.add(x.id);
    });
  };
  checkUnique(stage.islands, 'islands');
  checkUnique(stage.bridges, 'bridges');
  checkUnique(stage.elevators, 'elevators');
  checkUnique(stage.items, 'items');
  for (const isl of stage.islands) if (!islandById.has(isl.id)) islandById.set(isl.id, isl);

  const ref = (id: number, path: string): Island | undefined => {
    const isl = islandById.get(id);
    if (!isl) err('unknown-island', `references unknown island ${id}`, path);
    return isl;
  };

  // --- slice & bounds -----------------------------------------------------------------------------
  const { slice } = stage.source;
  if (slice.index >= slice.count)
    err('slice-invalid', `slice index ${slice.index} ≥ count ${slice.count}`, 'source.slice');

  const { width: W, height: H } = stage.size;
  const inside = (p: Vec2) => p[0] >= -EPS && p[1] >= -EPS && p[0] <= W + EPS && p[1] <= H + EPS;
  const bounds = (pts: readonly Vec2[], what: string, path: string): void => {
    const bad = pts.find((p) => !inside(p));
    if (bad) err('out-of-bounds', `${what} has point (${bad[0]}, ${bad[1]}) outside size ${W}×${H}`, path);
  };
  for (const [i, isl] of stage.islands.entries()) {
    const p = `islands[${i}]`;
    bounds(isl.contour, `island ${isl.id} contour`, `${p}.contour`);
    for (const [j, h] of isl.holes.entries()) bounds(h, `island ${isl.id} hole ${j}`, `${p}.holes[${j}]`);
    for (const [j, g] of isl.guardrails.entries())
      bounds(g, `island ${isl.id} guardrail ${j}`, `${p}.guardrails[${j}]`);
    bounds(isl.restartPoints, `island ${isl.id} restart points`, `${p}.restartPoints`);
  }
  for (const [i, br] of stage.bridges.entries()) bounds([br.a, br.b], `bridge ${br.id}`, `bridges[${i}]`);
  for (const [i, el] of stage.elevators.entries())
    bounds([el.a, el.b], `elevator ${el.id}`, `elevators[${i}]`);
  for (const [i, it] of stage.items.entries()) bounds([it.pos], `item ${it.id}`, `items[${i}].pos`);
  bounds([stage.start.pos], 'start', 'start.pos');
  bounds([stage.goal.pos], 'goal', 'goal.pos');

  // --- island geometry ----------------------------------------------------------------------------
  stage.islands.forEach((isl, i) => {
    const p = `islands[${i}]`;
    const area = isl.contour.length >= 3 ? signedArea(isl.contour) : 0;
    if (isl.contour.length < 3 || area === 0) {
      err('contour-degenerate', `island ${isl.id} contour has < 3 points or zero area`, `${p}.contour`);
      return;
    }
    if (area < 0)
      err(
        'contour-orientation',
        `island ${isl.id} contour must have positive signed area (isCCW)`,
        `${p}.contour`,
      );
    if (ringSelfIntersects(isl.contour))
      err('contour-self-intersection', `island ${isl.id} contour self-intersects`, `${p}.contour`);
    isl.holes.forEach((h, j) => {
      const hp = `${p}.holes[${j}]`;
      if (h.length < 3 || ringSelfIntersects(h)) {
        err('contour-self-intersection', `island ${isl.id} hole ${j} is degenerate or self-intersects`, hp);
        return;
      }
      if (signedArea(h) >= 0)
        err('hole-orientation', `island ${isl.id} hole ${j} must have negative signed area`, hp);
      if (!h.every((pt) => pointInRing(pt, isl.contour)))
        err('hole-outside', `island ${isl.id} hole ${j} is not inside the contour`, hp);
    });
  });

  /**
   * Checks shared by bridges and elevators (both are a centerline a→b with a width): no crossing of
   * unconnected islands, and rail gaps at both mouths.
   */
  const checkSpan = (
    kind: 'bridge' | 'elevator',
    span: { id: number; a: Vec2; b: Vec2; width: number },
    ends: (Island | undefined)[],
    path: string,
  ) => {
    const rect = bridgeRect(span.a, span.b, span.width);
    if (rect.length === 0) return;
    const connected = new Set(ends.filter((x): x is Island => !!x).map((x) => x.id));
    for (const other of stage.islands) {
      if (connected.has(other.id) || other.contour.length < 3) continue;
      if (ringsOverlap(rect, other.contour))
        err(
          `${kind}-crosses-island`,
          `${kind} ${span.id} crosses island ${other.id} which it doesn't connect`,
          path,
        );
    }
    // Walkable lanes: the centerline and two lines one ball radius inside the edges.
    const lanes: [Vec2, Vec2][] = [[span.a, span.b]];
    const side = span.width / 2 - BALL_RADIUS_PX;
    if (side > 0) lanes.push(offsetSegment(span.a, span.b, side), offsetSegment(span.a, span.b, -side));
    for (const isl of ends) {
      if (!isl) continue;
      const blocked = isl.guardrails.some((g) => lanes.some(([s, e]) => segmentIntersectsPolyline(s, e, g)));
      if (blocked)
        err(
          `${kind}-mouth-blocked`,
          `${kind} ${span.id} mouth on island ${isl.id} is blocked by a guardrail`,
          path,
        );
    }
  };

  // --- bridges ------------------------------------------------------------------------------------
  stage.bridges.forEach((br, i) => {
    const p = `bridges[${i}]`;
    const from = ref(br.from, `${p}.from`);
    const to = ref(br.to, `${p}.to`);
    if (br.from === br.to) err('bridge-self-loop', `bridge ${br.id} connects island ${br.from} to itself`, p);
    if (br.width < MIN_BRIDGE_WIDTH_PX)
      err('bridge-too-narrow', `bridge ${br.id} width ${br.width} < ${MIN_BRIDGE_WIDTH_PX}`, `${p}.width`);

    const differ = br.levelA !== br.levelB;
    if (br.type === 'ramp' && !differ)
      err('bridge-type-mismatch', `ramp ${br.id} joins equal levels (${br.levelA})`, `${p}.type`);
    if (br.type === 'flat' && differ)
      err(
        'bridge-type-mismatch',
        `flat bridge ${br.id} joins different levels (${br.levelA} → ${br.levelB})`,
        `${p}.type`,
      );
    const slope = rampSlope(br.a, br.b, br.levelA, br.levelB);
    if (slope > MAX_RAMP_SLOPE + EPS)
      err(
        'ramp-too-steep',
        `bridge ${br.id} slope ${slope.toFixed(4)} > ${MAX_RAMP_SLOPE} (use an elevator)`,
        p,
      );

    if (from && br.levelA !== from.level)
      err(
        'bridge-level-mismatch',
        `bridge ${br.id} levelA ${br.levelA} ≠ island ${from.id} level ${from.level}`,
        `${p}.levelA`,
      );
    if (to && br.levelB !== to.level)
      err(
        'bridge-level-mismatch',
        `bridge ${br.id} levelB ${br.levelB} ≠ island ${to.id} level ${to.level}`,
        `${p}.levelB`,
      );

    if (from && !onOrNear(br.a, from))
      err('bridge-endpoint-off-island', `bridge ${br.id} endpoint a is not on island ${from.id}`, `${p}.a`);
    if (to && !onOrNear(br.b, to))
      err('bridge-endpoint-off-island', `bridge ${br.id} endpoint b is not on island ${to.id}`, `${p}.b`);

    checkSpan('bridge', br, [from, to], p);
  });

  // --- elevators ----------------------------------------------------------------------------------
  stage.elevators.forEach((el, i) => {
    const p = `elevators[${i}]`;
    const lo = ref(el.islandFrom, `${p}.islandFrom`);
    const hi = ref(el.islandTo, `${p}.islandTo`);
    if (el.islandFrom === el.islandTo)
      err('elevator-self-loop', `elevator ${el.id} connects island ${el.islandFrom} to itself`, p);
    if (el.width < MIN_BRIDGE_WIDTH_PX)
      err(
        'elevator-too-narrow',
        `elevator ${el.id} width ${el.width} < ${MIN_BRIDGE_WIDTH_PX}`,
        `${p}.width`,
      );
    if (el.levelLow >= el.levelHigh)
      err('elevator-level-mismatch', `elevator ${el.id} levelLow must be < levelHigh`, p);
    if (lo && el.levelLow !== lo.level)
      err(
        'elevator-level-mismatch',
        `elevator ${el.id} levelLow ${el.levelLow} ≠ islandFrom ${lo.id} level ${lo.level} (from = lower island)`,
        `${p}.levelLow`,
      );
    if (hi && el.levelHigh !== hi.level)
      err(
        'elevator-level-mismatch',
        `elevator ${el.id} levelHigh ${el.levelHigh} ≠ islandTo ${hi.id} level ${hi.level}`,
        `${p}.levelHigh`,
      );
    if (lo && !onOrNear(el.a, lo))
      err(
        'elevator-endpoint-off-island',
        `elevator ${el.id} lower platform a is not on island ${lo.id}`,
        `${p}.a`,
      );
    if (hi && !onOrNear(el.b, hi))
      err(
        'elevator-endpoint-off-island',
        `elevator ${el.id} upper platform b is not on island ${hi.id}`,
        `${p}.b`,
      );
    checkSpan('elevator', el, [lo, hi], p);
  });

  // --- items & points with clearance --------------------------------------------------------------
  const large = stage.items.filter((it) => it.kind === 'large').length;
  if (large > MAX_LARGE_ITEMS)
    err('too-many-large-items', `${large} large items > MAX_LARGE_ITEMS (${MAX_LARGE_ITEMS})`, 'items');

  const clear = (pt: Vec2, isl: Island, margin = BALL_RADIUS_PX) =>
    pointInPolygon(pt, isl.contour, isl.holes) && distanceToPolygonEdge(pt, isl.contour, isl.holes) >= margin;

  stage.items.forEach((it, i) => {
    const isl = ref(it.islandId, `items[${i}].islandId`);
    if (isl && !clear(it.pos, isl, ITEM_EDGE_CLEARANCE_PX))
      err(
        'item-outside-island',
        `item ${it.id} is not inside island ${isl.id} with ${ITEM_EDGE_CLEARANCE_PX}px clearance`,
        `items[${i}].pos`,
      );
  });
  // --- portals (contracts §10.1) ---------------------------------------------------------------------
  const portals = stage.portals ?? [];
  if (portals.length > MAX_PORTALS)
    err('too-many-portals', `${portals.length} portals > MAX_PORTALS (${MAX_PORTALS})`, 'portals');
  const hrefs = new Set<string>();
  portals.forEach((p, i) => {
    const isl = ref(p.islandId, `portals[${i}].islandId`);
    if (isl && !clear(p.pos, isl))
      err(
        'portal-outside-island',
        `portal ${p.id} lacks ${BALL_RADIUS_PX}px clearance on island ${isl.id}`,
        `portals[${i}].pos`,
      );
    let ok = false;
    try {
      const u = new URL(p.href);
      ok = (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
    } catch {}
    if (!ok)
      err('portal-bad-href', `portal ${p.id} href must be http(s) without credentials`, `portals[${i}].href`);
    if (hrefs.has(p.href))
      err('portal-duplicate-href', `portal ${p.id} repeats ${p.href}`, `portals[${i}].href`);
    hrefs.add(p.href);
  });

  stage.islands.forEach((isl, i) => {
    isl.restartPoints.forEach((pt, j) => {
      if (!clear(pt, isl))
        err(
          'restart-outside-island',
          `island ${isl.id} restart point ${j} lacks ${BALL_RADIUS_PX}px clearance`,
          `islands[${i}].restartPoints[${j}]`,
        );
    });
  });
  const startIsl = ref(stage.start.islandId, 'start.islandId');
  if (startIsl && !clear(stage.start.pos, startIsl))
    err('start-outside-island', `start is not inside island ${startIsl.id} with clearance`, 'start.pos');
  const goalIsl = ref(stage.goal.islandId, 'goal.islandId');
  if (goalIsl && !pointInPolygon(stage.goal.pos, goalIsl.contour, goalIsl.holes))
    err('goal-outside-island', `goal is not inside island ${goalIsl.id}`, 'goal.pos');

  // --- start / goal / reachability ----------------------------------------------------------------
  if (stage.islands.length > 1 && stage.goal.islandId === stage.start.islandId)
    err('goal-on-start-island', 'goal must be on a different island from the start', 'goal.islandId');

  if (startIsl) {
    const adj = new Map<number, number[]>();
    const link = (x: number, y: number) => {
      if (!islandById.has(x) || !islandById.has(y)) return;
      adj.set(x, [...(adj.get(x) ?? []), y]);
      adj.set(y, [...(adj.get(y) ?? []), x]);
    };
    for (const br of stage.bridges) link(br.from, br.to);
    for (const el of stage.elevators) link(el.islandFrom, el.islandTo);
    const seen = new Set([startIsl.id]);
    const queue = [startIsl.id];
    while (queue.length > 0) {
      const cur = queue.shift() as number;
      for (const n of adj.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    stage.islands.forEach((isl, i) => {
      if (!seen.has(isl.id))
        err('unreachable-island', `island ${isl.id} is not reachable from the start island`, `islands[${i}]`);
    });
  }

  return { ok: errors.length === 0, errors };
}

function onOrNear(pt: Vec2, isl: Island): boolean {
  if (isl.contour.length < 3) return false;
  return pointInRing(pt, isl.contour) || distanceToPolygonEdge(pt, isl.contour) <= ENDPOINT_TOLERANCE_PX;
}
