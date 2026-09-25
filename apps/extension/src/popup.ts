/**
 * The toolbar popup. Opening it IS the click: it starts the capture of the active tab right away (the popup
 * opening is what grants `activeTab`), then shows each step until the game tab takes focus. Errors stay here.
 *
 * `?tab=<id>` targets another tab. Only the e2e test and the screenshot script use it, because a popup opened
 * as a page is its own active tab.
 */
import { extensionApi, type Tab } from './chrome.ts';
import { DEFAULT_ORIGIN, ORIGIN_KEY, originPattern, parseOrigin } from './config.ts';
import type { JobState } from './job.ts';
import { popupStrings } from './strings.ts';
import { capturable } from './url.ts';

const api = extensionApi();
const s = popupStrings();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.querySelector('.pop') as HTMLElement;

type StepKey = keyof typeof s.steps;
const ORDER: StepKey[] = ['prepare', 'extract', 'frames', 'encode', 'opening', 'handing'];

document.documentElement.lang = navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-s]'))) {
  const v = (s as unknown as Record<string, unknown>)[el.dataset.s as string];
  if (typeof v === 'string') el.textContent = v;
}

function origin(): string {
  return parseOrigin(localStorage.getItem(ORIGIN_KEY) ?? '') ?? DEFAULT_ORIGIN;
}

function renderSteps(active: StepKey | null, done: boolean, frame?: { k: number; n: number }) {
  const list = $('steps');
  list.replaceChildren();
  const at = active ? ORDER.indexOf(active) : done ? ORDER.length : -1;
  for (const [i, key] of ORDER.entries()) {
    const li = document.createElement('li');
    li.className = `step ${i < at ? 'is-done' : i === at ? 'is-now' : ''}`;
    const label = document.createElement('span');
    label.className = 'step__label';
    label.textContent = s.steps[key];
    li.append(document.createElement('i'), label);
    if (key === 'frames' && frame && i === at) {
      const c = document.createElement('span');
      c.className = 'step__count';
      c.textContent = s.frameOf(frame.k, frame.n);
      li.append(c);
    }
    list.append(li);
  }
  const frac =
    at < 0 ? 0 : Math.min(1, (at + (frame && active === 'frames' ? frame.k / frame.n : 0.3)) / ORDER.length);
  $('bar').style.transform = `scaleX(${done ? 1 : frac})`;
}

function notice(kind: 'error' | 'restricted' | null, title = '', body = '') {
  const n = $('notice');
  n.hidden = kind === null;
  n.dataset.kind = kind ?? '';
  $('notice-title').textContent = title;
  $('notice-body').textContent = body;
  $('retry').hidden = kind !== 'error';
}

function render(st: JobState) {
  root.dataset.state = st.phase;
  switch (st.phase) {
    case 'idle':
      renderSteps(null, false);
      notice(null);
      break;
    case 'capturing': {
      const p = st.progress;
      renderSteps(p.step, false, p.frame !== undefined && p.frames ? { k: p.frame, n: p.frames } : undefined);
      notice(null);
      break;
    }
    case 'opening':
    case 'handing':
      renderSteps(st.phase, false);
      notice(null);
      break;
    case 'done':
      renderSteps(null, true);
      $('host').textContent = s.done;
      notice(null);
      break;
    case 'error':
      notice('error', s.errorTitle, `${s.errors[st.code] ?? ''} ${st.message}`.trim());
      break;
  }
}

async function targetTab(): Promise<Tab | undefined> {
  const q = new URLSearchParams(location.search).get('tab');
  if (q) return api.tabs.get(Number(q));
  const [t] = await api.tabs.query({ active: true, currentWindow: true });
  return t;
}

let port: ReturnType<typeof api.runtime.connect> | null = null;
function connect() {
  port = api.runtime.connect({ name: 'wwm-popup' });
  port.onMessage.addListener((m) => {
    const msg = m as { type?: string; state?: JobState };
    if (msg.type === 'state' && msg.state) render(msg.state);
  });
}

async function start() {
  const tab = await targetTab();
  let host = '';
  try {
    host = tab?.url ? new URL(tab.url).host : '';
  } catch {
    // no URL
  }
  $('host').textContent = host || tab?.title || '';
  if (!tab?.id || !capturable(tab.url)) {
    root.dataset.state = 'restricted';
    renderSteps(null, false);
    notice('restricted', s.restrictedTitle, s.restricted);
    return;
  }
  if (!port) connect();
  port?.postMessage({ type: 'start', tabId: tab.id, origin: origin() });
}

$('retry').addEventListener('click', () => void start());

// settings: the game address
const input = $<HTMLInputElement>('origin');
input.value = origin();
input.placeholder = DEFAULT_ORIGIN;
input.setAttribute('aria-label', s.settings);
$('origin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('origin-msg');
  const o = parseOrigin(input.value);
  if (!o) {
    msg.textContent = s.badOrigin;
    return;
  }
  // Ask for access to that one origin (an optional host permission, requested from this click).
  const ok = await api.permissions.request({ origins: [originPattern(o)] }).catch(() => false);
  if (!ok) {
    msg.textContent = s.denied;
    return;
  }
  localStorage.setItem(ORIGIN_KEY, o);
  input.value = o;
  msg.textContent = s.saved;
});

renderSteps(null, false);
void start();
