/**
 * Headless Rapier simulation implementing the contract `Simulation` (contracts §5).
 * Runs as-is in Node (Vitest, solver) and inside the Web Worker (worker.ts).
 *
 * Model (E, docs/reference/fidelity-spec.md §1–2, §4):
 * - Tilt rotates gravity by (tiltZ pitch, tiltX roll) in the `frameYaw` heading frame, only while POWER is
 *   held; the tilt target is smoothed with τ ≈ 0.18 s and eases back to 0 on release.
 * - Angular damping 1.20/s with POWER, 4.61/s without (brakes). Linear damping 1.20/s always.
 * - Jump: +16.7 m/s up if any contact within the last 100 ms; POWER not required.
 * - Falls: 'fell' below (lowest island top − 9 m) → input ignored, gravity ×2 over 1 s, 'lost' 3 s later.
 * - Elevators: trigger-activated two-platform lifts, ball velocity zeroed and carried during the ride.
 *
 * frameYaw convention (CCR-05-1): yaw 0 ⇒ forward (+tiltZ) = world −Z (page up) and right (+tiltX) = +X;
 * yaw increases counter-clockwise seen from above (right-handed about +Y), i.e. three.js `camera.rotation.y`
 * with Euler order 'YXZ'. forward = (−sin ψ, 0, −cos ψ), right = (cos ψ, 0, −sin ψ).
 */
import type * as RapierNS from '@dimforge/rapier3d-deterministic-compat';
import {
  type BallState,
  distanceToPolygonEdge,
  type Elevator,
  type InputSample,
  type Island,
  type Item,
  pointInPolygon,
  type SimEvent,
  type SimStepResult,
  type Simulation,
  type StageData,
  type Vec2,
} from '@wwm/schema';
import { pageToWorld, pxToMeters, worldToPage } from '@wwm/schema/space';
import { dcos, dsin, oneMinusExpNeg } from './dmath.ts';
import {
  type ColliderRole,
  countTriangles,
  type ElevatorFootprint,
  elevatorFootprint,
  inFootprint,
  type StaticSpec,
  staticSpecs,
} from './geometry.ts';
import { type PhysicsParams, resolveParams } from './params.ts';
import { loadRapier, type Rapier, type RapierBuild } from './rapier.ts';

type World = RapierNS.World;
type RigidBody = RapierNS.RigidBody;
type Collider = RapierNS.Collider;

export interface SimulationOptions {
  /** Overrides for DEFAULT_PARAMS (sandbox sliders, 60 Hz parity mode). */
  params?: Partial<PhysicsParams>;
  /** Rapier build; default 'deterministic'. */
  rapier?: RapierBuild;
}

type Role = ColliderRole | { type: 'elevator'; elevatorId: number };

interface ElevatorRt {
  def: Elevator;
  fp: ElevatorFootprint;
  low: number; // world y of the platform top at each end
  high: number;
  bodies: [RigidBody, RigidBody];
  colliders: [Collider[], Collider[]];
  /** Current top height of platform 0 / 1. Platform 0 starts low, platform 1 high. */
  y: [number, number];
  ride: {
    carrier: 0 | 1;
    from: number;
    to: number;
    start: number;
    ticks: number;
    /** Ball start (world x, z) and its along-axis shift over the ride (m, eased like the platform). */
    bx: number;
    bz: number;
    shift: number;
  } | null;
  /** Distance (m) from `b` back along the axis to the upper island's edge (b is inset into it). */
  edgeBack: number;
  cooldownUntil: number;
  wasInLow: boolean;
  wasInHigh: boolean;
  /** Platform whose colliders are waiting to be re-enabled until the ball is out of its way (−1: none). */
  pending: -1 | 0 | 1;
}

export interface SimStats {
  triangles: number;
  colliders: number;
  lastStepMs: number;
  tick: number;
}

const NEG_INF_TICK = -1e9;

function cubicInOut(u: number): number {
  if (u < 0.5) return 4 * u * u * u;
  const f = -2 * u + 2;
  return 1 - (f * f * f) / 2;
}

function clamp(v: number, lim: number): number {
  return v > lim ? lim : v < -lim ? -lim : v;
}

export class RapierSimulation implements Simulation {
  readonly params: PhysicsParams;
  private readonly R: Rapier;
  private world: World | null = null;
  private stage: StageData | null = null;
  private ball: RigidBody | null = null;
  private ballCol: Collider | null = null;
  private roles = new Map<number, Role>();
  private itemsByHandle = new Map<number, { item: Item; col: Collider }>();
  private goalHandle = -1;
  private elevators: ElevatorRt[] = [];
  private islandsById = new Map<number, Island>();
  private lowestTop = 0;
  private triangles = 0;

  // per-run state
  private tick = 0;
  private tiltX = 0;
  private tiltZ = 0;
  private prevJump = false;
  private lastContactTick = NEG_INF_TICK;
  private lastTouchTick = NEG_INF_TICK;
  private prevTouching = new Set<number>();
  private lastIslandId = -1;
  private lastIslandPos: Vec2 = [0, 0];
  private falling = false;
  private fellTick = 0;
  private lostEmitted = false;
  private goalReached = false;
  private riding: ElevatorRt | null = null;
  private lastStepMs = 0;

  // derived per-tick constants
  private readonly dt: number;
  private readonly tiltAlpha: number;
  private readonly graceTicks: number;
  private readonly landedAirTicks: number;

  // scratch
  private readonly v0 = { x: 0, y: 0, z: 0 };

  constructor(R: Rapier, params: PhysicsParams) {
    this.R = R;
    this.params = params;
    this.dt = 1 / params.simHz;
    this.tiltAlpha = oneMinusExpNeg(this.dt / params.tiltTau);
    this.graceTicks = Math.round(params.jumpGraceSec * params.simHz);
    this.landedAirTicks = Math.round(params.landedMinAirSec * params.simHz);
  }

  static async create(opts: SimulationOptions = {}): Promise<RapierSimulation> {
    const R = await loadRapier(opts.rapier);
    return new RapierSimulation(R, resolveParams(opts.params));
  }

  // ───────────────────────────────────────── load ─────────────────────────────────────────

  async load(stage: StageData): Promise<void> {
    this.freeWorld();
    const R = this.R;
    const p = this.params;
    this.stage = stage;
    this.islandsById = new Map(stage.islands.map((i) => [i.id, i] as const));
    this.lowestTop = Math.min(...stage.islands.map((i) => pageToWorld([0, 0], i.level)[1]));

    const world = new R.World({ x: 0, y: -p.gravity, z: 0 });
    world.timestep = this.dt;
    world.numSolverIterations = p.solverIterations;
    this.world = world;

    const floor = (d: RapierNS.ColliderDesc, rail: boolean) =>
      d
        .setFriction(rail ? p.railFriction : p.floorFriction)
        .setRestitution(rail ? p.railRestitution : p.floorRestitution)
        .setFrictionCombineRule(R.CoefficientCombineRule.Multiply)
        .setRestitutionCombineRule(R.CoefficientCombineRule.Multiply);

    const specs: StaticSpec[] = staticSpecs(stage, p);
    this.triangles = countTriangles(specs);
    for (const s of specs) {
      const rail = s.role.type === 'rail' || s.role.type === 'bridge-rail';
      const desc =
        s.shape === 'trimesh'
          ? R.ColliderDesc.trimesh(s.vertices, s.indices, R.TriMeshFlags.FIX_INTERNAL_EDGES)
          : R.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2])
              .setTranslation(s.center[0], s.center[1], s.center[2])
              .setRotation({ x: s.rot[0], y: s.rot[1], z: s.rot[2], w: s.rot[3] });
      const col = world.createCollider(floor(desc, rail));
      this.roles.set(col.handle, s.role);
    }

    // Elevators: two kinematic platforms sharing one footprint.
    this.elevators = stage.elevators.map((e) => {
      const fp = elevatorFootprint(e, p);
      const low = pageToWorld([0, 0], e.levelLow)[1];
      const high = pageToWorld([0, 0], e.levelHigh)[1];
      const mk = (y: number): [RigidBody, Collider[]] => {
        const body = world.createRigidBody(
          R.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(fp.cx, y, fp.cz)
            .setRotation({ x: fp.rot[0], y: fp.rot[1], z: fp.rot[2], w: fp.rot[3] }),
        );
        const cols = [
          world.createCollider(
            floor(
              R.ColliderDesc.cuboid(fp.halfLen, p.slabThickness / 2, fp.halfWidth).setTranslation(
                0,
                -p.slabThickness / 2,
                0,
              ),
              false,
            ),
            body,
          ),
        ];
        for (const side of [-1, 1]) {
          cols.push(
            world.createCollider(
              floor(
                R.ColliderDesc.cuboid(fp.halfLen, p.railHeight / 2, p.railThickness / 2).setTranslation(
                  0,
                  p.railHeight / 2,
                  side * (fp.halfWidth + p.railThickness / 2),
                ),
                true,
              ),
              body,
            ),
          );
        }
        for (const c of cols) this.roles.set(c.handle, { type: 'elevator', elevatorId: e.id });
        return [body, cols];
      };
      const [b0, c0] = mk(low);
      const [b1, c1] = mk(high);
      return {
        def: e,
        fp,
        low,
        high,
        bodies: [b0, b1],
        colliders: [c0, c1],
        y: [low, high],
        ride: null,
        cooldownUntil: 0,
        wasInLow: false,
        wasInHigh: false,
        pending: -1,
        edgeBack: this.edgeBack(e),
      } satisfies ElevatorRt;
    });

    // Items (sensor spheres) and goal (sensor cylinder).
    for (const item of stage.items) {
      const island = this.islandsById.get(item.islandId);
      const w = pageToWorld(item.pos, island?.level ?? 0);
      const col = world.createCollider(
        R.ColliderDesc.ball(p.itemRadius)
          .setTranslation(w[0], w[1] + p.itemHeight, w[2])
          .setSensor(true),
      );
      this.itemsByHandle.set(col.handle, { item, col });
    }
    {
      const island = this.islandsById.get(stage.goal.islandId);
      const w = pageToWorld(stage.goal.pos, island?.level ?? 0);
      const col = world.createCollider(
        R.ColliderDesc.cylinder(p.goalHeight / 2, pxToMeters(stage.goal.radius))
          .setTranslation(w[0], w[1] + p.goalHeight / 2, w[2])
          .setSensor(true),
      );
      this.goalHandle = col.handle;
    }

    // Ball: dynamic sphere, CCD, never sleeps (E).
    const ball = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setLinearDamping(p.linearDamping)
        .setAngularDamping(p.angularDampingInactive)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    this.ballCol = world.createCollider(
      R.ColliderDesc.ball(p.ballRadius)
        .setMass(p.ballMass)
        .setFriction(p.ballFriction)
        .setRestitution(p.ballRestitution)
        .setFrictionCombineRule(R.CoefficientCombineRule.Multiply)
        .setRestitutionCombineRule(R.CoefficientCombineRule.Multiply),
      ball,
    );
    this.ball = ball;

    this.tick = 0;
    this.goalReached = false;
    this.reset();
    this.lastIslandId = -1; // first contact (the start island) emits an 'island' event
  }

  // ───────────────────────────────────────── reset ─────────────────────────────────────────

  /** Teleport the ball to `to` (stage px; default the start) on the island under it, zero velocity. */
  reset(to?: Vec2): void {
    const stage = this.need();
    const ball = this.ball as RigidBody;
    const target = to ?? stage.start.pos;
    const island = this.islandAt(target) ?? this.nearestIsland(target);
    const w = pageToWorld(target, island?.level ?? 0);
    if (this.riding) this.finishRide(this.riding, []);
    ball.setBodyType(this.R.RigidBodyType.Dynamic, true);
    ball.setTranslation({ x: w[0], y: w[1] + this.params.ballRadius + 0.01, z: w[2] }, true);
    ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.falling = false;
    this.lostEmitted = false;
    this.tiltX = 0;
    this.tiltZ = 0;
    this.lastContactTick = NEG_INF_TICK;
    this.lastTouchTick = this.tick;
    this.prevTouching.clear();
    if (island) {
      this.lastIslandId = island.id;
      this.lastIslandPos = [target[0], target[1]];
    }
    for (const e of this.elevators) {
      e.wasInLow = false;
      e.wasInHigh = false;
    }
  }

  // ───────────────────────────────────────── step ─────────────────────────────────────────

  step(input: InputSample): SimStepResult {
    const t0 = performance.now();
    this.need();
    const world = this.world as World;
    const ball = this.ball as RigidBody;
    const p = this.params;
    const events: SimEvent[] = [];
    this.tick++;
    const tick = this.tick;

    // 1. Input → smoothed tilt → gravity (E: rotation of gravity in the frameYaw heading frame).
    const control = !this.falling && !this.riding;
    const power = control && input.power;
    const tx = power ? clamp(input.tiltX, p.maxTiltRoll) : 0;
    const tz = power ? clamp(input.tiltZ, p.maxTiltPitch) : 0;
    this.tiltX += this.tiltAlpha * (tx - this.tiltX);
    this.tiltZ += this.tiltAlpha * (tz - this.tiltZ);
    const sx = dsin(this.tiltX);
    const cx = dcos(this.tiltX);
    const sz = dsin(this.tiltZ);
    const cz = dcos(this.tiltZ);
    const sy = dsin(input.frameYaw);
    const cy = dcos(input.frameYaw);
    // local gravity direction: right·(sx cz) + up·(−cx cz) + forward·(sz); |d| = 1
    const dr = sx * cz;
    const df = sz;
    let gScale = 1;
    if (this.falling) {
      const rampTicks = Math.max(1, Math.round(p.fallGravityRampSec * p.simHz));
      const u = Math.min(1, (tick - this.fellTick) / rampTicks);
      gScale = 1 + (p.fallGravityScale - 1) * u;
    }
    const g = p.gravity * gScale;
    // forward = (−sy, 0, −cy), right = (cy, 0, −sy)
    world.gravity = { x: g * (dr * cy - df * sy), y: -g * cx * cz, z: g * (-dr * sy - df * cy) };
    ball.setAngularDamping(power ? p.angularDampingActive : p.angularDampingInactive);
    if (p.torqueAssist !== 0) {
      ball.resetTorques(false);
      if (power) {
        // Roll towards h = forward·sin(tz) + right·sin(tx): ω ∝ up × h.
        const hx = -sz * sy + sx * cy;
        const hz = -sz * cy - sx * sy;
        ball.addTorque({ x: p.torqueAssist * hz, y: 0, z: -p.torqueAssist * hx }, true);
      }
    }

    // Jump (E): edge-triggered, any contact within the grace window, POWER not required.
    const jumpEdge = input.jump && !this.prevJump;
    this.prevJump = input.jump;
    if (jumpEdge && control && tick - this.lastContactTick <= this.graceTicks) {
      ball.applyImpulse({ x: 0, y: p.jumpDeltaV * ball.mass(), z: 0 }, true);
      if (p.jumpConsumesGrace) this.lastContactTick = NEG_INF_TICK;
    }

    // 2. Elevators (triggered by the ball state after the previous step).
    const finished: ElevatorRt[] = [];
    this.updateElevators(tick, events, finished);

    // 3. Physics.
    const lv = ball.linvel();
    this.v0.x = lv.x;
    this.v0.y = lv.y;
    this.v0.z = lv.z;
    world.step();
    for (const e of finished) this.finishRide(e, events);

    // 4. Contacts → grounded, jump grace, islands, landed / bump.
    const pos = ball.translation();
    this.processContacts(tick, pos, events);

    // 5. Sensors → items, goal.
    this.processSensors(events);

    // 6. Falls.
    if (!this.falling && pos.y < this.lowestTop - p.fallDepth) {
      this.falling = true;
      this.fellTick = tick;
      events.push({ type: 'fell', restartAt: this.restartPoint() });
    }
    if (
      this.falling &&
      !this.lostEmitted &&
      tick - this.fellTick >= Math.round(p.fallLostDelaySec * p.simHz)
    ) {
      this.lostEmitted = true;
      events.push({ type: 'lost' });
    }

    const rot = ball.rotation();
    const vel = ball.linvel();
    const result: SimStepResult = {
      ball: {
        pos: [pos.x, pos.y, pos.z],
        quat: [rot.x, rot.y, rot.z, rot.w],
        vel: [vel.x, vel.y, vel.z],
        grounded: this.riding !== null || this.groundedNow,
      },
      events,
      elevators: this.elevators.map((e) => ({ id: e.def.id, y: e.y[0] })),
    };
    this.lastStepMs = performance.now() - t0;
    return result;
  }

  private groundedNow = false;

  private processContacts(tick: number, pos: RapierNS.Vector, events: SimEvent[]): void {
    const world = this.world as World;
    const ballCol = this.ballCol as Collider;
    const p = this.params;
    const touching = new Set<number>();
    let grounded = false;
    let landImpact = 0;
    let bumpImpact = 0;
    const v0 = this.v0;
    world.contactPairsWith(ballCol, (other) => {
      const role = this.roles.get(other.handle);
      if (!role) return;
      world.contactPair(ballCol, other, (m, flipped) => {
        const nc = m.numContacts();
        if (nc === 0) return;
        let minDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < nc; i++) minDist = Math.min(minDist, m.contactDist(i));
        if (minDist > p.touchDistance) return;
        const n = m.normal();
        // manifold normal points from collider1 to collider2; we want the surface normal towards the ball.
        const s = flipped ? 1 : -1;
        const nx = n.x * s;
        const ny = n.y * s;
        const nz = n.z * s;
        const approach = -(v0.x * nx + v0.y * ny + v0.z * nz);
        touching.add(other.handle);
        if (ny > p.groundNormalY) {
          grounded = true;
          if (approach > landImpact) landImpact = approach;
        } else if (!this.prevTouching.has(other.handle) && approach > bumpImpact) {
          bumpImpact = approach;
        }
        if (role.type === 'island' && role.islandId !== this.lastIslandId) {
          this.lastIslandId = role.islandId;
          events.push({ type: 'island', islandId: role.islandId });
        }
        if (role.type === 'island') this.lastIslandPos = worldToPage([pos.x, pos.y, pos.z]);
      });
    });
    const any = touching.size > 0;
    if (grounded && tick - 1 - this.lastTouchTick >= this.landedAirTicks && landImpact >= p.impactMinSpeed) {
      events.push({ type: 'landed', impact: landImpact });
    }
    if (bumpImpact >= p.impactMinSpeed) events.push({ type: 'bump', impact: bumpImpact });
    if (any || this.riding) {
      this.lastContactTick = tick;
      this.lastTouchTick = tick;
    }
    this.groundedNow = grounded;
    this.prevTouching = touching;
  }

  private processSensors(events: SimEvent[]): void {
    const world = this.world as World;
    const ballCol = this.ballCol as Collider;
    const hits: { item: Item; col: Collider }[] = [];
    let goal = false;
    world.intersectionPairsWith(ballCol, (other) => {
      if (!world.intersectionPair(ballCol, other)) return;
      const it = this.itemsByHandle.get(other.handle);
      if (it) hits.push(it);
      else if (other.handle === this.goalHandle) goal = true;
    });
    hits.sort((a, b) => a.item.id - b.item.id);
    for (const h of hits) {
      if (!h.col.isEnabled()) continue;
      h.col.setEnabled(false); // each item fires at most once
      events.push({ type: 'item', itemId: h.item.id, kind: h.item.kind });
    }
    if (goal && !this.goalReached) {
      this.goalReached = true;
      events.push({ type: 'goal' });
    }
  }

  // ───────────────────────────────────────── elevators ─────────────────────────────────────────

  private updateElevators(tick: number, events: SimEvent[], finished: ElevatorRt[]): void {
    if (this.elevators.length === 0) return;
    const ball = this.ball as RigidBody;
    const p = this.params;
    const bp = ball.translation();
    for (const e of this.elevators) {
      const pend = e.pending;
      if (pend !== -1 && !this.ballInPlatform(e, pend, bp)) {
        for (const c of e.colliders[pend]) c.setEnabled(true);
        e.pending = -1;
      }
      if (e.ride) {
        const r = e.ride;
        const k = tick - r.start;
        const u = Math.min(1, k / r.ticks);
        const y = r.from + (r.to - r.from) * cubicInOut(u);
        const other = (1 - r.carrier) as 0 | 1;
        e.y[r.carrier] = y;
        e.y[other] = e.low + e.high - y;
        e.bodies[r.carrier].setNextKinematicTranslation({ x: e.fp.cx, y, z: e.fp.cz });
        e.bodies[other].setNextKinematicTranslation({ x: e.fp.cx, y: e.y[other], z: e.fp.cz });
        if (this.riding === e) {
          const k = r.shift * cubicInOut(u);
          ball.setNextKinematicTranslation({
            x: r.bx + e.fp.ux * k,
            y: y + p.ballRadius + 0.005,
            z: r.bz + e.fp.uz * k,
          });
        }
        if (u >= 1) finished.push(e);
        continue;
      }
      const over = !this.falling && inFootprint(e.fp, bp.x, bp.z);
      const inLow = over && bp.y - e.low >= -0.1 && bp.y - e.low <= p.elevatorSensorHeight;
      const inHigh = over && bp.y - e.high >= -0.1 && bp.y - e.high <= p.elevatorSensorHeight;
      const entered = (inLow && !e.wasInLow) || (inHigh && !e.wasInHigh);
      e.wasInLow = inLow;
      e.wasInHigh = inHigh;
      if (!entered || tick < e.cooldownUntil || this.riding) continue;
      const from = inLow ? e.low : e.high;
      const to = inLow ? e.high : e.low;
      const carrier: 0 | 1 = Math.abs(e.y[0] - from) <= Math.abs(e.y[1] - from) ? 0 : 1;
      const ticks = Math.max(1, Math.round(e.def.travelSec * p.simHz));
      // 05b (BI-3): on a ride down with a rise under ball diameter + slab, a ball that boarded at the upper
      // end would finish partly under the upper island's slab (b is inset into it) and be wedged there. Ease
      // it along the platform, just clear of that edge. (The builder no longer makes such lifts: E ≥ 3.7 D.)
      let shift = 0;
      if (to < from && from - to < 2 * p.ballRadius + p.slabThickness + 0.05) {
        const along = (bp.x - e.fp.cx) * e.fp.ux + (bp.z - e.fp.cz) * e.fp.uz;
        const maxAlong = e.fp.halfLen - e.edgeBack - p.ballRadius - 0.03;
        if (along > maxAlong) shift = maxAlong - along;
      }
      e.ride = { carrier, from, to, start: tick, ticks, bx: bp.x, bz: bp.z, shift };
      for (const c of e.colliders[(1 - carrier) as 0 | 1]) c.setEnabled(false);
      e.pending = -1;
      // E: the ball's velocity is zeroed and it is carried with the platform.
      ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      ball.setBodyType(this.R.RigidBodyType.KinematicPositionBased, true);
      ball.setNextKinematicTranslation({ x: bp.x, y: from + p.ballRadius + 0.005, z: bp.z });
      this.riding = e;
      events.push({ type: 'elevator', elevatorId: e.def.id, phase: 'start' });
    }
  }

  private finishRide(e: ElevatorRt, events: SimEvent[]): void {
    const r = e.ride;
    if (!r) return;
    const other = (1 - r.carrier) as 0 | 1;
    e.y[r.carrier] = r.to;
    e.y[other] = r.from;
    e.bodies[r.carrier].setTranslation({ x: e.fp.cx, y: r.to, z: e.fp.cz }, true);
    e.bodies[other].setTranslation({ x: e.fp.cx, y: r.from, z: e.fp.cz }, true);
    // 05b (BI-3): both platforms share one footprint, so after a ride down the partner comes back right above
    // the ball. With a rise < ball diameter + slab, re-enabling it there wedges the ball between the two slabs
    // (a softlock). Keep it disabled until the ball has left its volume.
    const ball = this.ball as RigidBody;
    if (this.ballInPlatform(e, other, ball.translation(), r.from)) e.pending = other;
    else for (const c of e.colliders[other]) c.setEnabled(true);
    e.ride = null;
    e.cooldownUntil =
      this.tick + Math.round((e.def.cooldownSec ?? this.params.elevatorCooldownSec) * this.params.simHz);
    if (this.riding === e) {
      ball.setBodyType(this.R.RigidBodyType.Dynamic, true);
      ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.riding = null;
      // Arriving inside the destination sensor must not re-trigger: mark it as already occupied.
      e.wasInLow = r.to === e.low;
      e.wasInHigh = r.to === e.high;
      events.push({ type: 'elevator', elevatorId: e.def.id, phase: 'end' });
    }
  }

  /**
   * Does the ball (centre `bp`) overlap platform `k`'s volume (slab + side rails), with the platform top at
   * `top` (default: its current height)? A small margin keeps the ball from touching it as it comes back.
   */
  /** Distance (m) from the elevator's `b` back along −(b−a) to the upper island's edge (0 if b is outside it). */
  private edgeBack(e: Elevator): number {
    const high = this.islandsById.get(e.islandTo);
    if (!high) return 0;
    const dx = e.b[0] - e.a[0];
    const dy = e.b[1] - e.a[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return 0;
    let d = 0;
    for (let t = 0; t <= 24; t += 0.5) {
      if (!pointInPolygon([e.b[0] - (dx / len) * t, e.b[1] - (dy / len) * t], high.contour, high.holes))
        break;
      d = t;
    }
    return pxToMeters(d);
  }

  private ballInPlatform(
    e: ElevatorRt,
    k: 0 | 1,
    bp: { x: number; y: number; z: number },
    top = e.y[k],
  ): boolean {
    const p = this.params;
    const m = 0.02;
    if (!inFootprint(e.fp, bp.x, bp.z, -(p.ballRadius + p.railThickness + m))) return false;
    return bp.y + p.ballRadius + m > top - p.slabThickness && bp.y - p.ballRadius - m < top + p.railHeight;
  }

  // ───────────────────────────────────────── helpers ─────────────────────────────────────────

  private restartPoint(): Vec2 {
    const stage = this.need();
    const island = this.islandsById.get(this.lastIslandId);
    if (!island || island.restartPoints.length === 0) return [stage.start.pos[0], stage.start.pos[1]];
    let best = island.restartPoints[0] as Vec2;
    let bestD = Number.POSITIVE_INFINITY;
    for (const rp of island.restartPoints) {
      const dx = rp[0] - this.lastIslandPos[0];
      const dy = rp[1] - this.lastIslandPos[1];
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = rp;
      }
    }
    return [best[0], best[1]];
  }

  private islandAt(p: Vec2): Island | undefined {
    let best: Island | undefined;
    for (const i of this.need().islands) {
      if (pointInPolygon(p, i.contour, i.holes) && (!best || i.level > best.level)) best = i;
    }
    return best;
  }

  private nearestIsland(p: Vec2): Island | undefined {
    let best: Island | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const i of this.need().islands) {
      const d = distanceToPolygonEdge(p, i.contour, i.holes);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private need(): StageData {
    if (!this.stage || !this.world) throw new Error('@wwm/physics: load(stage) first');
    return this.stage;
  }

  private freeWorld(): void {
    this.world?.free();
    this.world = null;
    this.ball = null;
    this.ballCol = null;
    this.roles.clear();
    this.itemsByHandle.clear();
    this.elevators = [];
    this.riding = null;
  }

  dispose(): void {
    this.freeWorld();
    this.stage = null;
  }

  // ───────────────────────────────── extras (not in the contract) ─────────────────────────────────

  /** Debug/test hook: place the ball anywhere with a given velocity (world m, m/s). */
  setBallState(
    pos: readonly [number, number, number],
    vel: readonly [number, number, number] = [0, 0, 0],
  ): void {
    const ball = this.ball as RigidBody;
    this.need();
    if (this.riding) this.finishRide(this.riding, []);
    ball.setBodyType(this.R.RigidBodyType.Dynamic, true);
    ball.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    ball.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
    ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.falling = false;
    this.lostEmitted = false;
    this.prevTouching.clear();
  }

  getBallState(): BallState {
    const ball = this.ball as RigidBody;
    this.need();
    const t = ball.translation();
    const q = ball.rotation();
    const v = ball.linvel();
    return {
      pos: [t.x, t.y, t.z],
      quat: [q.x, q.y, q.z, q.w],
      vel: [v.x, v.y, v.z],
      grounded: this.groundedNow,
    };
  }

  /** Collider wireframe for debug drawing: pairs of xyz endpoints (Float32Array) + RGBA per vertex. */
  debugLines(): { vertices: Float32Array; colors: Float32Array } {
    const w = this.world;
    if (!w) return { vertices: new Float32Array(), colors: new Float32Array() };
    const b = w.debugRender();
    return { vertices: b.vertices, colors: b.colors };
  }

  stats(): SimStats {
    let colliders = 0;
    this.world?.forEachCollider(() => {
      colliders++;
    });
    return { triangles: this.triangles, colliders, lastStepMs: this.lastStepMs, tick: this.tick };
  }
}

/** Headless simulation (Node, tests, solver, and the inside of the worker). */
export function createSimulation(opts?: SimulationOptions): Promise<RapierSimulation> {
  return RapierSimulation.create(opts);
}
