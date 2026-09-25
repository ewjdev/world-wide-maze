/**
 * Stage debugger page: pick a capture fixture (or the 2013 reference stage), build it in a Web Worker, and draw
 * every builder step as a toggleable layer. URL parameters (for automation / screenshots):
 *   ?fixture=<slug>|reference &slice=0 &seed=1 &difficulty=normal &zoom=0.75 &layers=a,b,c &shot=1
 * When the drawing is done, `document.body.dataset.ready` is set to "1".
 */
import { type CaptureBundle, parseCapture, parseStage, type StageData, sliceRange } from '@wwm/schema';
import {
  DEFAULT_PARAMS,
  type DebugLayersEx,
  type StageStats,
  sliceCount,
  stageStats,
  statsRows,
} from '@wwm/stage-builder';
import { DEFAULT_LAYERS, drawStage, islandAt, LAYER_LABELS, type LayerToggles } from './draw.ts';
import type { FixtureInfo, WorkerRequest, WorkerResponse } from './protocol.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const q = new URLSearchParams(location.search);
const shot = q.get('shot') === '1';
if (shot) document.body.classList.add('shot');

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const send = (m: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(m, transfer);

const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const fixtureSel = $<HTMLSelectElement>('fixture');
const sliceSel = $<HTMLSelectElement>('slice');
const diffSel = $<HTMLSelectElement>('difficulty');
const seedIn = $<HTMLInputElement>('seed');
const zoomSel = $<HTMLSelectElement>('zoom');
const status = $<HTMLDivElement>('status');

const layers: LayerToggles = { ...DEFAULT_LAYERS };
if (q.has('layers')) {
  for (const k of Object.keys(layers) as (keyof LayerToggles)[]) layers[k] = false;
  for (const k of (q.get('layers') ?? '').split(',')) if (k in layers) layers[k as keyof LayerToggles] = true;
}
const params: Record<string, number> = {};

let capture: CaptureBundle | null = null;
let bitmap: ImageBitmap | null = null;
let sliceImage: ImageBitmap | null = null;
let current: { stage: StageData; debug: DebugLayersEx | null } | null = null;
let refStats: StageStats | null = null;
let hoverId: number | null = null;

function setStatus(text: string, err = false) {
  status.textContent = text;
  status.className = err ? 'err' : '';
}

async function init() {
  const res = (await (await fetch('/api/fixtures')).json()) as {
    fixtures: FixtureInfo[];
    reference: boolean;
  };
  for (const f of res.fixtures)
    fixtureSel.add(new Option(`${f.slug} (${f.slices} slice${f.slices > 1 ? 's' : ''})`, f.slug));
  if (res.reference) {
    fixtureSel.add(new Option('2013 reference: AID-DCC (not committed)', 'reference'));
    const ref = parseStage(await (await fetch('/files/reference/aid-dcc.stage.json')).json());
    refStats = stageStats(ref);
  }
  fixtureSel.value =
    q.get('fixture') ?? res.fixtures.find((f) => f.slug === 'hn-front')?.slug ?? res.fixtures[0]?.slug ?? '';
  seedIn.value = q.get('seed') ?? '1';
  diffSel.value = q.get('difficulty') ?? 'normal';
  const zoom = q.get('zoom') ?? (shot ? '1' : '0.75');
  if (![...zoomSel.options].some((o) => o.value === zoom)) zoomSel.add(new Option(zoom, zoom));
  zoomSel.value = zoom;
  buildLayerToggles();
  buildParamSliders();
  fixtureSel.onchange = () => loadSource(0);
  sliceSel.onchange = () => sliceChanged();
  diffSel.onchange = seedIn.onchange = () => rebuild();
  zoomSel.onchange = () => draw();
  $('reroll').onclick = () => {
    seedIn.value = String(Number(seedIn.value) + 1);
    rebuild();
  };
  $('reset').onclick = () => {
    for (const k of Object.keys(params)) delete params[k];
    buildParamSliders();
    rebuild();
  };
  canvas.onmousemove = (ev) => {
    if (!current) return;
    const z = Number(zoomSel.value);
    const id = islandAt(current.stage, [ev.offsetX / z, ev.offsetY / z]);
    if (id !== hoverId) {
      hoverId = id;
      showHover();
      draw();
    }
  };
  await loadSource(Number(q.get('slice') ?? 0));
}

function buildLayerToggles() {
  const box = $('layers');
  box.innerHTML = '';
  for (const [key, label] of LAYER_LABELS) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = layers[key];
    cb.onchange = () => {
      layers[key] = cb.checked;
      draw();
    };
    l.append(cb, label);
    box.append(l);
  }
}

function buildParamSliders() {
  const box = $('params');
  box.innerHTML = '';
  for (const [key, def] of Object.entries(DEFAULT_PARAMS)) {
    if (typeof def !== 'number') continue;
    const row = document.createElement('div');
    row.className = 'param';
    const name = document.createElement('span');
    name.textContent = key;
    const range = document.createElement('input');
    range.type = 'range';
    const isShare = def > 0 && def <= 1 && !/Px|Cells|cell/.test(key);
    range.min = '0';
    range.max = String(isShare ? 1 : Math.max(1, def * 3));
    range.step = String(isShare ? 0.01 : def >= 20 ? Math.round(def / 20) : def >= 3 ? 0.5 : 0.01);
    range.value = String(params[key] ?? def);
    const val = document.createElement('span');
    val.textContent = Number(range.value).toFixed(2);
    range.oninput = () => (val.textContent = Number(range.value).toFixed(2));
    range.onchange = () => {
      params[key] = Number(range.value);
      rebuild();
    };
    row.append(name, range, val);
    box.append(row);
  }
}

async function loadImage(url: string): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob);
}

async function loadSource(slice: number) {
  const slug = fixtureSel.value;
  current = null;
  setStatus(`loading ${slug}…`);
  if (slug === 'reference') {
    const stage = parseStage(await (await fetch('/files/reference/aid-dcc.stage.json')).json());
    bitmap = await loadImage(`/files/reference/${stage.texture.path}`);
    sliceImage = bitmap;
    capture = null;
    sliceSel.innerHTML = '';
    sliceSel.add(new Option('0', '0'));
    current = { stage, debug: null };
    setStatus('2013 reference stage (converted WWMMM data; reference only, never committed)');
    draw();
    showStats();
    return;
  }
  capture = parseCapture(await (await fetch(`/files/fixtures/captures/${slug}/capture.json`)).json());
  bitmap = await loadImage(`/files/fixtures/captures/${slug}/${capture.screenshot.path}`);
  const off = new OffscreenCanvas(bitmap.width, bitmap.height);
  const octx = off.getContext('2d') as OffscreenCanvasRenderingContext2D;
  octx.drawImage(bitmap, 0, 0);
  const data = octx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  await new Promise<void>((resolve) => {
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      if (ev.data.type === 'loaded') resolve();
    };
    send(
      {
        type: 'load',
        capture: capture as CaptureBundle,
        width: bitmap?.width ?? 0,
        height: bitmap?.height ?? 0,
        data: data.buffer,
      },
      [data.buffer],
    );
  });
  sliceSel.innerHTML = '';
  for (let i = 0; i < sliceCount(capture); i++) sliceSel.add(new Option(String(i), String(i)));
  sliceSel.value = String(Math.min(slice, sliceCount(capture) - 1));
  await sliceChanged();
}

async function sliceChanged() {
  if (!capture || !bitmap) return;
  const s = sliceRange(capture, Number(sliceSel.value));
  const sc = capture.screenshot.scale;
  sliceImage = await createImageBitmap(
    bitmap,
    0,
    Math.round(s.y * sc),
    Math.round(capture.page.width * sc),
    Math.round(s.height * sc),
  );
  rebuild();
}

function rebuild() {
  if (!capture) return;
  document.body.dataset.ready = '0';
  setStatus('building…');
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const m = ev.data;
    if (m.type === 'result') {
      current = { stage: m.stage, debug: m.debug };
      const errs = m.debug.validationErrors;
      setStatus(
        `built in ${m.ms.toFixed(0)} ms · ${m.stage.islands.length} islands · ${m.stage.bridges.length} bridges · ${m.stage.elevators.length} elevators · ${m.stage.items.length} items` +
          (m.debug.attempt ? `\nrerolled ${m.debug.attempt}× (seed ${m.debug.effectiveSeed})` : '') +
          (errs.length ? `\nINVALID:\n${errs.slice(0, 8).join('\n')}` : '\nvalidateStage: ok'),
        errs.length > 0,
      );
      draw();
      showStats();
    } else if (m.type === 'error') setStatus(m.message, true);
  };
  send({
    type: 'build',
    sliceIndex: Number(sliceSel.value),
    seed: Number(seedIn.value),
    difficulty: diffSel.value,
    params,
  });
}

function draw() {
  if (!current) return;
  const z = Number(zoomSel.value);
  const { width, height } = current.stage.size;
  canvas.width = Math.round(width * z);
  canvas.height = Math.round(height * z);
  ctx.setTransform(z, 0, 0, z, 0, 0);
  drawStage(ctx, current.stage, { image: sliceImage, debug: current.debug, layers, highlight: hoverId });
  document.body.dataset.ready = '1';
}

function showHover() {
  const box = $('hover');
  if (!current || hoverId === null) {
    box.textContent = 'Hover an island to see its source elements.';
    return;
  }
  const isl = current.stage.islands.find((i) => i.id === hoverId);
  if (!isl) return;
  const els = new Map((capture?.elements ?? []).map((e) => [e.id, e]));
  const lines = [
    `island ${isl.id} · level ${isl.level.toFixed(2)} D · ${isl.contour.length} vertices · ${isl.restartPoints.length} restart points`,
  ];
  for (const id of isl.sourceElementIds.slice(0, 30)) {
    const e = els.get(id);
    lines.push(`  #${id} ${e?.kind ?? '?'} ${e?.text ? `“${e.text.slice(0, 60)}”` : ''}`);
  }
  if (isl.sourceElementIds.length > 30) lines.push(`  … ${isl.sourceElementIds.length - 30} more`);
  box.textContent = lines.join('\n');
}

function showStats() {
  if (!current) return;
  const mine = stageStats(current.stage);
  const cols = refStats ? [mine, refStats] : [mine];
  const t = $<HTMLTableElement>('stats');
  t.innerHTML = `<tr><th>metric</th><th>this</th>${refStats ? '<th>2013</th>' : ''}</tr>`;
  for (const [name, ...vals] of statsRows(cols)) {
    const tr = t.insertRow();
    tr.insertCell().textContent = name;
    for (const v of vals) tr.insertCell().textContent = v;
  }
  const tt = $<HTMLTableElement>('timings');
  tt.innerHTML = '';
  for (const [k, v] of Object.entries(current.debug?.timingsMs ?? {})) {
    const tr = tt.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = v.toFixed(1);
  }
  $('notes').textContent = current.stage.provenance.notes.join('\n');
}

init().catch((e) => setStatus(String(e), true));
