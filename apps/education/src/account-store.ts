/**
 * Where the account code finds this device's `ProgressStore` (Phase 31 M2's IndexedDB store) and keeps a paired
 * device's bearer token.
 *
 * The store is supplied with `provideProgressStore()`; `account-sync.ts` registers M2's `openProgress()`. Where
 * that store can't open, nothing is uploaded and the device token falls back to `localStorage` (moved into the
 * store the first time one opens).
 */
import type { ProgressStore } from '@wwm/learning';

const TOKEN_KEY = 'wwm-learning.device-token';
let provider: (() => Promise<ProgressStore | null>) | null = null;
let opened: Promise<ProgressStore | null> | null = null;

export function provideProgressStore(open: () => Promise<ProgressStore | null>): void {
  provider = open;
  opened = null;
}

/** This device's store, or null (no provider, no IndexedDB, a private window that refuses it). */
export function progressStore(): Promise<ProgressStore | null> {
  opened ??= (async () => {
    if (!provider) return null;
    try {
      const store = await provider();
      if (store) {
        const legacy = localToken();
        if (legacy && !(await store.deviceToken())) await store.setDeviceToken(legacy);
        if (legacy) setLocalToken(null);
      }
      return store;
    } catch {
      return null;
    }
  })();
  return opened;
}

function localToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function setLocalToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage refused: the device simply stays unlinked
  }
}

export async function readDeviceToken(): Promise<string | null> {
  const store = await progressStore();
  return store ? store.deviceToken() : localToken();
}

export async function writeDeviceToken(token: string | null): Promise<void> {
  const store = await progressStore();
  if (store) await store.setDeviceToken(token);
  else setLocalToken(token);
}
