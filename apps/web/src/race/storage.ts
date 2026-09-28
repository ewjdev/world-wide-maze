import {
  betterAttempt,
  compatibilityKey,
  compatible,
  isEligible,
  type RaceAttempt,
  type RaceCompatibility,
  validateAttempt,
} from '@wwm/race';

const DB_NAME = 'wwm-race-history';
const HISTORY_BYTES = 50 * 1024 * 1024;
const RECENT_COUNT = 10;
export interface RaceHistoryResult {
  recent: RaceAttempt[];
  best: RaceAttempt | null;
  persistent: boolean;
  error?: string;
}
export interface RaceSaveResult {
  persistent: boolean;
  error?: string;
}
function bytes(attempt: RaceAttempt): number {
  return (
    attempt.recording.data.byteLength +
    JSON.stringify({ ...attempt, recording: { ...attempt.recording, data: undefined } }).length * 2
  );
}
/** Exposed for deterministic eviction tests. Protected bests are never silently discarded. */
export function selectHistory(
  attempts: RaceAttempt[],
  limit = HISTORY_BYTES,
  existingBestIds = new Set<string>(),
): RaceAttempt[] {
  const groups = new Map<string, RaceAttempt[]>();
  for (const attempt of attempts) {
    const key = compatibilityKey(attempt.compatibility);
    const group = groups.get(key) ?? [];
    group.push(attempt);
    groups.set(key, group);
  }
  const keep = new Map<string, RaceAttempt>();
  const protectedIds = new Set<string>();
  for (const group of groups.values()) {
    const chronological = [...group].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    let best: RaceAttempt | null = group.find((a) => existingBestIds.has(a.id) && isEligible(a)) ?? null;
    for (const attempt of chronological) if (betterAttempt(attempt, best)) best = attempt;
    if (best) {
      keep.set(best.id, best);
      protectedIds.add(best.id);
    }
    for (const attempt of chronological.slice(-RECENT_COUNT)) keep.set(attempt.id, attempt);
  }
  let total = [...keep.values()].reduce((sum, a) => sum + bytes(a), 0);
  for (const attempt of [...keep.values()].sort((a, b) => a.createdAt - b.createdAt)) {
    if (total <= limit) break;
    if (!protectedIds.has(attempt.id)) {
      keep.delete(attempt.id);
      total -= bytes(attempt);
    }
  }
  if (total > limit)
    throw new Error('Protected Race records fill history storage. Clear history to save more.');
  return [...keep.values()];
}
function summarize(
  attempts: RaceAttempt[],
  compatibility: RaceCompatibility,
  persistent: boolean,
  error?: string,
  bestId?: string,
): RaceHistoryResult {
  const matching = attempts.filter((a) => compatible(a.compatibility, compatibility));
  let best: RaceAttempt | null = matching.find((a) => a.id === bestId && isEligible(a)) ?? null;
  for (const a of [...matching].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
    if (betterAttempt(a, best)) best = a;
  return {
    recent: matching.sort((a, b) => b.createdAt - a.createdAt).slice(0, RECENT_COUNT),
    best,
    persistent,
    ...(error ? { error } : {}),
  };
}
/** Host-only, versioned local history. One readwrite transaction serializes best/recent updates across tabs. */
export class RaceHistory {
  private database: Promise<IDBDatabase> | null = null;
  private session = new Map<string, RaceAttempt>();
  private failure: string | undefined;
  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('Browser history is unavailable; this run is session-only.'));
          return;
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('attempts', { keyPath: 'id' });
          db.createObjectStore('bests');
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.database = null;
          };
          resolve(db);
        };
        request.onerror = () => reject(request.error ?? new Error('Cannot open Race history'));
        request.onblocked = () => reject(new Error('Race history upgrade blocked by another tab'));
      });
    }
    return this.database;
  }
  async list(compatibility: RaceCompatibility): Promise<RaceHistoryResult> {
    try {
      const db = await this.open();
      let savedBestId: string | undefined;
      const attempts = await new Promise<RaceAttempt[]>((resolve, reject) => {
        const tx = db.transaction(['attempts', 'bests'], 'readonly');
        const bestRequest = tx.objectStore('bests').get(compatibilityKey(compatibility));
        bestRequest.onsuccess = () => {
          savedBestId = bestRequest.result;
        };
        const results: RaceAttempt[] = [];
        const cursor = tx.objectStore('attempts').openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (row) {
            if (validateAttempt(row.value) && compatible(row.value.compatibility, compatibility))
              results.push(row.value);
            row.continue();
          }
        };
        tx.oncomplete = () => resolve(results);
        tx.onerror = () => reject(tx.error);
      });
      const merged = new Map(attempts.map((a) => [a.id, a]));
      for (const a of this.session.values()) merged.set(a.id, a);
      return summarize(
        [...merged.values()],
        compatibility,
        !this.failure && ![...this.session.values()].some((a) => compatible(a.compatibility, compatibility)),
        this.failure,
        savedBestId,
      );
    } catch (error) {
      this.failure = error instanceof Error ? error.message : 'Race history unavailable';
      return summarize([...this.session.values()], compatibility, false, this.failure);
    }
  }
  async save(attempt: RaceAttempt): Promise<RaceSaveResult> {
    if (!validateAttempt(attempt)) return { persistent: false, error: 'Invalid Race attempt was not saved' };
    // Keep the live result even if opening IndexedDB, quota, or a transaction fails.
    this.session.set(attempt.id, structuredClone(attempt));
    try {
      let bounded: RaceAttempt[];
      try {
        bounded = selectHistory([...this.session.values()]);
      } catch (error) {
        // The caller still owns the live result. Do not grow the fallback cache beyond its budget.
        this.session.delete(attempt.id);
        throw error;
      }
      this.session = new Map(bounded.map((a) => [a.id, a]));
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['attempts', 'bests'], 'readwrite');
        const store = tx.objectStore('attempts');
        const existingBestRequest = tx.objectStore('bests').getAll();
        const request = store.getAll();
        let failure: unknown;
        request.onsuccess = () => {
          try {
            const existing = request.result.filter(validateAttempt);
            // IDs are immutable. A completed save can finish while the next retry runs.
            if (existing.some((a) => a.id === attempt.id)) return;
            const existingBestIds = new Set<string>(existingBestRequest.result);
            const retained = selectHistory([...existing, attempt], HISTORY_BYTES, existingBestIds);
            if (!retained.some((a) => a.id === attempt.id))
              throw new Error('Race history budget reached; this run is session-only.');
            const ids = new Set(retained.map((a) => a.id));
            for (const a of request.result)
              if (typeof a?.id === 'string' && !ids.has(a.id)) store.delete(a.id);
            store.put(attempt);
            const bests = tx.objectStore('bests');
            bests.clear();
            const byKey = new Map<string, RaceAttempt>(
              retained
                .filter((a) => existingBestIds.has(a.id) && isEligible(a))
                .map((a) => [compatibilityKey(a.compatibility), a]),
            );
            for (const a of [...retained].sort(
              (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
            )) {
              const key = compatibilityKey(a.compatibility);
              if (isEligible(a) && betterAttempt(a, byKey.get(key) ?? null)) byKey.set(key, a);
            }
            for (const [key, best] of byKey) bests.put(best.id, key);
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('Race history save interrupted'));
        tx.onerror = () => {
          /* abort handles request and quota failures */
        };
      });
      this.session.delete(attempt.id);
      this.failure = undefined;
      return { persistent: true };
    } catch (error) {
      this.failure =
        error instanceof Error ? error.message : 'Race history save failed; this run is session-only.';
      return { persistent: false, error: this.failure };
    }
  }
  async clear(courseId?: string): Promise<void> {
    for (const [id, attempt] of this.session)
      if (!courseId || attempt.compatibility.courseId === courseId) this.session.delete(id);
    try {
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['attempts', 'bests'], 'readwrite');
        const request = tx.objectStore('attempts').openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            if (!courseId || cursor.value?.compatibility?.courseId === courseId) cursor.delete();
            cursor.continue();
          }
        };
        const bests = tx.objectStore('bests').openCursor();
        bests.onsuccess = () => {
          const cursor = bests.result;
          if (cursor) {
            let matches = !courseId;
            try {
              matches ||= JSON.parse(String(cursor.key))[0] === courseId;
            } catch {
              matches = true;
            }
            if (matches) cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      this.failure = undefined;
    } catch (error) {
      this.failure = error instanceof Error ? error.message : 'Could not clear stored history';
      throw error;
    }
  }
}
