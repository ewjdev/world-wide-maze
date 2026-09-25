/** Aggregation of eval records into the report (fixtures/eval/report.json). */
import type { Difficulty } from '@wwm/schema';
import { FAILURE_KINDS, PAR_REJECT_SEC } from '@wwm/solver';
import type { EvalRecord } from './run.ts';

export interface Dist {
  n: number;
  min: number;
  p10: number;
  p50: number;
  p90: number;
  max: number;
  mean: number;
}

export function dist(values: readonly number[]): Dist {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { n: 0, min: 0, p10: 0, p50: 0, p90: 0, max: 0, mean: 0 };
  const q = (p: number) => v[Math.min(n - 1, Math.floor(p * n))] as number;
  return {
    n,
    min: v[0] as number,
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    max: v[n - 1] as number,
    mean: v.reduce((a, b) => a + b, 0) / n,
  };
}

export interface GroupStats {
  stages: number;
  built: number;
  valid: number;
  solved: number;
  playable: number;
  solvedRate: number;
  playableRate: number;
  parSec: Dist;
  overPar: number;
  cpuMs: Dist;
  buildMs: Dist;
  speedup: Dist;
  failures: Record<string, number>;
  stars: Record<string, number>;
  auditSplitStages: number;
  auditIssues: number;
}

export function group(recs: readonly EvalRecord[]): GroupStats {
  const solved = recs.filter((r) => r.solved);
  const failures: Record<string, number> = {};
  for (const k of FAILURE_KINDS) failures[k] = 0;
  for (const r of recs)
    if (!r.solved && r.failure) failures[r.failure.kind] = (failures[r.failure.kind] ?? 0) + 1;
  for (const r of recs) if (!r.buildOk) failures['build-failed'] = (failures['build-failed'] ?? 0) + 1;
  const stars: Record<string, number> = {};
  for (const r of solved) stars[r.stars] = (stars[r.stars] ?? 0) + 1;
  return {
    stages: recs.length,
    built: recs.filter((r) => r.buildOk).length,
    valid: recs.filter((r) => r.valid).length,
    solved: solved.length,
    playable: recs.filter((r) => r.playable).length,
    solvedRate: recs.length ? solved.length / recs.length : 0,
    playableRate: recs.length ? recs.filter((r) => r.playable).length / recs.length : 0,
    parSec: dist(solved.map((r) => r.parSec)),
    overPar: solved.filter((r) => r.parSec > PAR_REJECT_SEC).length,
    cpuMs: dist(recs.filter((r) => r.buildOk).map((r) => r.solveCpuMs)),
    buildMs: dist(recs.filter((r) => r.buildOk).map((r) => r.buildMs)),
    speedup: dist(recs.filter((r) => r.speedup > 0).map((r) => r.speedup)),
    failures,
    stars,
    auditSplitStages: recs.filter((r) => r.audit.split + r.audit.noGround > 0).length,
    auditIssues: recs.reduce((a, r) => a + r.audit.split + r.audit.noGround, 0),
  };
}

export interface RunStats {
  slug: string;
  difficulty: Difficulty;
  seed: number;
  slices: number;
  playableSlices: number;
  /** Every slice playable (the whole page run can be finished). */
  playable: boolean;
  /** Slices playable from the start before the first unplayable one (what the Worker would publish). */
  prefix: number;
  totalParSec: number;
}

export interface EvalReport {
  schema: 'wwm.eval/1';
  generatedAt: string;
  builderVersion: string;
  physicsVersion: string;
  host: { node: string; platform: string; cpu: string; workers: number };
  parRejectSec: number;
  wallMs: number;
  overall: GroupStats;
  byDifficulty: Record<string, GroupStats>;
  /** Legacy Phase 02 fixtures vs the eval-* set. */
  bySet: Record<string, GroupStats>;
  runs: { overall: { runs: number; playable: number; rate: number; meanPrefix: number }; list: RunStats[] };
  records: EvalRecord[];
}

export function runStats(recs: readonly EvalRecord[]): EvalReport['runs'] {
  const byKey = new Map<string, EvalRecord[]>();
  for (const r of recs) {
    const k = `${r.slug}|${r.difficulty}|${r.seed}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const list: RunStats[] = [];
  for (const rs of byKey.values()) {
    rs.sort((a, b) => a.slice - b.slice);
    const f = rs[0] as EvalRecord;
    let prefix = 0;
    while (prefix < rs.length && (rs[prefix] as EvalRecord).playable) prefix++;
    list.push({
      slug: f.slug,
      difficulty: f.difficulty,
      seed: f.seed,
      slices: rs.length,
      playableSlices: rs.filter((r) => r.playable).length,
      playable: rs.every((r) => r.playable),
      prefix,
      totalParSec: rs.reduce((a, r) => a + r.parSec, 0),
    });
  }
  const playable = list.filter((r) => r.playable).length;
  return {
    overall: {
      runs: list.length,
      playable,
      rate: list.length ? playable / list.length : 0,
      meanPrefix: list.length ? list.reduce((a, r) => a + r.prefix / r.slices, 0) / list.length : 0,
    },
    list,
  };
}
