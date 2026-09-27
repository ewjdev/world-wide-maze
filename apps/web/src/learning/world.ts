import type { LessonV04, LessonWorldManifest } from '@wwm/learning';
import { distanceToPolygonEdge, pointInPolygon, type StageData, sha256Hex, validateStage } from '@wwm/schema';

export type BindingResult = { ok: true; manifest: LessonWorldManifest } | { ok: false; reasons: string[] };

/** Checks a chosen world in full before input or any lesson object is enabled. */
export async function bindLesson(
  doc: LessonV04,
  world: StageData,
  manifest: LessonWorldManifest,
): Promise<BindingResult> {
  const reasons: string[] = [];
  const stage = validateStage(world);
  if (!stage.ok) reasons.push(...stage.errors.map((error) => `Stage: ${error.code}`));
  if (manifest.stageHash !== (await sha256Hex(JSON.stringify(world)))) reasons.push('Stage hash mismatch.');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(manifest.revision)) reasons.push('Invalid binding revision.');
  const requiredTargets = new Set(doc.targets.map((target) => target.id));
  const requiredConnectors = new Set(doc.connectors);
  for (const key of Object.keys(manifest.targets))
    if (!requiredTargets.has(key)) reasons.push(`Unknown target ${key}.`);
  for (const key of Object.keys(manifest.connectors))
    if (!requiredConnectors.has(key)) reasons.push(`Unknown connector ${key}.`);
  for (const id of requiredTargets) {
    const binding = manifest.targets[id];
    if (!binding) {
      reasons.push(`Missing target ${id}.`);
      continue;
    }
    const island = world.islands.find((candidate) => candidate.id === binding.islandId);
    if (
      !island ||
      !Number.isFinite(binding.radius) ||
      binding.radius < 8 ||
      binding.radius > 30 ||
      !binding.pos.every(Number.isFinite) ||
      !pointInPolygon(binding.pos, island.contour, island.holes) ||
      distanceToPolygonEdge(binding.pos, island.contour, island.holes) < binding.radius + 7
    )
      reasons.push(`Target ${id} is not safely walkable.`);
  }
  for (const id of requiredConnectors) {
    const binding = manifest.connectors[id];
    if (!binding) {
      reasons.push(`Missing connector ${id}.`);
      continue;
    }
    const exists =
      binding.kind === 'bridge'
        ? world.bridges.some((bridge) => bridge.id === binding.id)
        : world.elevators.some((elevator) => elevator.id === binding.id);
    if (!exists) reasons.push(`Connector ${id} is absent from the stage.`);
  }
  for (const encounter of doc.activities[0]?.encounters ?? []) {
    const ids = [encounter.deposit.target, ...encounter.pickups.map((pickup) => pickup.target)];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = manifest.targets[ids[i] ?? ''];
        const b = manifest.targets[ids[j] ?? ''];
        if (
          a &&
          b &&
          a.islandId === b.islandId &&
          Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) < a.radius + b.radius + 7
        )
          reasons.push(`${encounter.id}: sensors ${ids[i]} and ${ids[j]} overlap.`);
      }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, manifest };
}
