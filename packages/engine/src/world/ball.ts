/**
 * The ball. E (`game/object/ball`): a chrome shell (Phong, shininess 250, reflectivity .98, cube-camera env
 * map updated every 3rd frame) around a glowing core (#456e93) that brightens while POWER is held
 * (0.5 s up, 1 s down). Here the core shows through two glowing seams, so the roll reads at a glance (N).
 *
 * Also: the spawn cage and materialize dissolve, the map "YOU" marker and the POWER speed streaks.
 */
import { BALL_RADIUS_M, mulberry32 } from '@wwm/schema';
import {
  abs,
  cameraPosition,
  clamp,
  cos,
  cubeTexture,
  float,
  fract,
  instancedBufferAttribute,
  max,
  min,
  mix,
  mx_noise_float,
  normalView,
  positionGeometry,
  positionLocal,
  positionViewDirection,
  reflectVector,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import {
  CanvasTexture,
  CubeCamera,
  CubeRenderTarget,
  DoubleSide,
  HalfFloatType,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three/webgpu';
import { BALL_CORE, BALL_DARK, BALL_ONEUP, BALL_SHELL } from '../palette.ts';
import type { Bin } from './bin.ts';
import { type N, type SharedUniforms, setEmissive } from './shared.ts';
import { LAYER_ENV } from './stage-world.ts';

const col = (h: number) => vec3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255).pow(2.2);

export interface Ball {
  mesh: Mesh;
  cage: Mesh;
  you: Sprite;
  streaks: InstancedMesh;
  cubeCamera: CubeCamera;
  envTarget: CubeRenderTarget;
  materialize: N;
  cageOpen: N;
  cageOpacity: N;
  oneUp: N;
  streakAmount: N;
  velocity: N;
}

export function buildBall(u: SharedUniforms, bin: Bin, envSize: number): Ball {
  const envTarget = bin.add(new CubeRenderTarget(envSize, { type: HalfFloatType }));
  envTarget.texture.generateMipmaps = false;
  envTarget.texture.minFilter = LinearFilter;
  const cubeCamera = new CubeCamera(0.3, 1400, envTarget);
  for (const c of cubeCamera.children) c.layers.set(LAYER_ENV);

  const materialize = uniform(1);
  const oneUp = uniform(0);

  // ── shell ──
  const geo = bin.add(new SphereGeometry(BALL_RADIUS_M, 64, 40));
  const m = bin.add(new MeshBasicNodeMaterial());
  m.name = 'ball';
  const env = cubeTexture(envTarget.texture, reflectVector).rgb;
  const fres = float(1)
    .sub(clamp(normalView.dot(positionViewDirection), 0, 1))
    .pow(3);
  const shell = col(BALL_SHELL);
  // chrome: env × a slightly cool tint, + a fresnel lift, + a sharp highlight from "the sky"
  const spec = smoothstep(0.93, 0.99, reflectVector.normalize().dot(vec3(-0.3, 0.9, 0.3).normalize())).mul(
    0.6,
  );
  // E: the 2013 ball had a dark base colour (#20262d) under the reflective Phong shell: reflections of the
  // lower hemisphere read darker, giving the chrome its contrast against a near-white world.
  const ry = reflectVector.normalize().y;
  const horizon = mix(col(BALL_DARK).mul(2.2).add(0.3), vec3(1, 1, 1), smoothstep(-0.55, 0.25, ry));
  const chrome = env.mul(shell).mul(horizon).mul(1.05).add(fres.mul(0.18)).add(spec);
  // seams: two perpendicular great circles, in ball-local space so they roll with the ball
  const p = positionGeometry.div(BALL_RADIUS_M);
  const band = (x: N) => float(1).sub(smoothstep(0.045, 0.075, abs(x)));
  const seam = max(band(p.y), band(p.x));
  const core = mix(col(BALL_CORE), col(BALL_ONEUP), oneUp);
  const glow = u.power.mul(2.6).add(0.55);
  const seamCol = core.mul(glow).add(vec3(0.15, 0.2, 0.25).mul(u.power));
  // materialize: noise dissolve with a hot edge
  const nz = mx_noise_float(positionGeometry.mul(7)).mul(0.5).add(0.5);
  const edge = smoothstep(materialize.sub(0.12), materialize, nz).mul(materialize.lessThan(1).select(1, 0));
  m.colorNode = mix(chrome, seamCol, seam).add(vec3(0.7, 0.9, 1).mul(edge));
  setEmissive(
    m,
    seamCol
      .mul(seam)
      .mul(1.2)
      .add(vec3(0.6, 0.85, 1).mul(edge).mul(2)),
  );
  m.opacityNode = select(nz.lessThanEqual(materialize), float(1), float(0));
  m.alphaTest = 0.5;
  const mesh = new Mesh(geo, m);
  mesh.name = 'ball';
  mesh.frustumCulled = false;

  // ── spawn cage (E: `game/object/cage`, white; opens 2.5 s into the 3 s drop) ──
  const cageOpen = uniform(0);
  const cageOpacity = uniform(0);
  const cg = bin.add(new IcosahedronGeometry(BALL_RADIUS_M * 1.55, 1));
  const cm = bin.add(new MeshBasicNodeMaterial({ wireframe: true, transparent: true, depthWrite: false }));
  cm.name = 'cage';
  const openK = cageOpen;
  // bars fly outward and up as it opens
  cm.positionNode = positionLocal
    .mul(float(1).add(openK.mul(1.4)))
    .add(vec3(0, openK.mul(openK).mul(1.6), 0));
  const flicker = sin(u.time.mul(24).add(positionLocal.y.mul(9)))
    .mul(0.15)
    .add(0.85);
  cm.colorNode = vec3(1, 1, 1);
  const cageAlpha = cageOpacity.mul(float(1).sub(openK));
  setEmissive(cm, vec3(0.8, 0.95, 1).mul(flicker).mul(0.9).mul(cageAlpha));
  cm.opacityNode = cageAlpha;
  const cage = new Mesh(cg, cm);
  cage.name = 'cage';
  cage.visible = false;
  cage.frustumCulled = false;

  // ── "YOU" marker for the map view (E: `ball.showImHere`, a spinning billboard) ──
  const you = makeYou(bin, u);

  // ── POWER speed streaks (N) ──
  const velocity = uniform(new Vector3());
  const streakAmount = uniform(0);
  const streaks = makeStreaks(bin, u, velocity, streakAmount);

  return {
    mesh,
    cage,
    you,
    streaks,
    cubeCamera,
    envTarget,
    materialize,
    cageOpen,
    cageOpacity,
    oneUp,
    streakAmount,
    velocity,
  };
}

function makeYou(bin: Bin, u: SharedUniforms): Sprite {
  const w = 256;
  const h = 192;
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = 'bold 88px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText('YOU', w / 2, 92);
  ctx.fillStyle = '#df2d2d';
  ctx.fillText('YOU', w / 2, 92);
  ctx.beginPath();
  ctx.moveTo(w / 2 - 30, 118);
  ctx.lineTo(w / 2 + 30, 118);
  ctx.lineTo(w / 2, 176);
  ctx.closePath();
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.fill();
  const tex = bin.add(new CanvasTexture(canvas as never));
  tex.colorSpace = SRGBColorSpace;
  const m = bin.add(new SpriteNodeMaterial({ transparent: true, depthTest: false }));
  m.name = 'you';
  const t = texture(tex, uv());
  m.colorNode = t.rgb;
  m.opacityNode = t.a;
  // E: the marker spins; a sprite fakes it with a coin-flip width (N)
  m.scaleNode = vec2(
    abs(cos(u.time.mul(2.2)))
      .max(0.18)
      .mul(2.4),
    1.8,
  ).mul(u.mapScale.sub(1).mul(0.55).add(1));
  m.positionNode = vec3(0, sin(u.time.mul(3)).mul(0.15).add(1.05), 0).mul(u.mapScale.sub(1).mul(0.55).add(1));
  const mesh = new Sprite(m);
  mesh.name = 'you';
  mesh.renderOrder = 10;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

const STREAKS = 28;

function makeStreaks(bin: Bin, u: SharedUniforms, vel: N, amount: N): InstancedMesh {
  const rng = mulberry32(0x57e4);
  const data = new Float32Array(STREAKS * 4);
  for (let i = 0; i < STREAKS; i++) {
    data[i * 4] = rng() * Math.PI * 2; // angle around the travel axis
    data[i * 4 + 1] = 1.1 + rng() * 2.4; // radius
    data[i * 4 + 2] = rng(); // phase
    data[i * 4 + 3] = 0.6 + rng() * 0.8; // length scale
  }
  const a: N = instancedBufferAttribute(new InstancedBufferAttribute(data, 4));
  const g = bin.add(new PlaneGeometry(1, 1));
  const m = bin.add(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide }));
  m.name = 'streaks';
  const speed = vel.length();
  const dir = select(speed.greaterThan(0.01), vel.div(max(speed, 0.001)), vec3(0, 0, -1));
  // a basis perpendicular to the travel direction
  const helper = select(abs(dir.y).greaterThan(0.9), vec3(1, 0, 0), vec3(0, 1, 0));
  const s1 = dir.cross(helper).normalize();
  const s2 = dir.cross(s1).normalize();
  const cyc = fract(a.z.add(u.time.mul(speed.mul(0.09).add(0.6))));
  const along = cyc.sub(0.5).mul(-9);
  const center = u.ball
    .add(s1.mul(a.y.mul(a.x.cos())))
    .add(s2.mul(a.y.mul(a.x.sin())))
    .add(dir.mul(along));
  const len = min(speed.mul(0.1), float(1.6)).mul(a.w);
  // camera-facing ribbon along dir
  const view = cameraPosition.sub(center).normalize();
  const side = dir.cross(view).normalize();
  m.positionNode = center.add(dir.mul(positionLocal.y.mul(len))).add(side.mul(positionLocal.x.mul(0.03)));
  const fade = float(1)
    .sub(abs(cyc.sub(0.5)).mul(2))
    .mul(amount)
    .mul(smoothstep(3, 9, speed));
  m.colorNode = vec3(1, 1, 1);
  setEmissive(m, vec3(0.7, 0.85, 1).mul(0.5).mul(fade));
  m.opacityNode = fade.mul(0.75).mul(float(1).sub(abs(uv().y.sub(0.5)).mul(2)));
  const mesh = new InstancedMesh(g, m, STREAKS);
  mesh.frustumCulled = false;
  mesh.name = 'streaks';
  mesh.renderOrder = 5;
  return mesh;
}
