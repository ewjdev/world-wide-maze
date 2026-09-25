/**
 * The 2013 leash chase camera (E: `game/followcamera.follow` @910744, presets cameraAngle 35,
 * cameraBeta 21, cameraGamma .11, distance 5 WU), converted to metres and to a frame-rate independent lerp.
 *
 * - A dummy point trails the ball at a fixed horizontal leash (1.94 m).
 * - The camera sits behind the ball along ball→dummy, 4.63 m away at 35° elevation.
 * - That offset is rotated by the soft tilt quaternion (the horizon leans with the tilt).
 * - Position and target ease with 0.11 per 60 Hz tick (τ ≈ 0.14 s).
 * - N: instead of the 2013 `y ≥ 0` clamp, the camera rises when an island would block the view.
 */
import { Quaternion, Vector3 } from 'three/webgpu';
import { type Heightfield, lineOfSight, sampleTop } from '../geom/heightfield.ts';
import { WU } from '../palette.ts';

export const CHASE = {
  distance: 5 * WU,
  elevation: (35 * Math.PI) / 180,
  leash: 2.1 * WU,
  /** per 60 Hz tick */
  gamma: 0.11,
  fov: 70,
  near: 0.1 * WU,
  far: 1500 * WU,
} as const;

/** Frame-rate independent version of `lerp(x, 0.11)` applied once per 60 Hz tick. */
export function tickLerpAlpha(perTick: number, dtSec: number): number {
  return 1 - (1 - perTick) ** (dtSec * 60);
}

/**
 * Camera yaw convention shared with the simulation (`InputSample.frameYaw`): the yaw θ of a camera whose
 * forward (away from the camera, horizontal) direction is (−sin θ, 0, −cos θ). θ = 0 looks towards −Z,
 * i.e. up the page. This equals three.js' Euler-Y of the camera and the 2013 formula
 * `−atan2(r.z, r.x) − π/2` with r = ball − camera. Result in (−π, π].
 */
export function yawFromDirection(dx: number, dz: number): number {
  if (dx === 0 && dz === 0) return 0;
  return wrapAngle(Math.atan2(-dx, -dz));
}

export function wrapAngle(a: number): number {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
}

/**
 * Quaternion that rotates "down" towards the tilt, in the yaw frame: +tiltZ (pitch) moves gravity forward
 * (away from the camera), +tiltX (roll) moves it to the right. `k` scales both (camera lean uses 0.2 / 0.5).
 */
export function tiltQuaternion(
  tiltX: number,
  tiltZ: number,
  yaw: number,
  kPitch = 1,
  kRoll = 1,
  out = new Quaternion(),
): Quaternion {
  const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const qp = new Quaternion().setFromAxisAngle(right, tiltZ * kPitch);
  const qr = new Quaternion().setFromAxisAngle(fwd, -tiltX * kRoll);
  return out.copy(qp).multiply(qr);
}

export class ChaseCamera {
  readonly position = new Vector3();
  readonly target = new Vector3();
  readonly up = new Vector3(0, 1, 0);
  private readonly dummy = new Vector3();
  private readonly tmp = new Vector3();
  private readonly desired = new Vector3();
  private initialized = false;
  /** Freeze the position (falling: the camera watches the ball drop away). */
  holdPosition = false;

  constructor(private hf: Heightfield | null = null) {}

  setHeightfield(hf: Heightfield | null): void {
    this.hf = hf;
  }

  /**
   * Snap behind `ball`, facing `lookTowards` (E: `resetToStart` puts the camera behind the respawn point,
   * facing the goal).
   */
  reset(ball: Vector3, lookTowards: Vector3): void {
    const back = this.tmp.subVectors(ball, lookTowards).setY(0);
    if (back.lengthSq() < 1e-8) back.set(0, 0, 1);
    back.setLength(CHASE.leash);
    this.dummy.copy(ball).add(back);
    this.computeDesired(ball, null, this.desired);
    this.position.copy(this.desired);
    this.target.copy(ball);
    this.up.set(0, 1, 0);
    this.initialized = true;
  }

  /** Advance by dt. `lean` is the soft tilt quaternion (identity when reduced motion is on). */
  update(ball: Vector3, dtSec: number, lean: Quaternion | null): void {
    if (!this.initialized) {
      this.reset(ball, this.tmp.set(ball.x, ball.y, ball.z - 1));
    }
    // leash
    const o = this.tmp.subVectors(this.dummy, ball).setY(0);
    if (o.lengthSq() > 1e-10) {
      o.setLength(CHASE.leash);
      this.dummy.copy(ball).add(o);
    }
    this.computeDesired(ball, lean, this.desired);
    const a = tickLerpAlpha(CHASE.gamma, dtSec);
    if (!this.holdPosition) this.position.lerp(this.desired, a);
    this.target.lerp(ball, a);
    if (lean) this.up.set(0, 1, 0).applyQuaternion(lean);
    else this.up.set(0, 1, 0);
  }

  private computeDesired(ball: Vector3, lean: Quaternion | null, out: Vector3): Vector3 {
    const dir = out.subVectors(this.dummy, ball).setY(0);
    if (dir.lengthSq() < 1e-10) dir.set(0, 0, 1);
    dir.normalize();
    let elev: number = CHASE.elevation;
    // N: raise the camera until the line of sight to the ball clears the slabs.
    for (let k = 0; k < 8; k++) {
      this.offset(dir, elev, lean, ball);
      if (!this.hf) break;
      const p: [number, number, number] = [this.scratch.x, this.scratch.y, this.scratch.z];
      const clear = lineOfSight(this.hf, [ball.x, ball.y + 0.3, ball.z], p) >= 1;
      const ground = sampleTop(this.hf, p[0], p[2]);
      if (clear && (Number.isNaN(ground) || p[1] > ground + 0.4)) break;
      elev = Math.min(elev + 0.12, 1.45);
    }
    return out.copy(this.scratch);
  }

  private readonly scratch = new Vector3();
  private offset(dir: Vector3, elev: number, lean: Quaternion | null, ball: Vector3): void {
    const s = this.scratch.copy(dir).multiplyScalar(Math.cos(elev) * CHASE.distance);
    s.y = Math.sin(elev) * CHASE.distance;
    if (lean) s.applyQuaternion(lean);
    s.add(ball);
  }

  /** Current yaw (see `yawFromDirection`). */
  yaw(): number {
    return yawFromDirection(this.target.x - this.position.x, this.target.z - this.position.z);
  }
}
