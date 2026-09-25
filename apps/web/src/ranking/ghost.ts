/**
 * Ghost balls (Phase 10): "Race the #1 run" (a stored, verified replay) and "Race the bot" (a Phase 09 solver
 * replay). A replay is `InputSample[]` at SIM_HZ (contracts §5); we re-simulate it once with the headless
 * @wwm/physics to get a track, then draw a translucent ball that follows the track in real time.
 *
 * The engine has no ghost API, so the ball is added to the engine scene through `engine.debug()` (documented as
 * the escape hatch for Phase 10). Follow-up for Phase 04: an `engine.addGhost()` with a proper glow material.
 */
import type { Engine } from '@wwm/engine';
import type { InputSample, StageData } from '@wwm/schema';
import { BALL_RADIUS_M, SIM_HZ } from '@wwm/schema';
import { IcosahedronGeometry, Mesh, MeshBasicMaterial, SphereGeometry } from 'three/webgpu';

export interface GhostTrack {
  hz: number;
  /** xyz per tick, world metres. */
  pos: Float32Array;
  /** xyzw per tick. */
  quat: Float32Array;
  ticks: number;
  /** Tick of the goal event, or -1. */
  goalTick: number;
}

/** Re-simulate `inputs` on `stage` and keep the ball pose of every tick (≈ 20 µs per tick). */
export async function recordGhostTrack(
  stage: StageData,
  inputs: readonly InputSample[],
): Promise<GhostTrack> {
  const { replay } = await import('@wwm/physics');
  const pos = new Float32Array(inputs.length * 3);
  const quat = new Float32Array(inputs.length * 4);
  const r = await replay(stage, inputs, {
    stopAtGoal: true,
    onStep: (tick, s) => {
      const i = tick - 1;
      pos.set(s.ball.pos, i * 3);
      quat.set(s.ball.quat, i * 4);
      return undefined;
    },
  });
  return {
    hz: SIM_HZ,
    pos: pos.subarray(0, r.ticks * 3),
    quat: quat.subarray(0, r.ticks * 4),
    ticks: r.ticks,
    goalTick: r.goalTick,
  };
}

/** Interpolated pose at `tSec` (clamped to the track). */
export function sampleTrack(track: GhostTrack, tSec: number, out = { pos: [0, 0, 0], quat: [0, 0, 0, 1] }) {
  const f = Math.max(0, Math.min(track.ticks - 1, tSec * track.hz));
  const i = Math.floor(f);
  const j = Math.min(track.ticks - 1, i + 1);
  const a = f - i;
  for (let k = 0; k < 3; k++) {
    const p0 = track.pos[i * 3 + k] ?? 0;
    const p1 = track.pos[j * 3 + k] ?? 0;
    out.pos[k] = p0 + (p1 - p0) * a;
  }
  for (let k = 0; k < 4; k++) out.quat[k] = track.quat[i * 4 + k] ?? (k === 3 ? 1 : 0);
  return out;
}

export interface GhostBall {
  /** Place the ghost at `tSec` into its run. Returns true once the run is over. */
  update(tSec: number): boolean;
  setVisible(on: boolean): void;
  dispose(): void;
}

export interface GhostStyle {
  color?: number;
  opacity?: number;
  /** Size multiplier (e.g. larger in the map view so it reads from far away). */
  scale?: number;
  /**
   * `solid` (default): one translucent sphere. `holo` (the game, 08b): a faint shell inside a faceted wire cage,
   * so the ghost reads as "not a ball" next to the player's and matches the world's wireframe goal/items.
   */
  look?: 'solid' | 'holo';
}

/** A translucent ball in the engine scene that replays `track`. */
export function createGhostBall(engine: Engine, track: GhostTrack, style: GhostStyle = {}): GhostBall {
  const { scene } = engine.debug();
  const geo = new SphereGeometry(BALL_RADIUS_M, 24, 16);
  const mat = new MeshBasicMaterial({
    color: style.color ?? 0x2fd3e0,
    transparent: true,
    opacity: style.opacity ?? 0.62,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'wwm-ghost';
  mesh.renderOrder = 10;
  mesh.scale.setScalar(style.scale ?? 1);
  let cageGeo: IcosahedronGeometry | null = null;
  let cageMat: MeshBasicMaterial | null = null;
  if (style.look === 'holo') {
    mat.opacity = Math.min(mat.opacity, 0.22);
    cageGeo = new IcosahedronGeometry(BALL_RADIUS_M * 1.04, 1);
    cageMat = new MeshBasicMaterial({
      color: style.color ?? 0x2fd3e0,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const cage = new Mesh(cageGeo, cageMat);
    cage.renderOrder = 11;
    mesh.add(cage);
  }
  scene.add(mesh);
  const pose = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
  // A scaled-up ghost still rests on the surface.
  const lift = ((style.scale ?? 1) - 1) * BALL_RADIUS_M;
  return {
    update(tSec) {
      sampleTrack(track, tSec, pose);
      mesh.position.set(pose.pos[0] ?? 0, (pose.pos[1] ?? 0) + lift, pose.pos[2] ?? 0);
      mesh.quaternion.set(pose.quat[0] ?? 0, pose.quat[1] ?? 0, pose.quat[2] ?? 0, pose.quat[3] ?? 1);
      return tSec * track.hz >= track.ticks - 1;
    },
    setVisible(on) {
      mesh.visible = on;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      cageGeo?.dispose();
      cageMat?.dispose();
    },
  };
}
