/**
 * Parsing (structure) and `validateStage` (semantics) for contract data.
 *
 * `validateStage` implements every invariant of contracts §3 plus the consistency rules implied by the
 * field comments there. Each failure has a stable `code` so tests and tools can match on it:
 *
 * | code                      | rule |
 * |---------------------------|------|
 * | `schema`                  | structural (Zod) failure |
 * | `duplicate-id`            | island / bridge / elevator / item ids must be unique within their list |
 * | `unknown-island`          | every island reference (bridge, elevator, item, start, goal) must exist |
 * | `contour-degenerate`      | contour has < 3 points or zero area |
 * | `contour-orientation`     | contour must be "CCW" (positive signed area; see geometry.ts) |
 * | `contour-self-intersection` | contour / hole rings must be simple |
 * | `hole-orientation`        | holes must be "CW" (negative signed area) |
 * | `hole-outside`            | holes must lie inside their contour |
 * | `unreachable-island`      | §3: every island reachable from the start island via bridges + elevators |
 * | `goal-on-start-island`    | §3: goal on a different island from start unless there is only 1 island |
 * | `bridge-too-narrow`       | §3: bridge width ≥ MIN_BRIDGE_WIDTH_PX |
 * | `bridge-self-loop`        | bridge from === to |
 * | `bridge-crosses-island`   | §3: a bridge's swept rectangle must not overlap islands it doesn't connect |
 * | `bridge-endpoint-off-island` | `a` / `b` must lie on (within BALL_RADIUS_PX of) the from / to island |
 * | `bridge-level-mismatch`   | levelA / levelB must equal the from / to island levels |
 * | `bridge-type-mismatch`    | §3: ramp ⇔ |levelA − levelB| = 1; flat ⇔ equal levels |
 * | `bridge-mouth-blocked`    | guardrails need gaps at bridge mouths: the bridge's walkable lanes must not cross a guardrail of its endpoint islands |
 * | `elevator-level-mismatch` | levelLow/levelHigh must be the min/max of the two islands' levels, levelLow < levelHigh |
 * | `item-outside-island`     | §3: items inside their island, ≥ BALL_RADIUS_PX from any edge |
 * | `restart-outside-island`  | §3: restart points inside their island, ≥ BALL_RADIUS_PX from any edge |
 * | `start-outside-island`    | start inside its island, ≥ BALL_RADIUS_PX from any edge |
 * | `goal-outside-island`     | goal position inside its island |
 */
import type { z } from 'zod';
import { BALL_RADIUS_PX, MIN_BRIDGE_WIDTH_PX } from './constants.ts';
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
        `island ${isl.id} contour must be CCW (positive signed area)`,
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
        err('hole-orientation', `island ${isl.id} hole ${j} must be CW (negative area)`, hp);
      if (!h.every((pt) => pointInRing(pt, isl.contour)))
        err('hole-outside', `island ${isl.id} hole ${j} is not inside the contour`, hp);
    });
  });

  // --- bridges ------------------------------------------------------------------------------------
  stage.bridges.forEach((br, i) => {
    const p = `bridges[${i}]`;
    const from = ref(br.from, `${p}.from`);
    const to = ref(br.to, `${p}.to`);
    if (br.from === br.to) err('bridge-self-loop', `bridge ${br.id} connects island ${br.from} to itself`, p);
    if (br.width < MIN_BRIDGE_WIDTH_PX)
      err('bridge-too-narrow', `bridge ${br.id} width ${br.width} < ${MIN_BRIDGE_WIDTH_PX}`, `${p}.width`);

    const dl = Math.abs(br.levelA - br.levelB);
    if (br.type === 'ramp' && dl !== 1)
      err(
        'bridge-type-mismatch',
        `ramp ${br.id} must join levels differing by exactly 1 (got ${dl})`,
        `${p}.type`,
      );
    if (br.type === 'flat' && dl !== 0)
      err('bridge-type-mismatch', `flat bridge ${br.id} must join equal levels (got Δ${dl})`, `${p}.type`);

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

    if (from && !onOrInside(br.a, from))
      err('bridge-endpoint-off-island', `bridge ${br.id} endpoint a is not on island ${from.id}`, `${p}.a`);
    if (to && !onOrInside(br.b, to))
      err('bridge-endpoint-off-island', `bridge ${br.id} endpoint b is not on island ${to.id}`, `${p}.b`);

    const rect = bridgeRect(br.a, br.b, br.width);
    if (rect.length > 0) {
      for (const other of stage.islands) {
        if (other.id === br.from || other.id === br.to || other.contour.length < 3) continue;
        if (ringsOverlap(rect, other.contour))
          err(
            'bridge-crosses-island',
            `bridge ${br.id} crosses island ${other.id} which it doesn't connect`,
            p,
          );
      }
      // Walkable lanes: the centerline and two lines one ball radius inside the bridge edges.
      const lanes: [Vec2, Vec2][] = [[br.a, br.b]];
      const side = br.width / 2 - BALL_RADIUS_PX;
      if (side > 0) lanes.push(offsetSegment(br.a, br.b, side), offsetSegment(br.a, br.b, -side));
      for (const isl of [from, to]) {
        if (!isl) continue;
        const blocked = isl.guardrails.some((g) =>
          lanes.some(([s, e]) => segmentIntersectsPolyline(s, e, g)),
        );
        if (blocked)
          err(
            'bridge-mouth-blocked',
            `bridge ${br.id} mouth on island ${isl.id} is blocked by a guardrail`,
            p,
          );
      }
    }
  });

  // --- elevators ----------------------------------------------------------------------------------
  stage.elevators.forEach((el, i) => {
    const p = `elevators[${i}]`;
    const a = ref(el.islandFrom, `${p}.islandFrom`);
    const b = ref(el.islandTo, `${p}.islandTo`);
    if (el.levelLow >= el.levelHigh)
      err('elevator-level-mismatch', `elevator ${el.id} levelLow must be < levelHigh`, p);
    if (a && b) {
      const lo = Math.min(a.level, b.level);
      const hi = Math.max(a.level, b.level);
      if (el.levelLow !== lo || el.levelHigh !== hi)
        err(
          'elevator-level-mismatch',
          `elevator ${el.id} levels [${el.levelLow}, ${el.levelHigh}] ≠ island levels [${lo}, ${hi}]`,
          p,
        );
    }
  });

  // --- points with clearance ----------------------------------------------------------------------
  const clear = (pt: Vec2, isl: Island) =>
    pointInPolygon(pt, isl.contour, isl.holes) &&
    distanceToPolygonEdge(pt, isl.contour, isl.holes) >= BALL_RADIUS_PX;

  stage.items.forEach((it, i) => {
    const isl = ref(it.islandId, `items[${i}].islandId`);
    if (isl && !clear(it.pos, isl))
      err(
        'item-outside-island',
        `item ${it.id} is not inside island ${isl.id} with ${BALL_RADIUS_PX}px clearance`,
        `items[${i}].pos`,
      );
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

function onOrInside(pt: Vec2, isl: Island): boolean {
  if (isl.contour.length < 3) return false;
  return pointInRing(pt, isl.contour) || distanceToPolygonEdge(pt, isl.contour) <= BALL_RADIUS_PX;
}
