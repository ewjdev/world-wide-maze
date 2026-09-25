/**
 * Phase 15c (grounding): provenance labels on chunks, headings in chunk titles, intent-weighted retrieval, the
 * "plan presented as fact" check, and the "what exists today" summary staying consistent with the build story.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildIndex, corpusFiles } from '../src/build.ts';
import { chunkMarkdown } from '../src/chunk.ts';
import { type EvalSet, kindResolver, planAsFact, scoreItem, summarize } from '../src/eval-core.ts';
import { createSearcher, intentWeights, sourceKind, weightHits } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const index = buildIndex(root);
const byId = new Map(index.chunks.map((c) => [c.id, c]));
const search = createSearcher(index.chunks);
const top = (q: string, k = 6) =>
  weightHits(search.search(q, 60), intentWeights(q))
    .slice(0, k)
    .map((h) => h.chunk);

describe('source kinds', () => {
  test('by path and RESEARCH.md part', () => {
    expect(sourceKind('docs/build-log/phase-03.md')).toBe('build-log');
    expect(sourceKind('docs/facts/whats-built.md')).toBe('status');
    expect(sourceKind('plans/phase-11-ai-remix.md')).toBe('plan');
    expect(sourceKind('research/recreation-plan.md')).toBe('plan');
    expect(sourceKind('research/world-wide-maze.md')).toBe('history');
    expect(sourceKind('research/recovery-evidence.json')).toBe('history');
    expect(sourceKind('docs/reference/bundle-notes.md')).toBe('history');
    expect(sourceKind('docs/reference/contract-deltas.md')).toBe('plan');
    expect(sourceKind('docs/reference/fidelity-spec.md')).toBe('reference');
    expect(sourceKind('RESEARCH.md', ['Part 1 — What the original was', '1.3 How it was built'])).toBe(
      'history',
    );
    expect(sourceKind('RESEARCH.md', ['Part 5 — Where AI fits (showcase angle)'])).toBe('plan');
    expect(sourceKind('RESEARCH.md', ['Sources'])).toBe('history');
    expect(sourceKind('RESEARCH.md', [])).toBe('plan'); // the goal statement
  });

  test('every chunk in the index is labelled; RESEARCH.md Parts 2–8 and the recreation plan are plans', () => {
    for (const c of index.chunks) expect(c.kind, c.id).toMatch(/^(history|plan|build-log|status|reference)$/);
    expect(byId.get('RESEARCH.md#part-5--where-ai-fits-showcase-angle')?.kind).toBe('plan');
    expect(byId.get('RESEARCH.md#13-how-it-was-built-from-saqooshas-case-study')?.kind).toBe('history');
    expect(byId.get('research/world-wide-maze.md#who-deserves-credit')?.kind).toBe('history');
    expect(byId.get('apps/web/src/pages/about/history.ts#credits')?.kind).toBe('history');
    for (const c of index.chunks.filter((x) => x.path === 'research/recreation-plan.md'))
      expect(c.kind).toBe('plan');
    for (const c of index.chunks.filter((x) => x.path.startsWith('docs/build-log/')))
      expect(c.kind).toBe('build-log');
    expect(corpusFiles(root)).toContain('docs/facts/whats-built.md');
    expect(index.chunks.filter((c) => c.kind === 'status').length).toBeGreaterThan(0);
  });

  test('small sections of different kinds are never merged into one chunk', () => {
    const md = [
      '# Dossier',
      '## Part 1 — What the original was',
      'Short history.',
      '## Part 2 — Rebuild strategy',
      'Short plan.',
    ].join('\n');
    const chunks = chunkMarkdown(md, { path: 'RESEARCH.md' });
    expect(chunks.map((c) => c.kind)).toEqual(['history', 'plan']);
    expect(chunks[0]?.text).not.toContain('Short plan');
  });
});

describe('chunk titles carry the headings', () => {
  test('parent headings, merged sections and bold pseudo-headings', () => {
    const builder = index.chunks.find(
      (c) =>
        c.path === 'RESEARCH.md' && c.text.includes('Maze carving') && c.text.includes('Background removal'),
    );
    expect(builder?.title).toContain('Part 1 — What the original was');
    expect(builder?.title).toContain('1.3 How it was built');
    expect(builder?.title).toContain('Stage builder algorithm');
    const engineering = index.chunks.find(
      (c) => c.path === 'research/world-wide-maze.md' && c.text.includes('## The original engineering'),
    );
    expect(engineering?.title).toContain('The original engineering, condensed');
  });
});

describe('intent-weighted retrieval', () => {
  test('2013 questions favour history over the rebuild’s build logs', () => {
    const w = intentWeights('How did the 2013 original stage builder work?');
    expect(w.history).toBeGreaterThan(w['build-log']);
    expect(w.plan).toBeLessThan(1);
    const hits = top('How did the 2013 stage builder turn a page into islands?');
    expect(hits[0]?.kind).toBe('history');
    expect(hits.map((c) => c.id)).toContain('RESEARCH.md#13-how-it-was-built-from-saqooshas-case-study~3');
  });

  test('questions about this rebuild favour the status summary; plans don’t outrank it', () => {
    const w = intentWeights('What does this rebuild use AI for?');
    expect(w.status).toBeGreaterThan(w.plan);
    for (const q of ['What did AI agents do in this rebuild?', 'Is there an AI Remix mode?']) {
      const hits = top(q);
      expect(hits[0]?.kind, q).toBe('status');
      expect(hits.slice(0, 3).filter((c) => c.kind === 'plan').length, q).toBe(0);
    }
  });

  test('plans are not demoted when the question asks about plans', () => {
    expect(intentWeights('What was the original plan for AI in this rebuild?').plan).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe('plan presented as fact', () => {
  test('flags sentences cited only to plans, unless they say it was planned', () => {
    const kinds = ['plan', 'status', 'plan'] as const;
    expect(
      planAsFact('Vision models map ads to hazard islands [1]. The docent is live [2].', [...kinds]),
    ).toEqual(['Vision models map ads to hazard islands [1].']);
    // the marker after the full stop still belongs to the sentence before it
    expect(
      planAsFact('Vision models pick the music. [1] Only the docent calls a model. [2]', [...kinds]),
    ).toEqual(['Vision models pick the music [1].']);
    expect(
      planAsFact('The research plan proposed AI theming [1], but it was never built [2].', [...kinds]),
    ).toEqual([]);
    expect(planAsFact('AI theming was planned but not built [1][3].', [...kinds])).toEqual([]);
    expect(planAsFact('Mixed support [1][2].', [...kinds])).toEqual([]);
  });

  test('scoreItem resolves citation kinds, checks expected kinds and counts plan-as-fact answers', () => {
    const kindOf = kindResolver(index.chunks);
    const item = {
      id: 'x',
      question: 'q',
      expect: 'answer' as const,
      kinds: ['status' as const],
      sources: ['x'],
    };
    const s = scoreItem(
      item,
      {
        outcome: 'answered',
        text: 'The game themes stages with AI [1].',
        citations: [{ title: 'P5', path: 'RESEARCH.md', anchor: 'part-5--where-ai-fits-showcase-angle' }],
      },
      kindOf,
    );
    expect(s.citedKinds).toEqual(['plan']);
    expect(s.kindHit).toBe(false);
    expect(s.planAsFact).toHaveLength(1);
    const sum = summarize([s]);
    expect(sum.planAsFact).toBe(1);
    expect(sum.kindAccuracy).toBe(0);
  });
});

describe('what exists today (docs/facts/whats-built.md)', () => {
  const doc = readFileSync(join(root, 'docs/facts/whats-built.md'), 'utf8');
  const t = JSON.parse(readFileSync(join(root, 'content/build-story/timeline.json'), 'utf8'));
  const n = (x: number) => x.toLocaleString('en-US');

  test('its numbers are the build story’s numbers', () => {
    expect(doc).toContain(`snapshot \`${t.asOf.sha}\``);
    expect(doc).toContain(
      `${t.agents.runs} agent runs: ${t.agents.phaseRuns} phase runs, ${t.agents.followUpRuns} follow-up runs and ${t.agents.helperRuns} helper runs`,
    );
    expect(doc).toContain(
      `${t.agents.agentMin} minutes of agent time and ${t.agents.orchestratorMin} minutes`,
    );
    expect(doc).toContain(`at most ${t.agents.maxConcurrent} agents`);
    expect(doc).toContain(`${t.owner.messages} messages (${t.owner.words} words)`);
    expect(doc).toContain(
      `${t.git.commits} commits; ${n(t.tests.passed)} tests passing (${t.tests.skipped} skipped)`,
    );
    expect(doc).toContain(`${n(t.lines.total.source)} source lines and ${n(t.lines.total.test)} test lines`);
    expect(doc).toContain(
      `${t.buildLogs.files} build logs recording ${t.buildLogs.failedAttempts} failed attempts and ${t.buildLogs.humanInterventions} manual human interventions`,
    );
    expect(doc).toContain(t.agents.model);
  });

  test('never quotes an eval question (the mock would answer it from this file)', () => {
    const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
    for (const f of ['eval.json', 'eval-heldout.json']) {
      const set = JSON.parse(readFileSync(join(root, 'tools/docent-index', f), 'utf8')) as EvalSet;
      for (const i of set.items) expect(fold(doc), i.id).not.toContain(fold(i.question));
    }
  });
});
