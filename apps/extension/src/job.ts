/**
 * One "Maze this page" job: capture the tab, open the game at `/play/local`, hand the capture over, and report
 * every step. Runs in the service worker; the popup only watches (it closes when the game tab takes focus).
 */
import {
  type CaptureDeps,
  CaptureError,
  type CaptureOutput,
  type CaptureProgress,
  captureTab,
} from './capture.ts';
import type { ChromeApi, Tab } from './chrome.ts';
import { originPattern, receiverUrl } from './config.ts';
import { pageDeliver } from './page-fns.ts';

export type JobState =
  | { phase: 'idle' }
  | { phase: 'capturing'; progress: CaptureProgress }
  | { phase: 'opening' }
  | { phase: 'handing' }
  | { phase: 'done'; title: string; frames: number; bytes: number }
  | { phase: 'error'; code: JobErrorCode; message: string };

export type JobErrorCode = CaptureError['code'] | 'permission' | 'open' | 'handoff' | 'busy';

export interface StartRequest {
  tabId: number;
  origin: string;
}

/** Base64 of an ArrayBuffer (chunked: `String.fromCharCode(...big)` overflows the stack). */
export function toBase64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function waitComplete(api: Pick<ChromeApi, 'tabs'>, tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      api.tabs.onUpdated.removeListener(on);
      reject(new Error('the game page took too long to load'));
    }, timeoutMs);
    const on = (id: number, info: { status?: string }) => {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      api.tabs.onUpdated.removeListener(on);
      resolve();
    };
    api.tabs.onUpdated.addListener(on);
    // it may already be complete
    void api.tabs.get(tabId).then(
      (t) => {
        if (t.status === 'complete') on(tabId, { status: 'complete' });
      },
      () => {},
    );
  });
}

export class JobRunner {
  #state: JobState = { phase: 'idle' };
  #listeners = new Set<(s: JobState) => void>();

  constructor(
    private readonly api: Pick<ChromeApi, 'tabs' | 'scripting' | 'permissions' | 'action'>,
    private readonly deps: (api: CaptureDeps['api']) => CaptureDeps,
  ) {}

  get state(): JobState {
    return this.#state;
  }

  subscribe(fn: (s: JobState) => void): () => void {
    this.#listeners.add(fn);
    fn(this.#state);
    return () => this.#listeners.delete(fn);
  }

  #set(s: JobState): void {
    this.#state = s;
    for (const fn of this.#listeners) fn(s);
    const badge = s.phase === 'error' ? '!' : s.phase === 'idle' || s.phase === 'done' ? '' : '…';
    void this.api.action.setBadgeText({ text: badge }).catch(() => {});
    if (s.phase === 'error')
      void this.api.action.setBadgeBackgroundColor({ color: '#c23b38' }).catch(() => {});
  }

  get busy(): boolean {
    const p = this.#state.phase;
    return p === 'capturing' || p === 'opening' || p === 'handing';
  }

  async start(req: StartRequest): Promise<JobState> {
    if (this.busy) return this.#state;
    let tab: Tab;
    let out: CaptureOutput;
    try {
      tab = await this.api.tabs.get(req.tabId);
      // Check before capturing, so the player isn't made to wait for a handoff that can't happen.
      if (!(await this.api.permissions.contains({ origins: [originPattern(req.origin)] }))) {
        this.#set({
          phase: 'error',
          code: 'permission',
          message: `The extension isn’t allowed to reach ${req.origin}. Set the game address again in Settings.`,
        });
        return this.#state;
      }
      this.#set({ phase: 'capturing', progress: { step: 'prepare' } });
      out = await captureTab(this.deps(this.api), tab, (progress) =>
        this.#set({ phase: 'capturing', progress }),
      );
    } catch (e) {
      const code = e instanceof CaptureError ? e.code : 'script';
      this.#set({ phase: 'error', code, message: e instanceof Error ? e.message : String(e) });
      return this.#state;
    }

    this.#set({ phase: 'opening' });
    let gameTab: Tab;
    try {
      gameTab = await this.api.tabs.create({
        url: receiverUrl(req.origin),
        active: true,
        openerTabId: req.tabId,
      });
      if (gameTab.id === undefined) throw new Error('no tab id');
      await waitComplete(this.api, gameTab.id, 30_000);
    } catch (e) {
      this.#set({
        phase: 'error',
        code: 'open',
        message: `Couldn’t open the game (${(e as Error).message}).`,
      });
      return this.#state;
    }

    this.#set({ phase: 'handing' });
    try {
      const [res] = await this.api.scripting.executeScript({
        target: { tabId: gameTab.id },
        func: pageDeliver,
        args: [
          {
            origin: req.origin,
            bundle: out.bundle,
            mime: out.image.mime,
            imageBase64: toBase64(out.image.bytes),
            timeoutMs: 30_000,
          },
        ],
      });
      const r = res?.result;
      if (!r?.ok) throw new Error(r?.reason ?? 'no answer');
    } catch (e) {
      this.#set({
        phase: 'error',
        code: 'handoff',
        message: `The game didn’t accept the page (${(e as Error).message}).`,
      });
      return this.#state;
    }
    this.#set({
      phase: 'done',
      title: out.bundle.title,
      frames: out.frames,
      bytes: out.image.bytes.byteLength,
    });
    return this.#state;
  }
}
