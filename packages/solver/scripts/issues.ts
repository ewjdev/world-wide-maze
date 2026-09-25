/**
 * Dev: summarize builder issues from an eval report (repro list per class + geometry stats).
 *   node packages/solver/scripts/issues.ts [fixtures/eval/report.json]
 */
import { readFileSync } from 'node:fs';
import { ELEVATOR_MIN_RISE_M } from '../src/nav.ts';

interface Rec {
  slug: string;
  slice: number;
  difficulty: string;
  seed: number;
  playable: boolean;
  solved: boolean;
  jumps: number;
  elevators: number;
  audit: { split: number; noGround: number };
  failure?: {
    kind: string;
    islandId: number;
    bridgeId?: number;
    elevatorId?: number;
    at: [number, number];
    detail?: string;
  };
}
const rep = JSON.parse(
  readFileSync(process.argv[2] ?? new URL('../../../fixtures/eval/report.json', import.meta.url), 'utf8'),
) as { records: Rec[] };
const recs = rep.records.filter((r) => r.difficulty !== 'hard'); // hard == normal geometry
const byKind = new Map<string, Rec[]>();
for (const r of recs) if (r.failure) byKind.set(r.failure.kind, [...(byKind.get(r.failure.kind) ?? []), r]);
for (const [k, rs] of byKind) {
  console.log(`\n## ${k} (${rs.length} easy+normal stages)`);
  for (const r of rs)
    console.log(
      `- ${r.slug} slice ${r.slice} ${r.difficulty} seed ${r.seed}: island ${r.failure?.islandId}` +
        `${r.failure?.bridgeId !== undefined ? ` bridge ${r.failure.bridgeId}` : ''}${r.failure?.elevatorId !== undefined ? ` elevator ${r.failure.elevatorId}` : ''}` +
        ` @ (${r.failure?.at.map(Math.round).join(', ')}) — ${r.failure?.detail ?? ''}`,
    );
}
const all = rep.records;
console.log(
  `\nsolved with jumps: ${all.filter((r) => r.solved && r.jumps > 0).length} / ${all.filter((r) => r.solved).length}`,
);
console.log(
  `stages with audit issues: ${all.filter((r) => r.audit.split + r.audit.noGround > 0).length} / ${all.length}`,
);
console.log(`elevator min rise (m): ${ELEVATOR_MIN_RISE_M}`);
