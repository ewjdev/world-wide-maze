/**
 * The slice of the WebExtensions API this extension uses, typed here instead of pulling in @types/chrome.
 * `extensionApi()` returns `browser` (Firefox) or `chrome` (Chromium); both are promise-based in MV3.
 */

export interface Tab {
  id?: number;
  windowId: number;
  url?: string;
  title?: string;
  status?: string;
  active?: boolean;
}

export interface InjectionResult<T> {
  result?: T;
  frameId?: number;
}

export interface Port {
  name: string;
  postMessage(m: unknown): void;
  onMessage: { addListener(fn: (m: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
  disconnect(): void;
}

export interface ChromeApi {
  runtime: {
    id: string;
    lastError?: { message?: string };
    connect(info: { name: string }): Port;
    onConnect: { addListener(fn: (p: Port) => void): void };
    getManifest(): { version: string; host_permissions?: string[] };
  };
  tabs: {
    query(q: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    get(tabId: number): Promise<Tab>;
    create(p: { url: string; active?: boolean; openerTabId?: number; index?: number }): Promise<Tab>;
    captureVisibleTab(windowId: number, opts: { format: 'png' | 'jpeg'; quality?: number }): Promise<string>;
    onUpdated: {
      addListener(fn: (tabId: number, info: { status?: string }, tab: Tab) => void): void;
      removeListener(fn: (tabId: number, info: { status?: string }, tab: Tab) => void): void;
    };
  };
  scripting: {
    executeScript<A extends unknown[], R>(inj: {
      target: { tabId: number };
      func: (...args: A) => R;
      args?: A;
      world?: 'ISOLATED' | 'MAIN';
    }): Promise<InjectionResult<Awaited<R>>[]>;
  };
  permissions: {
    contains(p: { origins: string[] }): Promise<boolean>;
    request(p: { origins: string[] }): Promise<boolean>;
  };
  action: {
    setBadgeText(d: { text: string }): Promise<void>;
    setBadgeBackgroundColor(d: { color: string }): Promise<void>;
  };
}

export function extensionApi(): ChromeApi {
  const g = globalThis as unknown as { browser?: ChromeApi; chrome?: ChromeApi };
  const api = g.browser ?? g.chrome;
  if (!api) throw new Error('not running as a browser extension');
  return api;
}
