/**
 * Bake-off reports: `report.md` (side-by-side table, per-question grid, recommendation), `report.html` (the
 * same, self-contained) and `judge-sample.md` (judged answers for a human to spot-check the judge).
 */
import type { BakeoffRecord, ConfigStats, Recommendation, SetName, SetStats } from './core.ts';
import { seeded } from './dry-run.ts';

export interface ReportMeta {
  title: string;
  mode: 'dry-run' | 'real';
  startedAt: string;
  finishedAt: string;
  commit?: string;
  corpusHash: string;
  judgeModel: string;
  judgeScope: string;
  maxTokens: number;
  spentUsd: number;
  stoppedAtCap: boolean;
  sets: Record<string, number>;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const sec = (ms: number | null) => (ms === null ? '–' : `${(ms / 1000).toFixed(2)} s`);
const usd = (x: number | null, digits = 4) => (x === null ? '–' : `$${x.toFixed(digits)}`);

interface Row {
  label: string;
  cell: (s: ConfigStats) => string;
}

function setRows(name: SetName, label: string): Row[] {
  const get = (s: ConfigStats): SetStats | undefined => s.sets[name];
  const f = (fn: (x: SetStats) => string) => (s: ConfigStats) => {
    const x = get(s);
    return x ? fn(x) : '–';
  };
  return [
    {
      label: `${label}: outcome correct`,
      cell: f((x) => `${x.outcomeOk}/${x.n} (${pct(x.outcomeOk, x.n)})`),
    },
    {
      label: `${label}: answered / don't know / rejected / error`,
      cell: f((x) => `${x.answered} / ${x.dontKnow} / ${x.rejected} / ${x.errors}`),
    },
    {
      label: `${label}: cites an expected source`,
      cell: f((x) => `${x.citationHits}/${x.citationScored} (${pct(x.citationHits, x.citationScored)})`),
    },
    {
      label: `${label}: citation precision`,
      cell: f((x) => (x.citationPrecision === null ? '–' : `${Math.round(x.citationPrecision * 100)}%`)),
    },
    {
      label: `${label}: answers with unsupported claims (judged)`,
      cell: f((x) =>
        x.judged
          ? `**${x.unsupportedAnswers}**/${x.judged}${x.judgePending ? ` (+${x.judgePending} unjudged)` : ''}`
          : 'not judged',
      ),
    },
    {
      label: `${label}: unsupported / miscited sentences`,
      cell: f((x) => (x.judged ? `${x.unsupportedSentences} / ${x.miscitedSentences}` : '–')),
    },
    { label: `${label}: prompt leaks`, cell: f((x) => String(x.leaked)) },
  ];
}

const ROWS: Row[] = [
  { label: 'model', cell: (s) => `\`${s.model}\`` },
  { label: 'effort', cell: (s) => s.effort ?? '(model default)' },
  ...setRows('heldout', 'held-out'),
  ...setRows('original', 'original'),
  { label: 'TTFT p50 / p90 (model text)', cell: (s) => `${sec(s.ttftP50)} / ${sec(s.ttftP90)}` },
  { label: 'first visible text p50 (after grounding gate)', cell: (s) => sec(s.visibleP50) },
  { label: 'total latency p50 / p90', cell: (s) => `${sec(s.totalP50)} / ${sec(s.totalP90)}` },
  { label: 'model calls', cell: (s) => String(s.modelCalls) },
  {
    label: 'tokens in / out (of which thinking)',
    cell: (s) => `${s.inputTokens} / ${s.outputTokens} (${s.thinkingTokens})`,
  },
  { label: 'answer cost, this run', cell: (s) => usd(s.costUsd, 3) },
  { label: 'mean cost per answered call', cell: (s) => usd(s.costPerModelCall) },
  {
    label: 'cost per 1,000 model calls',
    cell: (s) => (s.costPerModelCall === null ? '–' : `$${(s.costPerModelCall * 1000).toFixed(2)}`),
  },
  { label: 'judge cost', cell: (s) => usd(s.judgeCostUsd, 3) },
];

const OUTCOME_MARK: Record<string, string> = { answered: 'A', dont_know: 'DK', rejected: 'R', error: 'ERR' };

function cellFor(r: BakeoffRecord | undefined): string {
  if (!r) return '·';
  let s = OUTCOME_MARK[r.outcome] ?? r.outcome;
  if (!r.outcomeOk) s += '✗';
  if (r.citationHit === false) s += ' c✗';
  if (r.judge?.unsupported) s += ` U${r.judge.unsupported}`;
  if (r.judgeError) s += ' J?';
  if (r.leaked) s += ' LEAK';
  return s;
}

function recommendationText(rec: Recommendation): string[] {
  return [
    `**Rule:** ${rec.rule}.`,
    '',
    rec.pick
      ? `**Recommendation: \`${rec.pick}\`.**`
      : '**No configuration meets the rule.** Pick by hand from the table, or relax the rule knowingly.',
    '',
    ...rec.verdicts.map(
      (v) => `- \`${v.configId}\`: ${v.eligible ? 'eligible' : `not eligible (${v.reasons.join('; ')})`}`,
    ),
  ];
}

function mdTable(head: string[], rows: string[][]): string[] {
  const esc = (c: string) => c.replace(/\|/g, '\\|');
  return [
    `| ${head.map(esc).join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ];
}

export function renderMarkdown(
  meta: ReportMeta,
  stats: ConfigStats[],
  rec: Recommendation,
  records: BakeoffRecord[],
): string {
  const ids = stats.map((s) => s.configId);
  const byKey = new Map(records.map((r) => [`${r.configId}|${r.set}|${r.itemId}`, r]));
  const items = [...new Map(records.map((r) => [`${r.set}|${r.itemId}`, r])).values()];
  const dry =
    meta.mode === 'dry-run'
      ? [
          '> **DRY RUN.** Offline mock answers with fake latency, synthetic token counts and a mechanical judge. No',
          '> model was called. The numbers only show that the pipeline, scoring and report work; they say nothing',
          '> about the models.',
          '',
        ]
      : [];
  return [
    `# ${meta.title}`,
    '',
    ...dry,
    `- Mode: **${meta.mode}**. Started ${meta.startedAt}, finished ${meta.finishedAt}.`,
    `- Commit ${meta.commit ?? 'unknown'}; corpus index ${meta.corpusHash}; max_tokens ${meta.maxTokens}.`,
    `- Questions: ${Object.entries(meta.sets)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}. Judge: \`${meta.judgeModel}\` on ${meta.judgeScope}.`,
    `- Spend recorded in this run directory: $${meta.spentUsd.toFixed(3)}${meta.stoppedAtCap ? ' (**stopped at the spend cap**; rerun with `--resume` to finish)' : ''}.`,
    '',
    '## Recommendation',
    '',
    ...recommendationText(rec),
    '',
    '## Side by side',
    '',
    ...mdTable(
      ['', ...ids.map((i) => `\`${i}\``)],
      ROWS.map((r) => [r.label, ...stats.map((s) => r.cell(s))]),
    ),
    '',
    'TTFT is the time from the question to the first text token from the model (after any thinking), measured',
    'in-process through the production engine; it excludes the Worker hop, KV and rate-limit checks. "First',
    'visible" is when the grounding gate lets the first text through to the visitor.',
    '',
    '## Per question',
    '',
    'A answered, DK don’t know, R rejected, ERR error; ✗ wrong outcome; c✗ no expected source cited;',
    'U*n* unsupported sentences (judge); J? judgment failed; LEAK system prompt echoed.',
    '',
    ...mdTable(
      ['set', 'id', 'expect', ...ids.map((i) => `\`${i}\``)],
      items.map((it) => [
        it.set,
        it.itemId,
        [it.expect, ...(it.accept ?? [])].join('/'),
        ...ids.map((c) => cellFor(byKey.get(`${c}|${it.set}|${it.itemId}`))),
      ]),
    ),
    '',
  ].join('\n');
}

const escHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
/** Tiny markdown-inline → HTML for table cells (`code` and **bold** only). */
const inline = (s: string) =>
  escHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

export function renderHtml(
  meta: ReportMeta,
  stats: ConfigStats[],
  rec: Recommendation,
  records: BakeoffRecord[],
): string {
  const ids = stats.map((s) => s.configId);
  const byKey = new Map(records.map((r) => [`${r.configId}|${r.set}|${r.itemId}`, r]));
  const items = [...new Map(records.map((r) => [`${r.set}|${r.itemId}`, r])).values()];
  const th = (cells: string[]) => `<tr>${cells.map((c) => `<th scope="col">${c}</th>`).join('')}</tr>`;
  const side = ROWS.map(
    (r) =>
      `<tr><th scope="row">${escHtml(r.label)}</th>${stats
        .map((s) => `<td${s.configId === rec.pick ? ' class="pick"' : ''}>${inline(r.cell(s))}</td>`)
        .join('')}</tr>`,
  ).join('\n');
  const grid = items
    .map((it) => {
      const cells = ids
        .map((c) => {
          const r = byKey.get(`${c}|${it.set}|${it.itemId}`);
          const bad = r && (!r.outcomeOk || r.judge?.unsupported || r.leaked || r.error);
          const title = r ? escHtml(r.text.slice(0, 600) || r.error || '') : '';
          return `<td class="${bad ? 'bad' : 'ok'}" title="${title}">${escHtml(cellFor(r))}</td>`;
        })
        .join('');
      return `<tr><td>${it.set}</td><td><code>${escHtml(it.itemId)}</code></td><td>${escHtml(
        [it.expect, ...(it.accept ?? [])].join('/'),
      )}</td>${cells}</tr>`;
    })
    .join('\n');
  const verdicts = rec.verdicts
    .map(
      (v) =>
        `<li><code>${escHtml(v.configId)}</code>: ${
          v.eligible ? 'eligible' : `not eligible (${escHtml(v.reasons.join('; '))})`
        }</li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(meta.title)}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 78rem; padding: 0 1rem; color: #1d2328; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
  table { border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #d5dade; padding: .3rem .55rem; text-align: left; vertical-align: top; }
  th[scope=row] { font-weight: 500; background: #f5f7f8; }
  thead th { background: #eef1f3; }
  td.pick { background: #e6f4ef; }
  td.bad { background: #fbe9e7; }
  .dry { border-left: 4px solid #c65d00; background: #fff4e8; padding: .6rem 1rem; }
  .pickline { font-size: 1.1rem; }
  code { font-size: 12px; }
</style>
</head>
<body>
<h1>${escHtml(meta.title)}</h1>
${
  meta.mode === 'dry-run'
    ? '<p class="dry"><strong>Dry run.</strong> Offline mock answers with fake latency, synthetic token counts and a mechanical judge. No model was called; these numbers only show that the pipeline works.</p>'
    : ''
}
<p>Mode <strong>${meta.mode}</strong> · ${escHtml(meta.startedAt)} → ${escHtml(meta.finishedAt)} · commit ${escHtml(
    meta.commit ?? 'unknown',
  )} · corpus ${escHtml(meta.corpusHash)} · max_tokens ${meta.maxTokens} · judge <code>${escHtml(
    meta.judgeModel,
  )}</code> on ${escHtml(meta.judgeScope)} · spend $${meta.spentUsd.toFixed(3)}${
    meta.stoppedAtCap ? ' · <strong>stopped at the spend cap</strong>' : ''
  }</p>
<h2>Recommendation</h2>
<p>${inline(`Rule: ${rec.rule}.`)}</p>
<p class="pickline">${
    rec.pick
      ? `Recommendation: <strong><code>${escHtml(rec.pick)}</code></strong>`
      : '<strong>No configuration meets the rule.</strong>'
  }</p>
<ul>${verdicts}</ul>
<h2>Side by side</h2>
<table>
<thead>${th(['', ...ids.map((i) => `<code>${escHtml(i)}</code>`)])}</thead>
<tbody>
${side}
</tbody>
</table>
<h2>Per question</h2>
<p>A answered, DK don’t know, R rejected, ERR error; ✗ wrong outcome; c✗ no expected source cited; U<i>n</i> unsupported sentences; J? judgment failed. Hover a cell for the answer.</p>
<table>
<thead>${th(['set', 'id', 'expect', ...ids.map((i) => `<code>${escHtml(i)}</code>`)])}</thead>
<tbody>
${grid}
</tbody>
</table>
</body>
</html>
`;
}

/**
 * Judged answers for a human to check the judge: every answer it flagged, plus a seeded random sample of the
 * rest (so the sample is the same on every render of the same run).
 */
export function renderJudgeSample(records: BakeoffRecord[], size: number, seed: string): string {
  const judged = records.filter((r) => r.judge);
  const flagged = judged.filter((r) => (r.judge?.unsupported ?? 0) > 0);
  const rest = judged.filter((r) => !flagged.includes(r));
  const rnd = seeded(seed);
  const shuffled = rest
    .map((r) => ({ r, k: rnd() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.r);
  const pick = [...flagged, ...shuffled.slice(0, Math.max(0, size - flagged.length))];
  const lines = [
    '# Judge sample for human review',
    '',
    `${flagged.length} flagged answer(s) and ${pick.length - flagged.length} random unflagged one(s) of ${judged.length} judged.`,
    'For each: does the verdict match what the excerpts (listed by title) actually say? Record disagreements in',
    'the build log. Excerpt text: `apps/worker/src/docent/corpus.json`, by chunk id.',
    '',
  ];
  for (const r of pick) {
    const j = r.judge as NonNullable<BakeoffRecord['judge']>;
    lines.push(
      `## \`${r.configId}\` · ${r.set} · \`${r.itemId}\` · ${j.unsupported ? `**${j.unsupported} unsupported**` : 'all supported'}`,
      '',
      `**Question:** ${r.question}`,
      '',
      `**Answer** (${r.outcome}):`,
      '',
      ...r.text.split('\n').map((l) => `> ${l}`),
      '',
      `**Excerpts:** ${r.excerpts.map((e) => `${e.ref} \`${e.id}\``).join(', ') || 'none'}`,
      '',
      '| factual | supported | cited excerpt supports | sentence | note |',
      '|---|---|---|---|---|',
      ...j.sentences.map(
        (s) =>
          `| ${s.factual ? 'yes' : 'no'} | ${s.supported ? 'yes' : '**NO**'} | ${s.citedSupport} | ${s.text.replace(/\|/g, '\\|')} | ${s.note.replace(/\|/g, '\\|')} |`,
      ),
      '',
    );
  }
  return lines.join('\n');
}
