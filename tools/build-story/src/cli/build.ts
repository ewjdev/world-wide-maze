/**
 * Build content/build-story/timeline.json from git, docs/build-log/*.md and content/build-story/sources/*.json.
 *
 *   node tools/build-story/src/cli/build.ts [--rev <commit>]
 *
 * `--rev` picks the snapshot (default HEAD). Everything is
 * measured up to that commit's time. Deterministic: for the same rev and sources the output is byte-identical
 * (tools/build-story/test/timeline-file.test.ts checks this).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readRepo, TIMELINE_FILE } from '../repo.ts';
import { buildTimeline } from '../timeline.ts';
import type { Timeline } from '../types.ts';

const repo = resolve(import.meta.dirname, '../../../..');
const out = join(repo, TIMELINE_FILE);
const { values } = parseArgs({ options: { rev: { type: 'string' } } });
const rev = values.rev ?? 'HEAD';
if (existsSync(out)) {
  const was = (JSON.parse(readFileSync(out, 'utf8')) as Timeline).asOf.sha;
  console.log(`(previous snapshot: ${was})`);
}

const timeline = buildTimeline(readRepo(repo, rev));
writeFileSync(out, `${JSON.stringify(timeline, null, 2)}\n`);

const h = (m: number) => `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
console.log(
  [
    `as of ${timeline.asOf.sha} (${timeline.asOf.at})`,
    `wall clock ${h(timeline.wallClock.min)} from ${timeline.start.what.toLowerCase()} ${timeline.start.at}`,
    `active ${h(timeline.active.min)}, idle ${h(timeline.idle.min)}`,
    `${timeline.agents.runs} agent runs, ${h(timeline.agents.agentMin)} agent time, up to ${timeline.agents.maxConcurrent} at once`,
    `owner: ${timeline.owner.messages} messages, ${timeline.owner.words} words`,
    `${timeline.git.commits} commits, ${timeline.tests.passed} tests, ${timeline.lines.total.source} source + ${timeline.lines.total.test} test lines`,
  ].join('\n'),
);
