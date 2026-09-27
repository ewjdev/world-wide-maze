/**
 * Runtime lock geometry (contracts §10.4, CCR-GAME-01; Phase 22). Pure: no Rapier, no DOM. Exported as
 * `@wwm/physics/locks` so the engine draws the gate exactly where the simulation blocks.
 *
 * A closed `bridge` or `elevator` lock is three static boxes:
 * - the **gate**: a wall across the connector, `LOCK_HEIGHT_M` tall. On a bridge its island-facing face is on the
 *   edge of island `islandId`; on an elevator it stands on the island just before the platform's entry end, so
 *   the ball pressed against it can't also touch the other platform's end face (a touch re-arms the jump, and the
 *   M0 spike saw the ball climb onto the upper platform that way). That is taller than the highest the ball can
 *   get: the M0 spike measured a 3.30 m apex of the ball's bottom with POWER, full forward tilt and a run-up
 *   (`scripts/jump-envelope.ts`), and wall contacts with a lock never re-arm the jump (simulation.ts);
 * - two **fences** (never drawn) just outside the connector's side rails, from the gate to the far end, so the
 *   ball can't hop past the gate's ends onto the deck or platform.
 * A `goal` lock has no geometry: the goal sensor itself refuses to latch while it is closed.
 */
import { LEVEL_HEIGHT_M, type LockSpec, PX_PER_METER, type StageData, type Vec2 } from '@wwm/schema';
import { pxToMeters, type Vec3 } from '@wwm/schema/space';
import { type BoxSpec, elevatorFootprint, gapIntoIsland, yawQuat } from './geometry.ts';
import { DEFAULT_PARAMS, type PhysicsParams } from './params.ts';

/** Gate and fence height above the floor on `islandId`'s side (m). Max measured jump apex (ball bottom) 3.30 m. */
export const LOCK_HEIGHT_M = 4.5;
/** Gate thickness along the connector (m). */
export const LOCK_GATE_THICKNESS_M = 0.3;
/** Side fence thickness (m). */
export const LOCK_FENCE_THICKNESS_M = 0.12;
/** The gate reaches this far past each fence (m), over the island's guardrail ends. */
export const LOCK_WING_M = 0.45;
/** Gate and fences reach this far below the floor (m), so nothing slips under them. */
const SINK_M = 0.35;
/** Elevator gates stand this far in front of the platform end (m). */
const ELEVATOR_GAP_M = 0.1;

export interface BarrierPose {
  lockId: number;
  kind: 'bridge' | 'elevator';
  targetId: number;
  islandId: number;
  /** World metres: the middle of the gate at floor level on `islandId`'s side. */
  center: Vec3;
  /** The same point in stage px. */
  page: Vec2;
  /** Horizontal unit axis (world x, z) pointing from `islandId`'s side into the connector. */
  dir: [number, number];
  /** three.js `rotation.y` that maps local +X onto (dir[0], 0, dir[1]); local Z then spans the gate's width. */
  yaw: number;
  /** Gate span across the connector (m), fences and wings included. */
  width: number;
  /** The connector's walkable width (m). */
  deckWidth: number;
  /** Gate thickness along `dir` (m). */
  thickness: number;
  /** Gate height above the floor (m). */
  height: number;
  /** Side fences: they run `length` m along `dir` from the gate's far face, between world heights `bottom`..`top`. */
  fence: { length: number; bottom: number; top: number };
}

function unit(dx: number, dy: number): [number, number] {
  const l = Math.sqrt(dx * dx + dy * dy);
  return l > 0 ? [dx / l, dy / l] : [1, 0];
}

/**
 * Where a lock's gate stands, or null for a `goal` lock or a spec that doesn't match the stage (unknown target, or
 * `islandId` is not one of the connector's two islands).
 */
export function barrierPose(
  stage: StageData,
  lock: LockSpec,
  p: PhysicsParams = DEFAULT_PARAMS,
): BarrierPose | null {
  const T = LOCK_GATE_THICKNESS_M;
  const side = p.railThickness + LOCK_FENCE_THICKNESS_M;
  if (lock.kind === 'bridge') {
    const br = stage.bridges.find((b) => b.id === lock.targetId);
    if (!br || (lock.islandId !== br.from && lock.islandId !== br.to)) return null;
    const atA = lock.islandId === br.from;
    const M = atA ? br.a : br.b;
    const far = atA ? br.b : br.a;
    const level = atA ? br.levelA : br.levelB;
    const farLevel = atA ? br.levelB : br.levelA;
    const d = unit(far[0] - M[0], far[1] - M[1]);
    const island = stage.islands.find((i) => i.id === lock.islandId);
    const gap = gapIntoIsland(M, [-d[0], -d[1]], island, 24);
    // the island edge on the connector's centre line, and the gate centre just past it
    const E: Vec2 = [M[0] - d[0] * gap, M[1] - d[1] * gap];
    const toFar = pxToMeters(Math.hypot(far[0] - E[0], far[1] - E[1]));
    const y = level * LEVEL_HEIGHT_M;
    const y2 = farLevel * LEVEL_HEIGHT_M;
    const deckWidth = pxToMeters(br.width);
    const cx = pxToMeters(E[0]) + (d[0] * T) / 2;
    const cz = pxToMeters(E[1]) + (d[1] * T) / 2;
    return {
      lockId: lock.id,
      kind: 'bridge',
      targetId: lock.targetId,
      islandId: lock.islandId,
      center: [cx, y, cz],
      page: [cx * PX_PER_METER, cz * PX_PER_METER],
      dir: d,
      yaw: Math.atan2(-d[1], d[0]),
      width: deckWidth + 2 * (side + LOCK_WING_M),
      deckWidth,
      thickness: T,
      height: LOCK_HEIGHT_M,
      fence: {
        length: Math.max(0, toFar - T),
        bottom: Math.min(y, y2) - SINK_M,
        top: Math.max(y, y2) + LOCK_HEIGHT_M,
      },
    };
  }
  if (lock.kind === 'elevator') {
    const el = stage.elevators.find((e) => e.id === lock.targetId);
    if (!el || (lock.islandId !== el.islandFrom && lock.islandId !== el.islandTo)) return null;
    const fp = elevatorFootprint(el, p);
    const low = lock.islandId === el.islandFrom;
    // entry end of the platform on islandId's side; dir points from there into the platform
    const s = low ? -1 : 1;
    const ex = fp.cx + s * fp.ux * fp.halfLen;
    const ez = fp.cz + s * fp.uz * fp.halfLen;
    const d: [number, number] = [-s * fp.ux, -s * fp.uz];
    const y = (low ? el.levelLow : el.levelHigh) * LEVEL_HEIGHT_M;
    const deckWidth = 2 * fp.halfWidth;
    const back = T / 2 + ELEVATOR_GAP_M;
    const cx = ex - d[0] * back;
    const cz = ez - d[1] * back;
    return {
      lockId: lock.id,
      kind: 'elevator',
      targetId: lock.targetId,
      islandId: lock.islandId,
      center: [cx, y, cz],
      page: [cx * PX_PER_METER, cz * PX_PER_METER],
      dir: d,
      yaw: Math.atan2(-d[1], d[0]),
      width: deckWidth + 2 * (side + LOCK_WING_M),
      deckWidth,
      thickness: T,
      height: LOCK_HEIGHT_M,
      fence: { length: 2 * fp.halfLen + ELEVATOR_GAP_M, bottom: y - SINK_M, top: y + LOCK_HEIGHT_M },
    };
  }
  return null;
}

/** The static colliders of a closed lock: gate + two side fences (empty for goal locks or unmatched specs). */
export function lockBoxes(stage: StageData, lock: LockSpec, p: PhysicsParams = DEFAULT_PARAMS): BoxSpec[] {
  const b = barrierPose(stage, lock, p);
  if (!b) return [];
  const [ux, uz] = b.dir;
  const rot = yawQuat(ux, uz);
  // local Z (across) = (−uz, 0, ux)
  const role = { type: 'lock', lockId: lock.id } as const;
  const [cx, y, cz] = b.center;
  const out: BoxSpec[] = [
    {
      shape: 'box',
      center: [cx, y + (b.height - SINK_M) / 2, cz],
      half: [b.thickness / 2, (b.height + SINK_M) / 2, b.width / 2],
      rot,
      role,
    },
  ];
  if (b.fence.length > 0) {
    const along = b.thickness / 2 + b.fence.length / 2; // from the gate centre
    const off = b.deckWidth / 2 + p.railThickness + LOCK_FENCE_THICKNESS_M / 2;
    const fy = (b.fence.bottom + b.fence.top) / 2;
    for (const sgn of [-1, 1]) {
      out.push({
        shape: 'box',
        center: [cx + ux * along - uz * off * sgn, fy, cz + uz * along + ux * off * sgn],
        half: [b.fence.length / 2, (b.fence.top - b.fence.bottom) / 2, LOCK_FENCE_THICKNESS_M / 2],
        rot,
        role,
      });
    }
  }
  return out;
}

/** Does a spec match the stage? (`goal` locks always do.) */
export function lockMatchesStage(stage: StageData, lock: LockSpec): boolean {
  return lock.kind === 'goal' || barrierPose(stage, lock) !== null;
}
