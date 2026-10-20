/**
 * The device's progress store (Phase 31 M2): `ProgressStore` over same-origin IndexedDB. Works with no account;
 * the outbox is what a later sync (M3) sends. Every method is one transaction, so an event and its outbox entry
 * are written together or not at all, and deleting a profile takes its events and outbox entries with it.
 *
 * Stores (version 1):
 * - `profiles`: `Profile`, key `id`.
 * - `events`: `LearningEvidence`, key `id`, index `profile`.
 * - `outbox`: events not yet accepted by a server, key `id` (UUIDv7, so key order is oldest first), index `profile`.
 * - `meta`: `activeProfile` and `deviceToken`, out-of-line keys.
 */
import { evidenceSchema, type LearningEvidence } from './evidence.ts';
import { type Profile, type ProgressStore, profileSchema } from './sync.ts';

const VERSION = 1;
const PROFILES = 'profiles';
const EVENTS = 'events';
const OUTBOX = 'outbox';
const META = 'meta';
const ALL = [PROFILES, EVENTS, OUTBOX, META];
const ACTIVE = 'activeProfile';
const TOKEN = 'deviceToken';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Every key the index holds for `profile` (events or outbox entries of one child). */
function keysFor(store: IDBObjectStore, profile: string): Promise<IDBValidKey[]> {
  return request(store.index('profile').getAllKeys(IDBKeyRange.only(profile)));
}

/**
 * Open (or create) the store. Nothing is opened until the first call; when IndexedDB is unavailable (some private
 * browsing modes, storage turned off) every method rejects, and the caller carries on without saving.
 */
export function createBrowserStore(name = 'wwm-learning-progress'): ProgressStore {
  let opening: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const factory = globalThis.indexedDB;
      if (!factory) {
        reject(new Error('IndexedDB is unavailable.'));
        return;
      }
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(name, VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(PROFILES, { keyPath: 'id' });
        db.createObjectStore(EVENTS, { keyPath: 'id' }).createIndex('profile', 'profile');
        db.createObjectStore(OUTBOX, { keyPath: 'id' }).createIndex('profile', 'profile');
        db.createObjectStore(META);
      };
      req.onsuccess = () => {
        const db = req.result;
        // another tab upgrading or deleting the database: let it, and reopen on the next call
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('The progress store is open in an older tab.'));
    });
    // a failed open is retried on the next call rather than remembered
    opening.catch(() => {
      opening = null;
    });
    return opening;
  }

  /** Run `work` in one transaction; resolves with its result once the transaction has committed. */
  async function transact<T>(
    stores: string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await open();
    const tx = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted.'));
    });
    try {
      const result = await work(tx);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // already finished
      }
      done.catch(() => {});
      throw error;
    }
  }

  return {
    listProfiles: () =>
      transact([PROFILES], 'readonly', (tx) =>
        request(tx.objectStore(PROFILES).getAll() as IDBRequest<Profile[]>),
      ),

    saveProfile: async (profile) => {
      const valid = profileSchema.parse(profile);
      return transact([PROFILES], 'readwrite', async (tx) => {
        await request(tx.objectStore(PROFILES).put(valid));
      });
    },

    deleteProfile: (id) =>
      transact(ALL, 'readwrite', async (tx) => {
        const events = tx.objectStore(EVENTS);
        const outbox = tx.objectStore(OUTBOX);
        const meta = tx.objectStore(META);
        const [eventKeys, outboxKeys, active] = await Promise.all([
          keysFor(events, id),
          keysFor(outbox, id),
          request(meta.get(ACTIVE)),
        ]);
        await Promise.all([
          request(tx.objectStore(PROFILES).delete(id)),
          ...eventKeys.map((key) => request(events.delete(key))),
          ...outboxKeys.map((key) => request(outbox.delete(key))),
          ...(active === id ? [request(meta.delete(ACTIVE))] : []),
        ]);
      }),

    activeProfile: () =>
      transact([META], 'readonly', async (tx) => {
        const value = await request(tx.objectStore(META).get(ACTIVE));
        return typeof value === 'string' ? value : null;
      }),

    setActiveProfile: (id) =>
      transact([META], 'readwrite', async (tx) => {
        const meta = tx.objectStore(META);
        if (id === null) await request(meta.delete(ACTIVE));
        else await request(meta.put(id, ACTIVE));
      }),

    appendEvidence: async (event) => {
      const valid = evidenceSchema.parse(event);
      return transact([EVENTS, OUTBOX], 'readwrite', async (tx) => {
        const events = tx.objectStore(EVENTS);
        // already recorded (and perhaps already synced): leave both stores as they are
        if ((await request(events.getKey(valid.id))) !== undefined) return;
        await Promise.all([request(events.add(valid)), request(tx.objectStore(OUTBOX).add(valid))]);
      });
    },

    events: (profile) =>
      transact([EVENTS], 'readonly', (tx) =>
        request(
          tx.objectStore(EVENTS).index('profile').getAll(IDBKeyRange.only(profile)) as IDBRequest<
            LearningEvidence[]
          >,
        ),
      ),

    seenItems: (profile) =>
      transact([EVENTS], 'readonly', async (tx) => {
        const events = await request(
          tx.objectStore(EVENTS).index('profile').getAll(IDBKeyRange.only(profile)) as IDBRequest<
            LearningEvidence[]
          >,
        );
        return new Set(events.map((event) => event.item));
      }),

    outbox: async (limit) => {
      // IndexedDB reads a count of 0 as "everything"
      const count = Math.floor(limit);
      if (!(count > 0)) return [];
      return transact([OUTBOX], 'readonly', (tx) =>
        request(tx.objectStore(OUTBOX).getAll(null, count) as IDBRequest<LearningEvidence[]>),
      );
    },

    markSynced: (ids) =>
      transact([OUTBOX], 'readwrite', async (tx) => {
        const outbox = tx.objectStore(OUTBOX);
        await Promise.all(ids.map((id) => request(outbox.delete(id))));
      }),

    exportAll: () =>
      transact([PROFILES, EVENTS], 'readonly', async (tx) => {
        const [profiles, events] = await Promise.all([
          request(tx.objectStore(PROFILES).getAll() as IDBRequest<Profile[]>),
          request(tx.objectStore(EVENTS).getAll() as IDBRequest<LearningEvidence[]>),
        ]);
        return { profiles, events };
      }),

    clear: () =>
      transact(ALL, 'readwrite', async (tx) => {
        await Promise.all(ALL.map((store) => request(tx.objectStore(store).clear())));
      }),

    deviceToken: () =>
      transact([META], 'readonly', async (tx) => {
        const value = await request(tx.objectStore(META).get(TOKEN));
        return typeof value === 'string' ? value : null;
      }),

    setDeviceToken: (token) =>
      transact([META], 'readwrite', async (tx) => {
        const meta = tx.objectStore(META);
        if (token === null) await request(meta.delete(TOKEN));
        else await request(meta.put(token, TOKEN));
      }),
  };
}
