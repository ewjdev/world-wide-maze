/**
 * Static eval dashboard (fixtures/eval/index.html): KPI tiles, per-difficulty table, par-time histogram vs the
 * 150 s rejection line, failure classes, per-stage cards (debugger thumbnail, per-seed status, metrics,
 * failure diagnosis) and the human "recognizable? fun? (1–5)" rating, saved through `serve.ts` to
 * fixtures/eval/ratings.json (falls back to localStorage + export when opened as a file).
 * Colors: dataviz reference palette (single-series blue; status colors only with icon + label).
 */
import type { EvalReport } from './report.ts';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export function renderDashboard(report: EvalReport): string {
  // Only what the page needs (thumbnails are files next to the page).
  const data = {
    generatedAt: report.generatedAt,
    builderVersion: report.builderVersion,
    physicsVersion: report.physicsVersion,
    host: report.host,
    parRejectSec: report.parRejectSec,
    overall: report.overall,
    byDifficulty: report.byDifficulty,
    bySet: report.bySet,
    runs: report.runs.overall,
    runList: report.runs.list,
    records: report.records.map((r) => ({
      slug: r.slug,
      slice: r.slice,
      sliceCount: r.sliceCount,
      difficulty: r.difficulty,
      seed: r.seed,
      stageId: r.stageId,
      valid: r.valid,
      buildOk: r.buildOk,
      islands: r.islands,
      bridges: r.bridges,
      ramps: r.ramps,
      elevators: r.elevators,
      smallItems: r.smallItems,
      largeItems: r.largeItems,
      buildMs: Math.round(r.buildMs),
      solveCpuMs: Math.round(r.solveCpuMs),
      solved: r.solved,
      playable: r.playable,
      parSec: Math.round(r.parSec * 10) / 10,
      falls: r.falls,
      jumps: r.jumps,
      stars: r.stars,
      variant: r.variant,
      failure: r.failure ?? null,
      audit: { split: r.audit.split, noGround: r.audit.noGround },
      thumb: r.thumb ?? null,
    })),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WWM batch eval — ${esc(report.generatedAt.slice(0, 10))}</title>
<style>${CSS}</style>
</head>
<body>
<div class="viz-root">
<header>
  <h1>World Wide Maze — batch eval</h1>
  <p class="meta" id="meta"></p>
</header>
<section class="tiles" id="tiles" aria-label="Headline numbers"></section>
<section class="row">
  <div class="panel grow">
    <h2>By difficulty</h2>
    <table class="num" id="diffTable"></table>
    <h2 class="mt">Capture sets</h2>
    <table class="num" id="setTable"></table>
  </div>
  <div class="panel grow">
    <h2>Par time of solved stages <span class="sub">(s; rejection above ${report.parRejectSec} s)</span></h2>
    <div id="parHist" class="chart"></div>
    <details><summary>Table view</summary><table class="num" id="parTable"></table></details>
  </div>
  <div class="panel grow">
    <h2>Failure classes <span class="sub">(unsolved stages)</span></h2>
    <div id="failBars" class="chart"></div>
  </div>
</section>
<section class="panel">
  <fieldset class="filters" aria-label="Filters">
    <label>Difficulty <select id="fDiff"><option>normal</option><option>easy</option><option>hard</option></select></label>
    <label>Show <select id="fShow"><option value="all">all stages</option><option value="fail">with an unplayable seed</option><option value="jump">needing a jump</option><option value="unrated">not rated yet</option></select></label>
    <label>Search <input id="fText" type="search" placeholder="slug"></label>
    <span class="spacer"></span>
    <span id="ratingStatus" class="muted"></span>
    <button type="button" id="exportRatings">Export ratings.json</button>
  </fieldset>
  <p class="muted small">Each card is one page slice. Chips = seeds 1–3 at the selected difficulty. The thumbnail
  is normal / seed 1 (or the failing run): islands outlined by height, bridges blue (ramps orange), elevators cyan,
  planned route yellow, ball trace magenta (red on failure), start green dot, goal gold ring, failure red ring,
  falls red ×.</p>
  <div id="cards" class="cards"></div>
</section>
</div>
<div id="tip" class="tip" role="tooltip" hidden></div>
<script id="data" type="application/json">${json}</script>
<script>${JS}</script>
</body>
</html>
`;
}

const CSS = `
.viz-root{color-scheme:light;--surface-1:#fcfcfb;--page:#f9f9f7;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;
--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);--series-1:#2a78d6;--good:#0ca30c;--good-text:#006300;
--critical:#d03b3b;--warning:#fab219;--threshold:#d03b3b;}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .viz-root{color-scheme:dark;--surface-1:#1a1a19;
--page:#0d0d0d;--ink:#fff;--ink-2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--series-1:#3987e5;
--good-text:#0ca30c;}}
*{box-sizing:border-box}
body{margin:0;background:#f9f9f7;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){body{background:#0d0d0d}}
.viz-root{background:var(--page);color:var(--ink);padding:20px 24px 40px;min-height:100vh}
h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;margin:0 0 10px;font-weight:600}
.sub,.muted{color:var(--muted);font-weight:400}.small{font-size:12px}.mt{margin-top:18px}
.meta{color:var(--ink-2);margin:0 0 16px;font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.tile{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.tile .v{font-size:26px;font-weight:600}.tile .l{color:var(--ink-2);font-size:12px}.tile .d{color:var(--muted);font-size:12px}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}.grow{flex:1 1 360px}
.panel{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:4px 6px;white-space:nowrap;border-bottom:1px solid var(--grid);text-align:left}
th{color:var(--ink-2);font-weight:600}table.num td:not(:first-child),table.num th:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
.chart svg{display:block;width:100%;height:auto}.chart text{fill:var(--muted);font-size:11px}
.chart .bar{fill:var(--series-1)}.chart .bar:hover,.chart .hit:hover+.bar{opacity:.8}.chart .gridline{stroke:var(--grid)}
.chart .base{stroke:var(--axis)}.chart .thr{stroke:var(--threshold);stroke-width:2;stroke-dasharray:4 3}.chart .thrlab{fill:var(--ink-2)}
.chart .lab{fill:var(--ink-2)}.chart .val{fill:var(--ink)}
details{margin-top:8px;font-size:13px}summary{cursor:pointer;color:var(--ink-2)}
.filters{border:0;padding:0;margin:0 0 6px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:6px}.spacer{flex:1}
select,input,button,textarea{font:inherit;color:var(--ink);background:var(--page);border:1px solid var(--border);border-radius:6px;padding:4px 8px}
button{cursor:pointer}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:10px}
.card{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--page);display:flex;flex-direction:column;gap:6px}
.card h3{font-size:13px;margin:0;display:flex;justify-content:space-between;gap:6px}.card h3 .sl{color:var(--muted);font-weight:400}
.thumb{width:100%;aspect-ratio:1280/1500;object-fit:cover;object-position:top;border-radius:6px;background:#12161e}
.nothumb{display:grid;place-items:center;color:var(--muted);font-size:12px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{display:inline-flex;gap:4px;align-items:center;border:1px solid var(--border);border-radius:99px;padding:1px 8px;font-size:12px}
.chip .ic{font-weight:700}.chip.ok .ic{color:var(--good)}.chip.bad .ic{color:var(--critical)}.chip.slow .ic{color:var(--warning)}
.kv{display:grid;grid-template-columns:repeat(3,1fr);gap:2px 8px;font-size:12px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.kv b{color:var(--ink);font-weight:600}
.fail{font-size:12px;color:var(--ink);border-left:3px solid var(--critical);padding-left:6px}
.rate{display:flex;gap:10px;align-items:center;font-size:12px;flex-wrap:wrap}.rate select{padding:2px 4px}
.rate textarea{width:100%;min-height:28px;font-size:12px;resize:vertical}
.tip{position:fixed;pointer-events:none;background:var(--ink,#0b0b0b);color:#fff;padding:5px 8px;border-radius:6px;font:12px system-ui;z-index:10;max-width:280px}
@media (prefers-color-scheme:dark){.tip{background:#fff;color:#0b0b0b}}
`;

// Client script (plain JS; the page must work from file:// and from `serve.ts`).
const JS = `
const D = JSON.parse(document.getElementById('data').textContent);
const $ = (id) => document.getElementById(id);
const pct = (x) => (x * 100).toFixed(1) + ' %';
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const tip = $('tip');
function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 12) + 'px'; }
function hideTip() { tip.hidden = true; }

$('meta').textContent = 'Generated ' + D.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC · builder ' + D.builderVersion +
  ' · physics ' + D.physicsVersion + ' · ' + D.host.cpu + ' (' + D.host.workers + ' workers, Node ' + D.host.node + ')';

const N = D.byDifficulty.normal || D.overall;
const tiles = [
  ['Stages evaluated', String(D.overall.stages), D.records.length ? new Set(D.records.map(r => r.slug)).size + ' captures × slices × difficulties × seeds' : ''],
  ['Solved at normal', pct(N.solvedRate), N.solved + ' / ' + N.stages + ' stages'],
  ['Solved, all difficulties', pct(D.overall.solvedRate), D.overall.solved + ' / ' + D.overall.stages],
  ['Par time p50 / p90', f1(N.parSec.p50) + ' / ' + f1(N.parSec.p90) + ' s', 'max ' + f1(N.parSec.max) + ' s · ' + N.overPar + ' over ' + D.parRejectSec + ' s'],
  ['Solve CPU p50 / p90', N.cpuMs.p50.toFixed(0) + ' / ' + N.cpuMs.p90.toFixed(0) + ' ms', 'max ' + N.cpuMs.max.toFixed(0) + ' ms · ' + D.overall.speedup.p50.toFixed(0) + '× real time'],
  ['Runs fully playable', D.runs.playable + ' / ' + D.runs.runs, pct(D.runs.rate) + ' of page × difficulty × seed'],
];
$('tiles').innerHTML = tiles.map(t => '<div class="tile"><div class="l">' + t[0] + '</div><div class="v">' + t[1] + '</div><div class="d">' + t[2] + '</div></div>').join('');

function groupTable(el, groups) {
  const rows = Object.entries(groups);
  el.innerHTML = '<tr><th></th><th>stages</th><th>solved</th><th>rate</th><th>par p50</th><th>par max</th><th>cpu p50</th><th>cpu p90</th></tr>' +
    rows.map(([k, g]) => '<tr><td>' + k + '</td><td>' + g.stages + '</td><td>' + g.solved + '</td><td>' + pct(g.solvedRate) + '</td><td>' + f1(g.parSec.p50) +
      ' s</td><td>' + f1(g.parSec.max) + ' s</td><td>' + g.cpuMs.p50.toFixed(0) + ' ms</td><td>' + g.cpuMs.p90.toFixed(0) + ' ms</td></tr>').join('');
}
groupTable($('diffTable'), D.byDifficulty);
groupTable($('setTable'), D.bySet);

// Par histogram (10 s bins), all difficulties, with the rejection threshold.
(function () {
  const pars = D.records.filter(r => r.solved).map(r => r.parSec);
  const maxX = Math.max(D.parRejectSec + 10, Math.ceil(Math.max(0, ...pars) / 10) * 10 + 10);
  const bins = []; for (let x = 0; x < maxX; x += 10) bins.push({ x, n: 0 });
  for (const p of pars) bins[Math.min(bins.length - 1, Math.floor(p / 10))].n++;
  const W = 460, H = 200, L = 36, B = 24, T = 10, R = 8;
  const maxN = Math.max(1, ...bins.map(b => b.n));
  const nice = Math.pow(10, Math.floor(Math.log10(maxN))); const top = Math.ceil(maxN / nice) * nice;
  const sx = (x) => L + (x / maxX) * (W - L - R), sy = (n) => H - B - (n / top) * (H - B - T);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Histogram of par times">';
  for (let k = 0; k <= 4; k++) { const v = top * k / 4, y = sy(v); s += '<line class="gridline" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (L - 4) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(v) + '</text>'; }
  const bw = (W - L - R) / bins.length;
  bins.forEach((b, i) => {
    if (!b.n) return;
    const x = sx(b.x) + 1, y = sy(b.n), h = H - B - y, w = bw - 2;
    s += '<g data-tip="' + b.x + '–' + (b.x + 10) + ' s: <b>' + b.n + '</b> stages"><rect class="hit" x="' + (x - 1) + '" y="' + T + '" width="' + bw + '" height="' + (H - B - T) + '" fill="transparent"/>' +
      '<path class="bar" d="M' + x + ',' + (H - B) + 'V' + (y + Math.min(4, h)) + 'q0,-' + Math.min(4, h) + ' ' + Math.min(4, w / 2) + ',-' + Math.min(4, h) + 'H' + (x + w - Math.min(4, w / 2)) + 'q' + Math.min(4, w / 2) + ',0 ' + Math.min(4, w / 2) + ',' + Math.min(4, h) + 'V' + (H - B) + 'Z"/></g>';
  });
  s += '<line class="base" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
  for (let x = 0; x <= maxX; x += 30) s += '<text x="' + sx(x) + '" y="' + (H - 6) + '" text-anchor="middle">' + x + '</text>';
  const tx = sx(D.parRejectSec);
  s += '<line class="thr" x1="' + tx + '" x2="' + tx + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="thrlab" x="' + (tx - 4) + '" y="' + (T + 10) + '" text-anchor="end">reject &gt; ' + D.parRejectSec + ' s</text>';
  $('parHist').innerHTML = s + '</svg>';
  $('parTable').innerHTML = '<tr><th>par (s)</th><th>stages</th></tr>' + bins.map(b => '<tr><td>' + b.x + '–' + (b.x + 10) + '</td><td>' + b.n + '</td></tr>').join('');
})();

// Failure classes (horizontal bars, all difficulties).
(function () {
  const rows = Object.entries(D.overall.failures).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) { $('failBars').innerHTML = '<p class="muted">No failures.</p>'; return; }
  const W = 460, rowH = 26, L = 130, R = 40, H = rows.length * rowH + 6;
  const max = Math.max(...rows.map(r => r[1]));
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Failure classes">';
  rows.forEach(([k, n], i) => {
    const y = 4 + i * rowH, w = Math.max(2, (n / max) * (W - L - R));
    s += '<g data-tip="' + k + ': <b>' + n + '</b> of ' + D.overall.stages + ' stages"><rect x="0" y="' + y + '" width="' + W + '" height="' + (rowH - 2) + '" fill="transparent"/>' +
      '<text class="lab" x="' + (L - 8) + '" y="' + (y + 16) + '" text-anchor="end">' + k + '</text>' +
      '<rect class="bar" x="' + L + '" y="' + (y + 4) + '" width="' + w + '" height="' + (rowH - 10) + '" rx="3"/>' +
      '<text class="val" x="' + (L + w + 6) + '" y="' + (y + 16) + '">' + n + '</text></g>';
  });
  $('failBars').innerHTML = s + '</svg>';
})();
document.querySelectorAll('.chart').forEach(c => {
  c.addEventListener('mousemove', (e) => { const g = e.target.closest('[data-tip]'); if (g) showTip(e, g.getAttribute('data-tip')); else hideTip(); });
  c.addEventListener('mouseleave', hideTip);
});

// ── Ratings: POST to serve.ts (fixtures/eval/ratings.json); localStorage fallback ──
const LS = 'wwm-eval-ratings';
let ratings = {};
let serverOk = false;
async function loadRatings() {
  try { const r = await fetch('api/ratings'); if (r.ok) { ratings = await r.json(); serverOk = true; } } catch (e) {}
  if (!serverOk) { try { ratings = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { ratings = {}; } }
  $('ratingStatus').textContent = serverOk ? 'Ratings save to fixtures/eval/ratings.json' : 'Ratings save in this browser (run the serve script to write ratings.json)';
}
async function saveRating(key, patch) {
  ratings[key] = Object.assign({}, ratings[key], patch, { at: new Date().toISOString() });
  if (serverOk) {
    try { await fetch('api/ratings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, rating: ratings[key] }) }); return; } catch (e) { serverOk = false; }
  }
  localStorage.setItem(LS, JSON.stringify(ratings));
}
$('exportRatings').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(ratings, null, 1)], { type: 'application/json' }));
  a.download = 'ratings.json'; a.click();
};

// ── Stage cards ──
const bySlice = new Map();
for (const r of D.records) { const k = r.slug + '#' + r.slice; if (!bySlice.has(k)) bySlice.set(k, []); bySlice.get(k).push(r); }
function chip(r) {
  const cls = r.playable ? 'ok' : r.solved ? 'slow' : 'bad';
  const ic = r.playable ? '✓' : r.solved ? '!' : '✕';
  const text = r.playable ? f1(r.parSec) + ' s' : r.solved ? 'par ' + f1(r.parSec) + ' s' : (r.failure ? r.failure.kind : 'build failed');
  return '<span class="chip ' + cls + '" title="seed ' + r.seed + '"><span class="ic" aria-hidden="true">' + ic + '</span>s' + r.seed + ' ' + text + (r.jumps ? ' · jump' : '') + '</span>';
}
function stars(n) { return n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '–'; }
function sel(name, v) {
  let o = '<select data-k="' + name + '"><option value="">–</option>';
  for (let i = 1; i <= 5; i++) o += '<option' + (String(v) === String(i) ? ' selected' : '') + '>' + i + '</option>';
  return o + '</select>';
}
function render() {
  const diff = $('fDiff').value, show = $('fShow').value, q = $('fText').value.trim().toLowerCase();
  const out = [];
  for (const [k, recs] of bySlice) {
    const rs = recs.filter(r => r.difficulty === diff).sort((a, b) => a.seed - b.seed);
    if (!rs.length) continue;
    const r0 = rs[0];
    if (q && !r0.slug.includes(q)) continue;
    if (show === 'fail' && rs.every(r => r.playable)) continue;
    if (show === 'jump' && rs.every(r => !r.jumps)) continue;
    const rk = r0.slug + '#' + r0.slice;
    if (show === 'unrated' && ratings[rk] && ratings[rk].recognizable && ratings[rk].fun) continue;
    const thumbRec = recs.find(r => r.thumb && !r.playable && r.difficulty === diff) || recs.find(r => r.thumb && r.difficulty === 'normal' && r.seed === 1) || recs.find(r => r.thumb);
    const fr = rs.find(r => !r.playable);
    const rt = ratings[rk] || {};
    out.push('<article class="card" data-key="' + rk + '"><h3><span>' + r0.slug + ' <span class="sl">slice ' + (r0.slice + 1) + '/' + r0.sliceCount + '</span></span><span title="difficulty stars (seed 1)">' + stars(r0.stars) + '</span></h3>' +
      (thumbRec ? '<img class="thumb" loading="lazy" alt="stage ' + rk + ' ' + thumbRec.difficulty + ' seed ' + thumbRec.seed + '" src="' + thumbRec.thumb + '" title="' + thumbRec.difficulty + ' seed ' + thumbRec.seed + '">' : '<div class="thumb nothumb">no thumbnail</div>') +
      '<div class="chips">' + rs.map(chip).join('') + '</div>' +
      '<div class="kv"><span>islands <b>' + r0.islands + '</b></span><span>bridges <b>' + r0.bridges + '</b></span><span>ramps <b>' + r0.ramps + '</b></span>' +
      '<span>elevators <b>' + r0.elevators + '</b></span><span>items <b>' + r0.smallItems + '+' + r0.largeItems + '</b></span><span>falls <b>' + r0.falls + '</b></span>' +
      '<span>build <b>' + r0.buildMs + ' ms</b></span><span>solve <b>' + r0.solveCpuMs + ' ms</b></span><span>audit <b>' + (r0.audit.split + r0.audit.noGround) + '</b></span></div>' +
      (fr && fr.failure ? '<div class="fail">seed ' + fr.seed + ': <b>' + fr.failure.kind + '</b> · island ' + fr.failure.islandId + (fr.failure.bridgeId !== undefined ? ' · bridge ' + fr.failure.bridgeId : '') + (fr.failure.elevatorId !== undefined ? ' · elevator ' + fr.failure.elevatorId : '') + ' @ ' + fr.failure.at.map(Math.round).join(',') + (fr.failure.detail ? '<br>' + fr.failure.detail : '') + '</div>' : '') +
      '<div class="rate"><label>recognizable? ' + sel('recognizable', rt.recognizable) + '</label><label>fun? ' + sel('fun', rt.fun) + '</label></div>' +
      '<div class="rate"><textarea data-k="note" placeholder="playtest note">' + (rt.note ? String(rt.note).replace(/</g, '&lt;') : '') + '</textarea></div></article>');
  }
  $('cards').innerHTML = out.join('') || '<p class="muted">No stages match.</p>';
}
$('cards').addEventListener('change', (e) => {
  const card = e.target.closest('.card'); const k = e.target.getAttribute('data-k');
  if (!card || !k) return;
  const v = e.target.value;
  saveRating(card.getAttribute('data-key'), { [k]: k === 'note' ? v : (v ? Number(v) : null) });
});
['fDiff', 'fShow', 'fText'].forEach(id => $(id).addEventListener('input', render));
loadRatings().then(render);
`;
