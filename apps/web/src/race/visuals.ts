import type { Engine } from '@wwm/engine';
import type { RaceCourse, RaceGhostTrack } from '@wwm/race';
import { LEVEL_HEIGHT_M, PX_PER_METER } from '@wwm/schema';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry } from 'three/webgpu';

/** Race-only decoration. Never creates colliders or changes the simulated world. */
export function courseMarkers(engine: Engine, course: RaceCourse) {
  const root = new Group();
  const legacyGoal = engine.debug().scene.getObjectByName('goal');
  const legacyVisible = legacyGoal?.visible;
  if (legacyGoal) legacyGoal.visible = false;
  const finishDark = new MeshBasicMaterial({ color: 0x20272d });
  const finishLight = new MeshBasicMaterial({ color: 0xffffff });
  const geometry = new BoxGeometry(1, 1, 1);
  const jumpMaterial = new MeshBasicMaterial({ color: 0xb77c1e });
  const landingGeometry = new RingGeometry(1.85, 2, 40);
  const landingIds = new Set<number>();
  for (const pad of course.stunts?.launchPads ?? []) {
    const stripe = new Mesh(geometry, jumpMaterial);
    stripe.position.set(pad.gate.center[0], pad.gate.center[1] - 0.43, pad.gate.center[2]);
    stripe.rotation.y = Math.atan2(pad.gate.normal[0], pad.gate.normal[1]);
    stripe.scale.set(pad.gate.halfWidth * 2, 0.05, 0.4);
    root.add(stripe);
    for (const id of pad.landingIslandIds) landingIds.add(id);
  }
  for (const id of landingIds) {
    const island = course.stage.islands.find((item) => item.id === id);
    if (!island) continue;
    const x = island.contour.reduce((sum, point) => sum + point[0], 0) / island.contour.length / PX_PER_METER;
    const z = island.contour.reduce((sum, point) => sum + point[1], 0) / island.contour.length / PX_PER_METER;
    const ring = new Mesh(landingGeometry, jumpMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, island.level * LEVEL_HEIGHT_M + 0.025, z);
    root.add(ring);
  }
  const pending = new MeshBasicMaterial({ color: 0x2e7a3a });
  const done = new MeshBasicMaterial({ color: 0x96b6a0, transparent: true, opacity: 0.3 });
  const groups = course.gates.map((gate) => {
    const group = new Group();
    group.position.set(...gate.center);
    group.rotation.y = Math.atan2(gate.normal[0], gate.normal[1]);
    for (const side of [-1, 1]) {
      const post = new Mesh(geometry, pending);
      post.position.set(side * (gate.halfWidth + 0.13), 0.9, 0);
      post.scale.set(0.16, 2.8, 0.16);
      group.add(post);
    }
    const line = new Mesh(geometry, pending);
    line.position.y = -0.46;
    line.scale.set(gate.halfWidth * 2, 0.035, 0.22);
    group.add(line);
    if (gate.kind === 'finish') {
      // A checkered arch and stripe sit on the exact authoritative crossing plane.
      for (let x = 0; x < 16; x++) {
        for (let row = 0; row < 2; row++) {
          const square = new Mesh(geometry, (x + row) % 2 ? finishDark : finishLight);
          square.position.set(-gate.halfWidth + ((x + 0.5) * gate.halfWidth) / 8, 2.2 + row * 0.35, 0);
          square.scale.set(gate.halfWidth / 8, 0.35, 0.2);
          group.add(square);
        }
        const stripe = new Mesh(geometry, x % 2 ? finishDark : finishLight);
        stripe.position.set(-gate.halfWidth + ((x + 0.5) * gate.halfWidth) / 8, -0.43, 0);
        stripe.scale.set(gate.halfWidth / 8, 0.04, 0.7);
        group.add(stripe);
      }
    }
    root.add(group);
    return group;
  });
  engine.debug().scene.add(root);
  return {
    update(next: number) {
      groups.forEach((g, i) => {
        if (course.gates[i]?.kind === 'finish') return;
        for (const child of g.children) (child as Mesh).material = i < next ? done : pending;
      });
    },
    dispose() {
      root.removeFromParent();
      if (legacyGoal) legacyGoal.visible = legacyVisible ?? true;
      finishDark.dispose();
      finishLight.dispose();
      jumpMaterial.dispose();
      landingGeometry.dispose();
      geometry.dispose();
      pending.dispose();
      done.dispose();
    },
  };
}

export function raceGhost(engine: Engine, track: RaceGhostTrack, secondary: boolean) {
  const geo = new SphereGeometry(0.51, 20, 14);
  const mat = new MeshBasicMaterial({
    color: secondary ? 0xb97625 : 0x367fb1,
    transparent: true,
    opacity: secondary ? 0.25 : 0.4,
    wireframe: secondary,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = secondary ? 'race-last-ghost' : 'race-best-ghost';
  engine.debug().scene.add(mesh);
  return {
    update(tick: number, ball: readonly number[]) {
      mesh.visible = tick <= track.ticks;
      if (!mesh.visible) return;
      const i = Math.max(0, Math.min(track.ticks, Math.floor(tick)));
      const j = Math.min(track.ticks, i + 1);
      const t = track.discontinuities[j] ? 0 : tick - i;
      const point = (k: number) => (track.pos[i * 3 + k] ?? 0) * (1 - t) + (track.pos[j * 3 + k] ?? 0) * t;
      mesh.position.set(point(0), point(1), point(2));
      const distance = Math.hypot(
        mesh.position.x - (ball[0] ?? 0),
        mesh.position.y - (ball[1] ?? 0),
        mesh.position.z - (ball[2] ?? 0),
      );
      mat.opacity = distance < 1.2 ? 0.1 : secondary ? 0.25 : 0.4;
      mesh.quaternion.set(
        track.quat[i * 4] ?? 0,
        track.quat[i * 4 + 1] ?? 0,
        track.quat[i * 4 + 2] ?? 0,
        track.quat[i * 4 + 3] ?? 1,
      );
    },
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
    },
  };
}
