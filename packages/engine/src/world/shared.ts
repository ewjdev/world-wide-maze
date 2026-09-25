/**
 * Shared TSL building blocks: the 2013 "fragmented" facet colour, the shader ball shadow, and the intro
 * extrusion. Everything is unlit, like the 2013 materials (flat per-face colour + noise variation).
 */
import {
  abs,
  attribute,
  clamp,
  float,
  fract,
  mix,
  positionLocal,
  positionWorld,
  select,
  sin,
  smoothstep,
  uniform,
  vec3,
  vertexStage,
} from 'three/tsl';
import { Vector3 } from 'three/webgpu';
import { HSV_VARIATION, SHADOW_DARKNESS, SHADOW_FALLOFF_M, SHADOW_RADIUS_M } from '../palette.ts';

// biome-ignore lint/suspicious/noExplicitAny: TSL node graphs are dynamically typed; the typings fight composition.
export type N = any;

/**
 * Glow input. The scene pass writes each material's emissive colour to a second MRT target and only that
 * target is bloomed (selective glow). `emissiveNode` is read by every NodeMaterial's lighting setup, but the
 * typings only declare it on the standard material.
 */
export function setEmissive(m: object, node: N): void {
  (m as { emissiveNode: N }).emissiveNode = node;
}

/** Uniforms shared by every stage material. One instance per engine. */
export function createSharedUniforms() {
  return {
    /** engine clock (s); pauses with the engine */
    time: uniform(0),
    /** ball centre (world) for the shader shadow */
    ball: uniform(new Vector3(0, -1e4, 0)),
    shadowRadius: uniform(SHADOW_RADIUS_M),
    shadowDarkness: uniform(SHADOW_DARKNESS),
    /** intro: Y of the flat page, and 0..1 progress of each phase */
    pageY: uniform(0),
    extrude: uniform(1),
    bridges: uniform(1),
    appear: uniform(1),
    /** map view: items and markers scale up so they read from far away */
    mapScale: uniform(1),
    /** 0..1: how much of the "power" glow is on */
    power: uniform(0),
  };
}
export type SharedUniforms = ReturnType<typeof createSharedUniforms>;

/** Intro stagger spread: later islands start up to this fraction of the phase later. */
export const STAGGER = 0.6;
/** Bridges rise from this far below (E: from −50 WU). */
export const BRIDGE_DROP_M = 40;

export function hsv2rgb(h: N, s: N, v: N): N {
  // iq's smooth-free branchless HSV → RGB
  const k = vec3(0, 2 / 3, 1 / 3);
  const p = abs(
    fract(vec3(h, h, h).add(k))
      .mul(6)
      .sub(3),
  );
  return mix(vec3(1, 1, 1), clamp(p.sub(1), 0, 1), s).mul(v);
}

/** Slow per-face value noise in [-1, 1] from a face seed (stands in for the 2013 `snoise(color + t)`). */
function faceNoise(seed: N, t: N, k: number): N {
  const a = seed.mul(71.3 + k * 13.1);
  return sin(a.add(t.mul(0.55 + k * 0.17)))
    .mul(0.6)
    .add(sin(a.mul(2.3).add(t.mul(0.9 + k * 0.11))).mul(0.4));
}

/**
 * E: `fragmented` material colour. HSV base from the `hsv` attribute, + variation (0, .05, .08) × noise,
 * evaluated per vertex (faces share one seed, so each facet is flat).
 */
export function fragmentedColor(u: SharedUniforms): N {
  const hsv = attribute('hsv', 'vec3');
  const seed = attribute('seed', 'float');
  const n1 = faceNoise(seed, u.time, 0);
  const n2 = faceNoise(seed, u.time, 1);
  const s = hsv.y.add(n1.mul(HSV_VARIATION[1]));
  const v = hsv.z.add(n2.mul(HSV_VARIATION[2]));
  return vertexStage(hsv2rgb(hsv.x, s, v));
}

/**
 * Gentle fake light so slabs read as solid (N: 2013 was fully unlit). Static stage meshes have identity
 * transforms, so the geometry normal is the world normal; evaluated per vertex (faces are flat anyway).
 */
export function facetShade(): N {
  const n: N = attribute('normal', 'vec3');
  return vertexStage(
    n
      .dot(vec3(0.35, 0.85, 0.4).normalize())
      .mul(0.14)
      .add(0.88),
  );
}

/** E: `materiallib` ball shadow, verbatim maths (radius, darkness, falloff over 15 WU). */
export function ballShadow(u: SharedUniforms): N {
  const pos = positionWorld;
  const above = u.ball.y.greaterThan(pos.y);
  const falloff = select(
    above,
    float(1).sub(smoothstep(0, SHADOW_FALLOFF_M, u.ball.distance(pos))),
    float(0),
  );
  const bias = u.shadowRadius.mul(float(1).sub(falloff).mul(2).add(0.05));
  const dist = pos.xz.distance(u.ball.xz);
  const k = smoothstep(u.shadowRadius.add(bias), u.shadowRadius.sub(bias), dist).mul(falloff);
  return float(1).sub(u.shadowDarkness.mul(k));
}

const easeOut = (x: N): N => float(1).sub(float(1).sub(x).pow(3));

/** Per-vertex extrusion progress for the island group (0 = flat in the page, 1 = final). */
export function islandProgress(u: SharedUniforms): N {
  const delay = attribute('anim', 'vec2').x;
  return easeOut(clamp(u.extrude.mul(1 + STAGGER).sub(delay.mul(STAGGER)), 0, 1));
}

export function bridgeProgress(u: SharedUniforms): N {
  const delay = attribute('anim', 'vec2').x;
  return easeOut(clamp(u.bridges.mul(1 + STAGGER).sub(delay.mul(STAGGER)), 0, 1));
}

/** Island slabs: every vertex collapses onto the page plane and grows back. */
export function slabPosition(u: SharedUniforms): N {
  const e = islandProgress(u);
  return vec3(positionLocal.x, mix(u.pageY, positionLocal.y, e), positionLocal.z);
}

/** Bridge decks rise from below. */
export function deckPosition(u: SharedUniforms): N {
  const e = bridgeProgress(u);
  return positionLocal.sub(vec3(0, float(1).sub(e).mul(BRIDGE_DROP_M), 0));
}

/** Rails and posts: ride their island (group 0) or bridge (group 1), and grow up from their base. */
export function railPosition(u: SharedUniforms): N {
  const anim = attribute('anim', 'vec2');
  const base = attribute('base', 'float');
  const up = positionLocal.y.sub(base).mul(u.appear);
  const yIsland = mix(u.pageY, base, islandProgress(u)).add(up);
  const yBridge = base.add(up).sub(float(1).sub(bridgeProgress(u)).mul(BRIDGE_DROP_M));
  return vec3(positionLocal.x, select(anim.y.greaterThan(0.5), yBridge, yIsland), positionLocal.z);
}

/** Soft distance fade used by wire overlays (E: `whiteline` fades with gl_FragCoord.w). */
export function wireFade(dist: N): N {
  return float(1).sub(smoothstep(40, 160, dist));
}
