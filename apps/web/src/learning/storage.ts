import type { BridgeState } from '@wwm/learning';

const DATABASE = 'wwm-learning-poc';
const STORE = 'sessions';

export interface BridgeSnapshot {
  schemaVersion: 1;
  pathId: string;
  activityId: string;
  contentHash: string;
  bindingHash: string;
  stageHash: string;
  levelId: string;
  interfaceLocale: string;
  targetLocale: string;
  seed: number;
  state: BridgeState;
}

export class ProgressConflict extends Error {
  constructor() {
    super('Progress changed in another tab. Reload before continuing.');
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: ['pathId', 'activityId'] });
    };
    request.onerror = () => reject(request.error ?? new Error('Progress storage unavailable.'));
    request.onsuccess = () => resolve(request.result);
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Progress write was interrupted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Progress write failed.'));
  });
}

/** Validate identity before restoring; stale content is preserved for explicit restart or reselect. */
export function validateBridgeSnapshot(
  snapshot: unknown,
  expected: Pick<BridgeSnapshot, 'pathId' | 'activityId' | 'contentHash' | 'bindingHash' | 'stageHash'>,
): BridgeSnapshot {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Saved progress is corrupt.');
  const value = snapshot as Partial<BridgeSnapshot>;
  if (value.schemaVersion !== 1 || !value.state || typeof value.state.revision !== 'number')
    throw new Error('Saved progress has an unsupported version or is corrupt.');
  for (const key of ['pathId', 'activityId', 'contentHash', 'bindingHash', 'stageHash'] as const)
    if (value[key] !== expected[key])
      throw new Error(`Saved progress has a different ${key}; reselect matching content or restart.`);
  const state = value.state;
  if (
    !Number.isInteger(state.revision) ||
    !Number.isInteger(state.nextSequence) ||
    !Array.isArray(state.acceptedEventIds) ||
    state.acceptedEventIds.length > 4096 ||
    !Array.isArray(state.consumedPickupIds) ||
    !Array.isArray(state.completedEncounterIds)
  )
    throw new Error('Saved progress is corrupt.');
  return value as BridgeSnapshot;
}

export async function readBridgeProgress(pathId: string, activityId: string): Promise<unknown | undefined> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get([pathId, activityId]);
    const done = complete(transaction);
    await done;
    return request.result;
  } finally {
    db.close();
  }
}

/** Compare and put in one transaction. Caller must pause input until this resolves, then project the state. */
export async function commitBridgeProgress(
  next: BridgeSnapshot,
  expectedRevision: number | null,
): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get([next.pathId, next.activityId]);
    let conflict = false;
    request.onsuccess = () => {
      const prior = request.result as BridgeSnapshot | undefined;
      if ((prior?.state.revision ?? null) !== expectedRevision) {
        conflict = true;
        transaction.abort();
        return;
      }
      store.put(next);
    };
    try {
      await complete(transaction);
    } catch (error) {
      if (conflict) throw new ProgressConflict();
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function deleteBridgeProgress(pathId: string, activityId?: string): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    if (activityId) store.delete([pathId, activityId]);
    else {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        if (cursor.result.value.pathId === pathId) cursor.result.delete();
        cursor.result.continue();
      };
    }
    await complete(transaction);
  } finally {
    db.close();
  }
}
