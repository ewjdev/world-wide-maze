/**
 * @wwm/engine: renders the state it is given. The game loop, physics and input live elsewhere
 * (Phase 05 / 06 / 08); this module turns StageData + its texture into the World Wide Maze world and draws
 * one frame per `frame(dt)` call.
 */
import {
  type BallState,
  GOAL_RADIUS_M,
  LEVEL_HEIGHT_M,
  mulberry32,
  PX_PER_METER,
  type SimEvent,
  type StageData,
  type Vec2,
} from '@wwm/schema';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { emissive, float, mrt, output, pass, renderOutput, vec4 } from 'three/tsl';
import {
  Box3,
  Color,
  Fog,
  Frustum,
  Group,
  Matrix4,
  NoToneMapping,
  PerspectiveCamera,
  Quaternion,
  RenderPipeline,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { markWarned, markWebGPUFailed, quietErrorScopes, replaceCanvas, wantWebGPU } from './backend.ts';
import { CHASE, ChaseCamera, tiltQuaternion } from './camera/chase.ts';
import {
  type CamKey,
  ease,
  type IntroMode,
  type IntroTimeline,
  introCameraKeys,
  introTimeline,
  pageFoldAngle,
  progress,
  sampleKeys,
} from './camera/intro.ts';
import { buildHeightfield, type Heightfield, lowestTop, sampleTop } from './geom/heightfield.ts';
import { planTiles, type TilePlan } from './geom/tiling.ts';
import {
  FOG_COLOR,
  FOG_FAR_M,
  FOG_NEAR_M,
  GROUND_BELOW_LOWEST_M,
  ITEM_LARGE,
  ITEM_SMALL,
  WU,
} from './palette.ts';
import { MAX_TIER, QualityLadder, type QualitySetting, TIERS } from './quality.ts';
import { NodeFrameClock } from './three-private.ts';
import { type Background, buildBackground } from './world/background.ts';
import { type Ball, buildBall } from './world/ball.ts';
import { Bin } from './world/bin.ts';
import { planFirework } from './world/fireworks.ts';
import { buildGoal, type Goal } from './world/goal.ts';
import { buildItems, type Items } from './world/items.ts';
import { Particles } from './world/particles.ts';
import { buildPortals, type PortalState, type Portals } from './world/portals.ts';
import { createSharedUniforms, type N } from './world/shared.ts';
import {
  buildStageObjects,
  makeStageTextures,
  type StageObjects,
  type StageTextures,
} from './world/stage-world.ts';

export type ViewMode = 'chase' | 'map' | 'intro';
export type StageImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  quality?: QualitySetting;
  reducedMotion?: boolean;
  /** E: the 2013 "pixel look" (nearest-neighbour page texture 10 s into the intro). Default off. */
  pixelLook?: boolean;
  /** Force the WebGL2 backend even where WebGPU is available. */
  forceWebGL?: boolean;
  /** Clamp devicePixelRatio (N). Default 2. */
  maxDpr?: number;
  /** Override the texture tile limit (tests / low-end emulation). Capped at 4096 anyway. */
  maxTextureSize?: number;
  /** Override the page-texture anisotropy (default: the device maximum). Evidence / debugging only. */
  anisotropy?: number;
}

export interface ControlState {
  /** rad, roll (+ right) */
  tiltX: number;
  /** rad, pitch (+ away from the camera) */
  tiltZ: number;
  power: boolean;
}

export interface EngineStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  tier: number;
  /** extra detail for the sandbox / evidence */
  sceneDrawCalls: number;
  envDrawCalls: number;
  postDrawCalls: number;
  backend: 'webgpu' | 'webgl2';
  memory: { geometries: number; textures: number; programs: number; renderTargets: number };
  tierLog: { atSec: number; from: number; to: number; fps: number }[];
}

export interface Engine {
  loadStage(stage: StageData, texture: StageImage): Promise<void>;
  /** Release every GPU resource the current stage created (the engine itself stays alive). */
  unloadStage(): void;
  /** Latest sim state; pass `alpha` (0..1) to interpolate from the previous distinct state. */
  setBall(state: BallState, alpha?: number): void;
  /** Tilt + POWER (camera/background lean, core glow, speed streaks). */
  setControl(c: ControlState): void;
  handleEvent(e: SimEvent): void;
  setItemCollected(itemId: number): void;
  /** Elevator platform height from the sim (`step().elevators`), world metres (platform top). */
  setElevators(list: readonly { id: number; y: number }[]): void;
  /** Convenience: 0 = low, 1 = high. */
  setElevatorPhase(id: number, t: number): void;
  setView(mode: ViewMode): void;
  /** The "website becomes maze" opening. `fast` is the ≤ 8 s repeat version. */
  playIntro(opts?: { mode?: IntroMode }): Promise<void>;
  skipIntro(): void;
  /**
   * Drop the ball in its cage at a stage point (default: the start). Resolves when control can begin. The camera
   * faces the goal, or `faceTo` (a stage point; Phase 13, additive).
   */
  spawnBall(pos?: Vec2, opts?: { durationSec?: number; faceTo?: Vec2 }): Promise<void>;
  /** Goal fly-away + fireworks (E: count = remaining whole seconds mod 10). */
  playGoal(fireworks: number): Promise<void>;
  /**
   * Phase 13 (N): portal look. `offline` greys a portal out (the capture service is unreachable); `used` and
   * `open` are the normal look.
   */
  setPortalState(portalId: number, state: PortalState): void;
  /**
   * Phase 13 (N): travel through a portal. The ball spirals into the gate and shrinks away while the gate surges
   * and the camera glides up to it. Resolves when the ball is gone (≈ 1.6 s); the next `loadStage` resets it.
   */
  playPortal(portalId: number): Promise<void>;
  /** Camera heading for `InputSample.frameYaw` (see README "Yaw convention"). */
  cameraYaw(): number;
  resize(w: number, h: number): void;
  frame(dtSec: number): void;
  stats(): EngineStats;
  setQuality(q: QualitySetting): void;
  setPixelLook(on: boolean): void;
  /** Escape hatch for dev tools (sandbox, Phase 10 "how it's made" view). Not a stable API. */
  debug(): { renderer: WebGPURenderer; scene: Scene; camera: PerspectiveCamera };
  dispose(): void;
}

interface Tween {
  update(t: number): boolean; // return true when done
  finish(): void;
}

const UP = new Vector3(0, 1, 0);

type DeviceLostInfo = { api: string; message: string; reason: string | null };

function isWebGPU(r: WebGPURenderer): boolean {
  return !!(r.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend;
}

export async function createEngine(opts: EngineOptions): Promise<Engine> {
  let disposed = false;
  /** set while the WebGPU device is gone and the WebGL2 renderer is not ready yet: frames skip rendering */
  let deviceLost = false;
  let canvas = opts.canvas;
  /** the canvas the engine put in place of `opts.canvas` after a device loss (removed on dispose) */
  let ownCanvas: HTMLCanvasElement | null = null;
  /** false until createEngine has built everything: a loss before that is recovered before it returns */
  let ready = false;
  let recovery: Promise<void> | null = null;
  let contextLostWarned = false;
  const onDeviceLost = (r: WebGPURenderer, info: DeviceLostInfo) => {
    if (disposed) return;
    if (!isWebGPU(r)) {
      // WebGL2 context loss: nothing further to fall back to. Log once, quietly (the page stays usable).
      if (!contextLostWarned) console.warn(`[@wwm/engine] WebGL2 context lost: ${info.message}`);
      contextLostWarned = true;
      return;
    }
    if (deviceLost) return;
    deviceLost = true;
    markWebGPUFailed(
      `WebGPU device lost (${info.reason ?? 'unknown'}: ${info.message}); continuing on WebGL2.`,
    );
    if (ready) void recoverOnWebGL2();
  };

  const makeRenderer = async (forceWebGL: boolean): Promise<WebGPURenderer> => {
    const r = new WebGPURenderer({
      canvas,
      antialias: false,
      forceWebGL,
      powerPreference: 'high-performance',
    });
    // Installed before init(): a device lost during startup takes the same path as one lost mid-session.
    r.onDeviceLost = (info: DeviceLostInfo) => onDeviceLost(r, info);
    await r.init();
    if (isWebGPU(r)) {
      const device = (r.backend as { device?: Parameters<typeof quietErrorScopes>[0] }).device;
      if (device) quietErrorScopes(device);
    } else if (!forceWebGL) {
      // No WebGPU adapter/device: three fell back to WebGL2 and warned once. Later engines start on WebGL2.
      markWebGPUFailed(null);
      markWarned();
    }
    return r;
  };

  const tryWebGPU = wantWebGPU(opts.forceWebGL);
  let renderer = await makeRenderer(!tryWebGPU);
  let backend: 'webgpu' | 'webgl2' = isWebGPU(renderer) ? 'webgpu' : 'webgl2';
  const maxDpr = opts.maxDpr ?? 2;
  const baseDpr = () => Math.min(globalThis.devicePixelRatio || 1, maxDpr);
  const w0 = opts.canvas.clientWidth || opts.canvas.width || 1280;
  const h0 = opts.canvas.clientHeight || opts.canvas.height || 720;
  const size = { w: w0, h: h0 };
  const setupRenderer = (r: WebGPURenderer) => {
    r.info.autoReset = false;
    r.toneMapping = NoToneMapping;
    r.outputColorSpace = SRGBColorSpace;
    r.setPixelRatio(baseDpr());
    r.setSize(size.w, size.h, false);
  };
  setupRenderer(renderer);
  let nodeClock = new NodeFrameClock(renderer);

  const scene = new Scene();
  scene.background = new Color(FOG_COLOR);
  scene.fog = new Fog(FOG_COLOR, FOG_NEAR_M, FOG_FAR_M);
  const camera = new PerspectiveCamera(CHASE.fov, w0 / h0, CHASE.near, CHASE.far);
  camera.position.set(0, 20, 40);

  const u = createSharedUniforms();
  const globalBin = new Bin();
  const rng = mulberry32(0x1d2e);
  const particles = new Particles(4096, u, globalBin, rng);
  scene.add(particles.object);

  // ── post: MRT (colour + emissive), selective bloom on emissive only, screen-blended, FXAA ──
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, emissive: vec4(emissive, float(1)) }));
  const colorTex: N = scenePass.getTextureNode('output');
  const emTex: N = scenePass.getTextureNode('emissive');
  const bloomNode: N = bloom(emTex, 1.15, 0.45, 0.0);
  const composite = colorTex.add(bloomNode.mul(float(1).sub(colorTex)));
  const outputs = {
    full: fxaa(renderOutput(composite)),
    noFxaa: renderOutput(composite),
    noGlow: renderOutput(colorTex),
  };
  let pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  let currentOutput: keyof typeof outputs | null = null;
  const setOutput = (k: keyof typeof outputs) => {
    if (k === currentOutput) return;
    pipeline.outputNode = outputs[k];
    pipeline.needsUpdate = true;
    currentOutput = k;
  };

  const ladder = { value: new QualityLadder(opts.quality ?? 'auto') };
  const reducedMotion = opts.reducedMotion ?? false;
  let pixelLook = opts.pixelLook ?? false;

  // ── per-stage state ──
  let stageBin = new Bin();
  let stage: StageData | null = null;
  let objs: StageObjects | null = null;
  let textures: StageTextures | null = null;
  let items: Items | null = null;
  let goal: Goal | null = null;
  let portals: Portals | null = null;
  let bg: Background | null = null;
  let ball: Ball | null = null;
  let hf: Heightfield | null = null;
  let plan: TilePlan | null = null;
  const stageRoot = new Group();
  stageRoot.name = 'stage';
  scene.add(stageRoot);
  const bgPivot = new Group();
  scene.add(bgPivot);

  const chase = new ChaseCamera();
  let view: ViewMode = 'chase';
  const startWorld = new Vector3();
  const goalWorld = new Vector3();
  const stageCenter = new Vector3();
  let stageSize = { w: 1, d: 1 };
  let meanY = 0;
  let pageY = 0;

  // ball render state
  const prev: BallState = { pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], grounded: true };
  const curr: BallState = { pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], grounded: true };
  let alpha = 1;
  const ballPos = new Vector3();
  const ballQuat = new Quaternion();
  const ballVel = new Vector3();
  /** when set, the engine animates the ball itself (spawn drop, goal fly-away) */
  let ballOverride: ((t: number, out: Vector3) => void) | null = null;
  let ballVisible = true;
  /** Phase 13: the ball shrinks into a portal on travel. */
  let ballScale = 1;
  /** Phase 13: the camera glide towards a portal on travel. */
  let portalWatch: {
    from: Vector3;
    to: Vector3;
    fromLook: Vector3;
    look: Vector3;
    t0: number;
    dur: number;
  } | null = null;

  const control: ControlState = { tiltX: 0, tiltZ: 0, power: false };
  let powerGlow = 0;
  const lean = new Quaternion();
  const leanTarget = new Quaternion();
  const bgLean = new Quaternion();

  // camera blending between modes
  const camPos = new Vector3();
  const camTarget = new Vector3();
  const camUp = new Vector3(0, 1, 0);
  let blendFrom: { pos: Vector3; target: Vector3; t0: number; dur: number } | null = null;
  let mapAngle = 0;
  let goalWatch = false;
  const goalCam = new Vector3();
  /** where the goal camera settles (fireworks are placed relative to it) */
  const goalVantage = new Vector3();

  // intro
  let intro: {
    tl: IntroTimeline;
    keys: CamKey[];
    t0: number;
    resolve: () => void;
    pixelDone: boolean;
  } | null = null;
  let spawn: { resolve: () => void } | null = null;
  let tweens: Tween[] = [];
  let time = 0;
  let envFace = 0;
  let envPrimed = false;
  const pendingFireworks = 5;
  const last = { scene: 0, env: 0, post: 0, total: 0, triangles: 0 };
  // measured around the scene pass via onBeforeRender/onAfterRender hooks on the scene
  let sceneDraws = 0;
  let sceneStart = 0;
  let sceneTriStart = 0;
  scene.onBeforeRender = () => {
    if (sceneDraws === -1 && renderer.getMRT() !== null) {
      sceneStart = renderer.info.render.drawCalls;
      sceneTriStart = renderer.info.render.triangles;
    }
  };
  scene.onAfterRender = () => {
    if (sceneDraws === -1 && renderer.getMRT() !== null) {
      sceneDraws = renderer.info.render.drawCalls - sceneStart;
      last.triangles = renderer.info.render.triangles - sceneTriStart;
    }
  };

  const addTween = (tw: Tween) => {
    tweens.push(tw);
    return tw;
  };
  const tween = (dur: number, fn: (k: number) => void, done?: () => void): Tween => {
    const t0 = time;
    return addTween({
      update(t) {
        const k = dur <= 0 ? 1 : Math.min(1, (t - t0) / dur);
        fn(k);
        if (k >= 1) {
          done?.();
          return true;
        }
        return false;
      },
      finish() {
        fn(1);
        done?.();
      },
    });
  };
  const wait = (sec: number) =>
    new Promise<void>((resolve) => {
      tween(sec, () => {}, resolve);
    });

  function toWorld(p: Vec2, level: number): Vector3 {
    return new Vector3(p[0] / PX_PER_METER, level * LEVEL_HEIGHT_M, p[1] / PX_PER_METER);
  }

  function levelOf(islandId: number): number {
    return stage?.islands.find((i) => i.id === islandId)?.level ?? 0;
  }

  function surfaceAt(x: number, z: number, fallback: number): number {
    if (!hf) return fallback;
    const y = sampleTop(hf, x, z);
    return Number.isNaN(y) ? fallback : y;
  }

  function maxTextureSize(): number {
    const b = renderer.backend as {
      device?: { limits?: { maxTextureDimension2D?: number } };
      gl?: WebGL2RenderingContext;
    };
    const lim = b.device?.limits?.maxTextureDimension2D ?? b.gl?.getParameter(b.gl.MAX_TEXTURE_SIZE) ?? 4096;
    return Math.min(4096, lim as number, opts.maxTextureSize ?? 4096);
  }

  async function makeTiles(img: StageImage, p: TilePlan): Promise<TexImageSource[]> {
    const iw = (img as { width: number }).width;
    if (p.tiles.length === 1 && p.downscale === 1) return [img as TexImageSource];
    const out: TexImageSource[] = [];
    for (const t of p.tiles) {
      const sy = t.row0 / p.downscale;
      const sh = (t.row1 - t.row0) / p.downscale;
      out.push(
        await createImageBitmap(img as ImageBitmapSource, 0, Math.round(sy), iw, Math.round(sh), {
          resizeWidth: p.width,
          resizeHeight: t.row1 - t.row0,
        }),
      );
    }
    return out;
  }

  function clearStage() {
    for (const tw of tweens) tw.finish();
    tweens = [];
    intro = null;
    spawn = null;
    stageRoot.clear();
    bgPivot.clear();
    stageBin.disposeAll();
    stageBin = new Bin();
    stage = objs = textures = items = goal = portals = bg = ball = hf = plan = null;
    ballScale = 1;
    portalWatch = null;
    particles.clear();
    ballOverride = null;
    goalWatch = false;
    envPrimed = false;
  }

  function applyTier() {
    const f = ladder.value.features;
    renderer.setPixelRatio(baseDpr() * f.renderScale);
    setOutput(!f.glow ? 'noGlow' : f.fxaa ? 'full' : 'noFxaa');
    if (bg) {
      bg.rich.value = f.richBackground ? 1 : 0;
      bg.motes.visible = f.richBackground;
    }
  }
  applyTier();

  function introGeometry() {
    const chasePos = new Vector3();
    const chaseTarget = new Vector3();
    const probe = new ChaseCamera(hf);
    const ballAt = startWorld.clone().add(new Vector3(0, 0.5, 0));
    probe.reset(ballAt, goalWorld);
    chasePos.copy(probe.position);
    chaseTarget.copy(ballAt);
    return {
      width: stageSize.w,
      depth: stageSize.d,
      pageY,
      meanY,
      start: startWorld.clone(),
      goal: goalWorld.clone(),
      chasePos,
      chaseTarget,
      fovDeg: camera.fov,
      aspect: camera.aspect,
    };
  }

  const engine: Engine = {
    async loadStage(s, image) {
      clearStage();
      stage = s;
      const iw = (image as { width: number }).width;
      const ih = (image as { height: number }).height;
      const scale = iw / s.size.width; // trust the actual image over the metadata
      plan = planTiles(iw, ih, scale, maxTextureSize());
      const tileImgs = await makeTiles(image, plan);
      textures = makeStageTextures(tileImgs, opts.anisotropy ?? renderer.getMaxAnisotropy(), stageBin);
      textures.setPixelLook(false);
      objs = buildStageObjects(s, plan, textures, u, stageBin);
      stageRoot.add(objs.tops, objs.sides, objs.bridges, objs.rails, objs.frame);
      if (objs.elevators) stageRoot.add(objs.elevators);
      hf = buildHeightfield(s);
      chase.setHeightfield(hf);

      stageSize = { w: s.size.width / PX_PER_METER, d: s.size.height / PX_PER_METER };
      const low = lowestTop(s);
      meanY = s.islands.reduce((a, i) => a + i.level * LEVEL_HEIGHT_M, 0) / Math.max(1, s.islands.length);
      pageY = low;
      u.pageY.value = pageY;
      stageCenter.set(stageSize.w / 2, meanY, stageSize.d / 2);
      startWorld.copy(toWorld(s.start.pos, levelOf(s.start.islandId)));
      goalWorld.copy(toWorld(s.goal.pos, levelOf(s.goal.islandId)));

      items = buildItems(s, u, stageBin);
      stageRoot.add(items.small, items.large, items.largeShell);
      goal = buildGoal(s.source.title, u, stageBin);
      goal.group.position.copy(goalWorld);
      stageRoot.add(goal.group);
      portals = buildPortals(s, u, stageBin);
      if (portals) stageRoot.add(portals.mesh);

      bg = buildBackground(stageCenter, low - GROUND_BELOW_LOWEST_M, low, u, stageBin);
      bgPivot.add(bg.group);

      ball = buildBall(u, stageBin, ladder.value.tier <= 1 ? 128 : 64);
      stageRoot.add(ball.mesh, ball.cage, ball.you, ball.streaks);
      scene.add(ball.cubeCamera);
      stageBin.add({ dispose: () => scene.remove(ball?.cubeCamera ?? scene) });

      applyTier();

      // default pose: ball resting on the start, chase camera behind it facing the goal
      const bp = startWorld.clone().add(new Vector3(0, 0.5, 0));
      for (const st of [prev, curr]) {
        st.pos = [bp.x, bp.y, bp.z];
        st.quat = [0, 0, 0, 1];
        st.vel = [0, 0, 0];
      }
      ballVisible = true;
      ball.materialize.value = 1;
      chase.holdPosition = false;
      chase.reset(bp, goalWorld);
      camPos.copy(chase.position);
      camTarget.copy(chase.target);
      u.extrude.value = u.bridges.value = u.appear.value = 1;
      if (goal) goal.visibility.value = 1;
      view = 'chase';
      // compile everything up front so the first frames don't hitch
      if (recovery) await recovery;
      if (!deviceLost) await renderer.compileAsync(scene, camera);
    },

    unloadStage() {
      clearStage();
    },

    setBall(state, a) {
      const moved =
        state.pos[0] !== curr.pos[0] ||
        state.pos[1] !== curr.pos[1] ||
        state.pos[2] !== curr.pos[2] ||
        state.quat[3] !== curr.quat[3];
      if (a === undefined) {
        copyState(state, prev);
        copyState(state, curr);
        alpha = 1;
      } else {
        if (moved) {
          copyState(curr, prev);
          copyState(state, curr);
        }
        alpha = Math.min(1, Math.max(0, a));
      }
    },

    setControl(c) {
      control.tiltX = c.tiltX;
      control.tiltZ = c.tiltZ;
      control.power = c.power;
    },

    handleEvent(e) {
      switch (e.type) {
        case 'item':
          engine.setItemCollected(e.itemId);
          break;
        case 'goal':
          void engine.playGoal(pendingFireworks);
          break;
        case 'fell':
          chase.holdPosition = true;
          break;
        case 'lost':
          bg?.ripple(ballPos.x, ballPos.z, time);
          break;
        case 'portal': {
          const c = portals?.centers.get(e.portalId);
          if (!portals || !c) break;
          portals.pulse(e.portalId, time);
          const col = portals.colors.get(e.portalId) ?? 0xffffff;
          particles.emit(
            {
              origin: c,
              count: 46,
              speed: [1.5, 4.5],
              life: [0.4, 0.9],
              size: [0.06, 0.16],
              colors: [col, 0xffffff],
              drag: 2.6,
              glow: 1.5,
              twinkle: 0.3,
            },
            time,
          );
          break;
        }
        case 'landed':
          if (e.impact > 6)
            particles.emit(
              {
                origin: ballPos.clone().add(new Vector3(0, -0.45, 0)),
                count: Math.min(24, Math.round(e.impact * 1.5)),
                speed: [1, 2.5],
                life: [0.3, 0.6],
                size: [0.06, 0.14],
                colors: [0xffffff, 0xe8eef2],
                up: true,
                drag: 4,
                glow: 0,
              },
              time,
            );
          break;
        default:
          break;
      }
    },

    setItemCollected(itemId) {
      if (!items) return;
      const pos = items.positions.get(itemId);
      const kind = items.kinds.get(itemId);
      if (!items.collect(itemId, time) || !pos) return;
      if (kind === 'large') {
        particles.emit(
          {
            origin: pos,
            count: 90,
            speed: [3, 9],
            life: [0.5, 1.1],
            size: [0.08, 0.22],
            colors: [ITEM_LARGE, 0xffffff, 0x9ff3fa],
            drag: 2.2,
            gravity: 4,
            glow: 1.6,
            twinkle: 0.4,
          },
          time,
        );
      } else {
        particles.emit(
          {
            origin: pos,
            count: 14,
            speed: [1.2, 3.2],
            life: [0.35, 0.6],
            size: [0.06, 0.12],
            colors: [ITEM_SMALL, 0xbff6f9],
            drag: 3,
            glow: 1.2,
          },
          time,
        );
      }
    },

    setElevators(list) {
      if (!objs) return;
      const arr = objs.elevatorY.array as number[];
      for (const e of list) {
        const i = objs.elevatorIds.get(e.id);
        if (i !== undefined) arr[i] = e.y;
      }
    },

    setElevatorPhase(id, t) {
      const el = stage?.elevators.find((e) => e.id === id);
      if (!el) return;
      const y = (el.levelLow + (el.levelHigh - el.levelLow) * Math.min(1, Math.max(0, t))) * LEVEL_HEIGHT_M;
      engine.setElevators([{ id, y }]);
    },

    setView(mode) {
      if (mode === 'intro') {
        void engine.playIntro();
        return;
      }
      if (mode === view) return;
      blendFrom = { pos: camPos.clone(), target: camTarget.clone(), t0: time, dur: 0.9 };
      if (mode === 'map') {
        mapAngle = Math.atan2(camPos.x - stageCenter.x, camPos.z - stageCenter.z);
      }
      view = mode;
    },

    playIntro(o) {
      if (!stage || !objs || !ball) return Promise.resolve();
      if (intro) engine.skipIntro();
      const mode: IntroMode = reducedMotion ? 'fast' : (o?.mode ?? 'full');
      const tl = introTimeline(mode);
      const keys = introCameraKeys(introGeometry(), tl);
      u.extrude.value = 0;
      u.bridges.value = 0;
      u.appear.value = 0;
      if (goal) goal.visibility.value = 0;
      objs.frame.visible = true;
      objs.frameOpacity.value = 1;
      ballVisible = false;
      items?.reset();
      textures?.setPixelLook(false);
      view = 'intro';
      blendFrom = null;
      return new Promise<void>((resolve) => {
        intro = { tl, keys, t0: time, resolve, pixelDone: false };
      });
    },

    skipIntro() {
      if (!intro) return;
      const done = intro;
      intro = null;
      u.extrude.value = u.bridges.value = u.appear.value = 1;
      if (goal) {
        goal.visibility.value = 1;
        goal.group.visible = true;
      }
      if (objs) showAllStage(objs);
      if (items) items.small.visible = items.large.visible = items.largeShell.visible = true;
      if (portals) portals.mesh.visible = true;
      if (pixelLook) textures?.setPixelLook(true);
      finishSpawnNow();
      view = 'chase';
      const bp = startWorld.clone().add(new Vector3(0, 0.5, 0));
      chase.holdPosition = false;
      chase.reset(bp, goalWorld);
      camPos.copy(chase.position);
      camTarget.copy(chase.target);
      done.resolve();
    },

    spawnBall(pos, o) {
      if (!stage || !ball) return Promise.resolve();
      const land = pos
        ? toWorld(pos, 0).setY(surfaceAt(pos[0] / PX_PER_METER, pos[1] / PX_PER_METER, startWorld.y) + 0.5)
        : startWorld.clone().add(new Vector3(0, 0.5, 0));
      const face = o?.faceTo ? toWorld(o.faceTo, 0).setY(land.y) : undefined;
      return startSpawn(land, o?.durationSec ?? 3, true, face);
    },

    async playGoal(fireworks) {
      if (!stage || !ball) return;
      const from = ballPos.clone();
      const center = goalWorld.clone().add(new Vector3(0, 0.5, 0));
      const top = center.clone().add(new Vector3(0, 1500 * WU, 0));
      goalWatch = true;
      chase.holdPosition = true;
      // pull back to a vantage point behind the goal (so the ribbon, the rising ball and the fireworks
      // all fit), keeping the current heading
      const back = camPos.clone().sub(goalWorld).setY(0);
      if (back.lengthSq() < 1e-4) back.set(0, 0, 1);
      back.setLength(15);
      const vantage = goalWorld
        .clone()
        .add(back)
        .add(new Vector3(0, 4.5, 0));
      const camFrom = camPos.clone();
      goalVantage.copy(vantage);
      tween(1.4, (k) => {
        goalCam.lerpVectors(camFrom, vantage, ease.cubicInOut(k));
      });
      goalCam.copy(camFrom);
      const pull = 0.8;
      const rise = 2;
      const t0 = time;
      ballOverride = (t, out) => {
        const k = t - t0;
        if (k < pull) out.lerpVectors(from, center, ease.cubicInOut(k / pull));
        else out.lerpVectors(center, top, ease.quintIn(Math.min(1, (k - pull) / rise)));
      };
      // E: fireworks at random screen positions 300–800 ms apart
      const n = Math.max(0, Math.floor(fireworks));
      let at = pull + 0.2;
      for (let i = 0; i < n; i++) {
        const delay = at;
        tween(
          delay,
          () => {},
          () => launchFirework(i),
        );
        at += 0.3 + rng() * 0.5;
      }
      // last launch + rocket flight (≤ 1.2 s) + the longest burst (willow ≈ 3 s) mostly faded
      await wait(Math.max(pull + rise, n > 0 ? at + 3.4 : 0));
    },

    setPortalState(id, st) {
      portals?.setState(id, st);
    },

    async playPortal(id) {
      const center = portals?.centers.get(id);
      if (!stage || !ball || !portals || !center) return;
      const P = portals;
      P.surge(id, time);
      P.pulse(id, time);
      const from = ballPos.clone();
      // camera: glide to a spot in front of the gate on the ball's side, looking into it
      const side = camPos.clone().sub(center).setY(0);
      if (side.lengthSq() < 1e-4) side.set(0, 0, 1);
      side.setLength(3.6);
      portalWatch = {
        from: camPos.clone(),
        to: center
          .clone()
          .add(side)
          .add(new Vector3(0, 0.7, 0)),
        fromLook: camTarget.clone(),
        look: center.clone(),
        t0: time,
        dur: 1.35,
      };
      chase.holdPosition = true;
      const t0 = time;
      const dur = 1.25;
      ballOverride = (t, out) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = ease.cubicInOut(k);
        out.lerpVectors(from, center, e);
        // spiral in around the gate's axis
        const a = k * Math.PI * 3.5;
        const r = (1 - e) * 0.45;
        out.x += Math.cos(a) * r;
        out.y += Math.sin(a) * r * 0.5;
        ballScale = 1 - 0.92 * ease.quintIn(k);
      };
      const col = P.colors.get(id) ?? 0xffffff;
      tween(
        dur - 0.1,
        () => {},
        () =>
          particles.emit(
            {
              origin: center.clone(),
              count: 120,
              speed: [2, 7],
              life: [0.5, 1.2],
              size: [0.07, 0.2],
              colors: [col, 0xffffff, col],
              drag: 2.2,
              glow: 1.8,
              twinkle: 0.4,
            },
            time,
          ),
      );
      await wait(dur + 0.35);
      ballVisible = false;
    },

    cameraYaw() {
      if (view === 'chase' && !intro) return chase.yaw();
      const dx = camTarget.x - camPos.x;
      const dz = camTarget.z - camPos.z;
      return dx === 0 && dz === 0 ? 0 : Math.atan2(-dx, -dz);
    },

    resize(w, h) {
      size.w = w;
      size.h = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },

    frame(dt) {
      const d = Math.min(Math.max(dt, 0), 0.1);
      time += d;
      u.time.value = time;
      if (ladder.value.sample(dt)) applyTier();

      // tweens
      tweens = tweens.filter((tw) => !tw.update(time));

      // POWER glow: 0.5 s up, 1 s down (E: ball.activate/deactivate)
      powerGlow = control.power ? Math.min(1, powerGlow + d / 0.5) : Math.max(0, powerGlow - d / 1);
      u.power.value = powerGlow;

      // ball
      if (ball) {
        if (ballOverride) ballOverride(time, ballPos);
        else {
          ballPos.set(
            lerp(prev.pos[0], curr.pos[0], alpha),
            lerp(prev.pos[1], curr.pos[1], alpha),
            lerp(prev.pos[2], curr.pos[2], alpha),
          );
          ballQuat
            .set(prev.quat[0], prev.quat[1], prev.quat[2], prev.quat[3])
            .slerp(new Quaternion(curr.quat[0], curr.quat[1], curr.quat[2], curr.quat[3]), alpha);
          ballVel.set(curr.vel[0], curr.vel[1], curr.vel[2]);
        }
        ball.mesh.position.copy(ballPos);
        ball.mesh.quaternion.copy(ballQuat);
        ball.mesh.scale.setScalar(ballScale);
        ball.mesh.visible = ballVisible;
        ball.cage.position.copy(ballPos);
        u.ball.value.copy(ballVisible ? ballPos : new Vector3(0, -1e4, 0));
        ball.velocity.value.copy(ballVel);
        const speed = ballVel.length();
        ball.streakAmount.value = reducedMotion ? 0 : powerGlow * Math.min(1, speed / 8);
        ball.you.position.copy(ballPos);
      }

      // tilt lean: camera.up and background, 20–50 % of the tilt (E), off under reduced motion
      const yaw = chase.yaw();
      if (!reducedMotion && (view === 'chase' || view === 'map')) {
        tiltQuaternion(
          control.power ? control.tiltX : 0,
          control.power ? control.tiltZ : 0,
          yaw,
          0.2,
          0.5,
          leanTarget,
        );
      } else leanTarget.identity();
      lean.slerp(leanTarget, 1 - Math.exp(-d / 0.18));
      if (bg) {
        // rotate the background about the ball (strong lean: 0.5 pitch, 0.5 roll)
        tiltQuaternion(
          reducedMotion ? 0 : control.power ? control.tiltX : 0,
          reducedMotion ? 0 : control.power ? control.tiltZ : 0,
          yaw,
          0.5,
          0.5,
          leanTarget,
        );
        bgLean.slerp(leanTarget, 1 - Math.exp(-d / 0.3));
        const pivot = ballPos;
        bgPivot.quaternion.copy(bgLean);
        bgPivot.position.copy(pivot).sub(pivot.clone().applyQuaternion(bgLean));
      }

      updateCamera(d);
      particles.update(time);
      if (bg) bg.motes.visible = ladder.value.features.richBackground && motesInView();
      if (deviceLost) return; // switching to WebGL2 (recoverOnWebGL2); the state above keeps advancing

      // The renderer only re-runs pass nodes once per *its own* rAF frame id. We are driven externally
      // (possibly several frames per rAF, e.g. a manual clock); see three-private.ts.
      nodeClock.tick();
      // env map: 2 cube faces per frame = full refresh every 3rd frame (E: `D%3===0`)
      renderer.info.reset();
      if (ball && ladder.value.features.envMapUpdates && ballVisible) {
        ball.cubeCamera.position.copy(ballPos);
        ball.cubeCamera.updateMatrixWorld(true);
        if (!envPrimed) {
          ball.mesh.visible = false;
          ball.cubeCamera.update(renderer, scene);
          ball.mesh.visible = ballVisible;
          envPrimed = true;
        } else {
          renderEnvFaces(2);
        }
      } else if (ball && !envPrimed && stage) {
        ball.cubeCamera.position.copy(ballPos);
        ball.cubeCamera.update(renderer, scene);
        envPrimed = true;
      }
      const afterEnv = renderer.info.render.drawCalls;
      sceneDraws = -1;
      pipeline.render();
      if (sceneDraws < 0) sceneDraws = 0;
      last.env = afterEnv;
      last.total = renderer.info.render.drawCalls;
      last.scene = sceneDraws;
      last.post = last.total - last.env - last.scene;
    },

    stats() {
      const mem = renderer.info.memory as unknown as Record<string, number>;
      return {
        fps: ladder.value.fps,
        drawCalls: last.total,
        triangles: last.triangles,
        tier: ladder.value.tier,
        sceneDrawCalls: last.scene,
        envDrawCalls: last.env,
        postDrawCalls: last.post,
        backend,
        memory: {
          geometries: mem.geometries ?? 0,
          textures: mem.textures ?? 0,
          programs: mem.programs ?? 0,
          renderTargets: mem.renderTargets ?? 0,
        },
        tierLog: [...ladder.value.log],
      };
    },

    setQuality(q) {
      ladder.value = new QualityLadder(q);
      applyTier();
    },

    setPixelLook(on) {
      pixelLook = on;
      textures?.setPixelLook(on);
    },

    debug() {
      return { renderer, scene, camera };
    },

    dispose() {
      disposed = true;
      clearStage();
      scene.clear();
      globalBin.disposeAll();
      pipeline.dispose();
      scenePass.dispose();
      renderer.dispose();
      ownCanvas?.remove();
    },
  };

  const faceTargets = [0, 1, 2, 3, 4, 5];
  function renderEnvFaces(count: number) {
    if (!ball) return;
    const cc = ball.cubeCamera;
    const rt = ball.envTarget;
    const cams = cc.children as PerspectiveCamera[];
    const prevRT = renderer.getRenderTarget();
    const wasVisible = ball.mesh.visible;
    ball.mesh.visible = false;
    for (let i = 0; i < count; i++) {
      const f = faceTargets[envFace % 6] as number;
      envFace++;
      renderer.setRenderTarget(rt, f);
      renderer.render(scene, cams[f] as PerspectiveCamera);
    }
    renderer.setRenderTarget(prevRT);
    ball.mesh.visible = wasVisible;
  }

  function finishSpawnNow() {
    if (!ball) return;
    ballOverride = null;
    ballVisible = true;
    ball.materialize.value = 1;
    ball.cage.visible = false;
    const bp = startWorld.clone().add(new Vector3(0, 0.5, 0));
    for (const st of [prev, curr]) {
      st.pos = [bp.x, bp.y, bp.z];
      st.vel = [0, 0, 0];
    }
    if (spawn) {
      const s = spawn;
      spawn = null;
      s.resolve();
    }
  }

  /** The cage drop (E: 10 WU above the spawn, 3 s cubicOut, cage opens at 2.5 s). */
  function startSpawn(land: Vector3, dur: number, resetCamera: boolean, faceTo?: Vector3): Promise<void> {
    if (!ball) return Promise.resolve();
    const b = ball;
    const from = land.clone().add(new Vector3(0, 10 * WU, 0));
    const t0 = time;
    ballVisible = true;
    goalWatch = false;
    portalWatch = null;
    ballScale = 1;
    chase.holdPosition = false;
    if (resetCamera) {
      chase.reset(land, faceTo ?? goalWorld);
      if (view !== 'intro') {
        camPos.copy(chase.position);
        camTarget.copy(land);
      }
    }
    b.cage.visible = true;
    b.cageOpacity.value = 1;
    b.cageOpen.value = 0;
    b.materialize.value = 0;
    ballOverride = (t, out) => out.lerpVectors(from, land, ease.cubicOut(Math.min(1, (t - t0) / dur)));
    ballQuat.identity();
    ballVel.set(0, 0, 0);
    tween(Math.min(1.2, dur * 0.45), (k) => {
      b.materialize.value = k;
    });
    const openAt = dur * (2.5 / 3);
    tween(
      openAt,
      () => {},
      () =>
        tween(dur - openAt + 0.25, (k) => {
          b.cageOpen.value = ease.cubicOut(k);
        }),
    );
    return new Promise<void>((resolve) => {
      spawn = { resolve };
      tween(
        dur,
        () => {},
        () => {
          ballOverride = null;
          b.cage.visible = false;
          for (const st of [prev, curr]) {
            st.pos = [land.x, land.y, land.z];
            st.quat = [0, 0, 0, 1];
            st.vel = [0, 0, 0];
          }
          alpha = 1;
          if (spawn) {
            spawn = null;
            resolve();
          }
        },
      );
    });
  }

  /** One rocket + burst. Returns the rocket's flight time (s). */
  function launchFirework(index: number): number {
    // burst somewhere in the sky beyond the goal, as seen from the goal vantage camera: 20–30 m out
    // horizontally, 14–44° up, spread across the view width (E: "random screen positions")
    const fwd = goalWorld.clone().sub(goalVantage).setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new Vector3().crossVectors(fwd, UP).normalize();
    const dist = 20 + rng() * 10;
    const halfW = Math.tan(((camera.fov * Math.PI) / 360) * Math.min(1.6, camera.aspect)) * dist;
    const el = ((14 + rng() * 30) * Math.PI) / 180;
    const burst = goalVantage
      .clone()
      .addScaledVector(fwd, dist)
      .addScaledVector(right, (rng() * 2 - 1) * 0.72 * halfW)
      .add(new Vector3(0, Math.tan(el) * dist, 0));
    const viewDir = burst.clone().sub(goalVantage).normalize();
    // the rocket climbs 11–15 m from below the burst, leaning slightly
    const launch = burst.clone().add(new Vector3((rng() - 0.5) * 4, -(11 + rng() * 4), (rng() - 0.5) * 4));
    const plan = planFirework({
      burst,
      launch,
      now: time,
      viewDir,
      rng,
      // the first one is always a big round peony; then vary
      kind: index === 0 ? 'peony' : undefined,
    });
    for (const p of plan.particles) particles.spawn(p);
    return plan.flight;
  }

  const frustum = new Frustum();
  const projView = new Matrix4();
  const motesBox = new Box3();
  /** The floating dots fill a thin slab under the islands; skip them when the camera can't see it. */
  function motesInView(): boolean {
    if (!bg) return false;
    bgPivot.updateMatrixWorld();
    motesBox.copy(bg.motesBounds).applyMatrix4(bgPivot.matrixWorld);
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView, camera.coordinateSystem);
    return frustum.intersectsBox(motesBox);
  }

  function updateCamera(d: number) {
    if (!stage) {
      camera.position.set(0, 10, 20);
      camera.lookAt(0, 0, 0);
      return;
    }
    if (intro) {
      const t = time - intro.t0;
      const tl = intro.tl;
      sampleKeys(intro.keys, t, camPos, camTarget);
      camUp.copy(UP);
      // world animation
      if (objs) {
        objs.frame.rotation.x = pageFoldAngle(t, tl);
        const fade = ease.cubicInOut(progress(t, tl.pageFade));
        objs.frame.position.y = pageY - 0.05 - fade * 6;
        objs.frameOpacity.value = 1 - fade;
        objs.frame.visible = fade < 1;
        // islands only exist once the page lies flat
        const ext = progress(t, tl.extrude);
        objs.tops.visible = objs.sides.visible = objs.rails.visible = t >= tl.extrude.start - 0.01;
        objs.bridges.visible = t >= tl.bridges.start - 0.01;
        if (objs.elevators) objs.elevators.visible = objs.bridges.visible;
        u.extrude.value = ext;
      }
      u.bridges.value = progress(t, tl.bridges);
      u.appear.value = ease.backOut(progress(t, tl.appear));
      if (items) items.small.visible = items.large.visible = items.largeShell.visible = t >= tl.appear.start;
      if (portals) portals.mesh.visible = t >= tl.appear.start;
      if (goal) {
        goal.visibility.value = progress(t, tl.appear);
        goal.group.visible = t >= tl.appear.start;
      }
      if (pixelLook && !intro.pixelDone && t >= tl.pixelAt) {
        textures?.setPixelLook(true);
        intro.pixelDone = true;
      }
      if (!spawn && !ballOverride && t >= tl.ballDrop.start && ball) {
        void startSpawn(
          startWorld.clone().add(new Vector3(0, 0.5, 0)),
          tl.ballDrop.end - tl.ballDrop.start,
          false,
        );
      }
      if (t >= tl.total) {
        const done = intro;
        intro = null;
        if (objs) showAllStage(objs);
        if (items) items.small.visible = items.large.visible = items.largeShell.visible = true;
        if (portals) portals.mesh.visible = true;
        view = 'chase';
        chase.holdPosition = false;
        chase.reset(startWorld.clone().add(new Vector3(0, 0.5, 0)), goalWorld);
        done.resolve();
      }
    } else if (portalWatch) {
      const k = ease.cubicInOut(Math.min(1, (time - portalWatch.t0) / portalWatch.dur));
      camPos.lerpVectors(portalWatch.from, portalWatch.to, k);
      camTarget.lerpVectors(portalWatch.fromLook, portalWatch.look, k);
      camUp.copy(UP);
    } else if (goalWatch) {
      // hold position, look at the ball as it flies away, but never tilt more than ~26° up so the goal
      // ribbon stays in frame under the fireworks (the ball leaves the top of the frame)
      camPos.copy(goalCam);
      const want = ballPos.clone();
      const off = want.clone().sub(camPos);
      const horiz = Math.hypot(off.x, off.z) || 1e-3;
      const maxUp = Math.tan((26 * Math.PI) / 180) * horiz;
      if (off.y > maxUp) want.y = camPos.y + maxUp;
      camTarget.lerp(want, 1 - Math.exp(-d / 0.25));
      camUp.copy(UP);
    } else if (view === 'map') {
      mapAngle += 0.2 * d; // E: 0.2 rad/s
      // R: 2013 orbited at 50 WU height, radius 1.7 × fit-width. We fit the stage's bounding sphere at a
      // 52° elevation instead, so the whole page stays in frame at every orbit angle and aspect.
      const radius = 0.5 * Math.hypot(stageSize.w, stageSize.d);
      const vf = (camera.fov * Math.PI) / 360;
      const hf = Math.atan(Math.tan(vf) * camera.aspect);
      const dist = (radius / Math.sin(Math.min(vf, hf))) * 0.8;
      const el = (52 * Math.PI) / 180;
      const R = dist * Math.cos(el);
      const H = meanY + dist * Math.sin(el);
      camPos.set(stageCenter.x + Math.sin(mapAngle) * R, H, stageCenter.z + Math.cos(mapAngle) * R);
      camTarget.copy(stageCenter);
      camUp.copy(UP);
    } else {
      chase.update(ballPos, d, reducedMotion ? null : lean);
      camPos.copy(chase.position);
      camTarget.copy(chase.target);
      camUp.copy(chase.up);
    }
    // blend in/out of the map
    const mapK = view === 'map' ? 1 : 0;
    u.mapScale.value += (1 + mapK * 2.2 - u.mapScale.value) * (1 - Math.exp(-d / 0.25));
    if (ball) ball.you.visible = view === 'map' && ballVisible;
    if (blendFrom) {
      const k = ease.cubicInOut(Math.min(1, (time - blendFrom.t0) / blendFrom.dur));
      camera.position.lerpVectors(blendFrom.pos, camPos, k);
      const tgt = new Vector3().lerpVectors(blendFrom.target, camTarget, k);
      camera.up.copy(camUp);
      camera.lookAt(tgt);
      if (k >= 1) blendFrom = null;
    } else {
      camera.position.copy(camPos);
      camera.up.copy(camUp);
      camera.lookAt(camTarget);
    }
    camera.updateMatrixWorld();
  }

  // unused-but-exported tier info keeps tree-shaking honest in the sandbox
  void TIERS;
  void MAX_TIER;
  void GOAL_RADIUS_M;
  /**
   * The WebGPU device is gone: recreate the renderer on the WebGL2 backend (fresh canvas in the old one's place)
   * and keep going with the same scene, stage and state. Frames skip rendering until it is ready. See backend.ts.
   */
  function recoverOnWebGL2(): Promise<void> {
    recovery ??= (async () => {
      const old = renderer;
      const oldPipeline = pipeline;
      canvas = replaceCanvas(canvas);
      ownCanvas?.remove();
      ownCanvas = canvas;
      let r: WebGPURenderer;
      try {
        r = await makeRenderer(true);
      } catch (e) {
        console.warn('[@wwm/engine] the WebGL2 fallback failed to start; rendering stops', e);
        return;
      }
      if (disposed) {
        void r.dispose();
        return;
      }
      setupRenderer(r);
      renderer = r;
      backend = 'webgl2';
      nodeClock = new NodeFrameClock(r);
      pipeline = new RenderPipeline(r);
      pipeline.outputColorTransform = false;
      currentOutput = null;
      applyTier();
      envPrimed = false;
      // The old renderer's GPU objects died with the device; drop its caches and listeners.
      try {
        oldPipeline.dispose();
        void old.dispose().catch(() => {});
      } catch {
        // a lost device can throw anywhere in teardown; nothing left to free
      }
      await r.compileAsync(scene, camera).catch(() => {});
      deviceLost = false;
    })();
    return recovery;
  }

  ready = true;
  if (deviceLost) await recoverOnWebGL2();
  return engine;
}

function showAllStage(o: StageObjects): void {
  o.frame.visible = false;
  o.tops.visible = o.sides.visible = o.rails.visible = o.bridges.visible = true;
  if (o.elevators) o.elevators.visible = true;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function copyState(from: BallState, to: BallState): void {
  to.pos = [from.pos[0], from.pos[1], from.pos[2]];
  to.quat = [from.quat[0], from.quat[1], from.quat[2], from.quat[3]];
  to.vel = [from.vel[0], from.vel[1], from.vel[2]];
  to.grounded = from.grounded;
}
