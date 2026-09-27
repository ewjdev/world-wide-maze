import {
  type BridgeEvent,
  type BridgeState,
  bridgeProjection,
  initialBridgeState,
  type LessonV04,
  type LessonWorldManifest,
  transitionBridge,
  validateLesson,
} from '@wwm/learning';
import { type StageData, sha256Hex } from '@wwm/schema';
import {
  type BridgeSnapshot,
  commitBridgeProgress,
  ProgressConflict,
  readBridgeProgress,
  validateBridgeSnapshot,
} from './storage.ts';
import { bindLesson } from './world.ts';

export interface ProgressStore {
  read(pathId: string, activityId: string): Promise<unknown>;
  commit(snapshot: BridgeSnapshot, expectedRevision: number | null): Promise<void>;
}

const indexedDbStore: ProgressStore = { read: readBridgeProgress, commit: commitBridgeProgress };
export type SessionStatus = 'ready' | 'save-error' | 'projection-error' | 'conflict' | 'session-only';

/** Serialized commit/projection coordinator. The game enables input only in ready or session-only status. */
export class BridgeSession {
  status: SessionStatus = 'ready';
  state: BridgeState;
  #snapshot: BridgeSnapshot;
  #lastSavedRevision: number;
  #pending: BridgeState | null = null;
  #busy = false;
  #unsavedMode = false;

  private constructor(
    private readonly doc: LessonV04,
    snapshot: BridgeSnapshot,
    private readonly store: ProgressStore,
    private readonly project: (state: BridgeState) => Promise<void>,
  ) {
    this.#snapshot = snapshot;
    this.state = snapshot.state;
    this.#lastSavedRevision = snapshot.state.revision;
  }

  static async open(options: {
    doc: LessonV04;
    stage: StageData;
    manifest: LessonWorldManifest;
    sessionId: string;
    attemptId: string;
    seed: number;
    levelId: string;
    store?: ProgressStore;
    project: (state: BridgeState) => Promise<void>;
  }): Promise<BridgeSession> {
    const { doc, stage, manifest } = options;
    const missing = validateLesson(doc, ['inventory.deposit', 'session.resume']);
    if (missing.length) throw new Error(missing.join(' '));
    const binding = await bindLesson(doc, stage, manifest);
    if (!binding.ok) throw new Error(binding.reasons.join(' '));
    const identity = {
      pathId: doc.id,
      activityId: doc.activities[0]?.id ?? '',
      contentHash: await sha256Hex(JSON.stringify(doc)),
      bindingHash: await sha256Hex(JSON.stringify(manifest)),
      stageHash: manifest.stageHash,
    };
    const store = options.store ?? indexedDbStore;
    const prior = await store.read(identity.pathId, identity.activityId);
    let snapshot: BridgeSnapshot;
    if (prior === undefined) {
      snapshot = {
        schemaVersion: 1,
        ...identity,
        levelId: options.levelId,
        interfaceLocale: doc.interfaceLocale,
        targetLocale: doc.targetLocale,
        seed: options.seed,
        state: initialBridgeState(doc, options.sessionId, options.attemptId),
      };
      await store.commit(snapshot, null);
    } else {
      snapshot = validateBridgeSnapshot(prior, identity);
      if (snapshot.state.lessonRevision !== doc.revision)
        throw new Error('Saved lesson revision differs. Restart explicitly.');
    }
    const session = new BridgeSession(doc, snapshot, store, options.project);
    await session.#projectCommitted();
    return session;
  }

  async dispatch(event: BridgeEvent): Promise<{ accepted: boolean; reason?: string }> {
    if (this.#busy || !['ready', 'session-only'].includes(this.status))
      return { accepted: false, reason: 'Session paused.' };
    this.#busy = true;
    try {
      const result = transitionBridge(this.doc, this.state, event);
      if (!result.ok) return { accepted: false, reason: result.reason };
      if (result.state === this.state) return { accepted: true }; // duplicate event, no new effects
      if (this.status === 'session-only') {
        this.state = result.state;
        await this.#projectCommitted();
        return { accepted: this.status === 'session-only' };
      }
      this.#pending = result.state;
      return await this.#commitPending();
    } finally {
      this.#busy = false;
    }
  }

  async retry(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      if (this.status === 'save-error' && this.#pending) await this.#commitPending();
      else if (this.status === 'projection-error') await this.#projectCommitted();
    } finally {
      this.#busy = false;
    }
  }

  /** Explicit choice after a failed write; reload still returns to the last saved revision. */
  async continueWithoutSaving(): Promise<void> {
    if (this.status !== 'save-error' || !this.#pending || this.#busy)
      throw new Error('No failed write to continue from.');
    this.state = this.#pending;
    this.#pending = null;
    this.#unsavedMode = true;
    this.status = 'session-only';
    await this.#projectCommitted();
  }

  get lastSavedRevision(): number {
    return this.#lastSavedRevision;
  }
  get worldEffects(): ReturnType<typeof bridgeProjection> {
    return bridgeProjection(this.state);
  }

  async #commitPending(): Promise<{ accepted: boolean; reason?: string }> {
    const pending = this.#pending;
    if (!pending) return { accepted: false, reason: 'No pending event.' };
    const next = { ...this.#snapshot, state: pending };
    try {
      await this.store.commit(next, this.#lastSavedRevision);
    } catch (error) {
      this.status = error instanceof ProgressConflict ? 'conflict' : 'save-error';
      return { accepted: false, reason: error instanceof Error ? error.message : 'Progress write failed.' };
    }
    this.#snapshot = next;
    this.#lastSavedRevision = pending.revision;
    this.state = pending;
    this.#pending = null;
    await this.#projectCommitted();
    return {
      accepted: this.status === 'ready',
      ...(this.status === 'projection-error' ? { reason: 'World projection failed; retry.' } : {}),
    };
  }

  async #projectCommitted(): Promise<void> {
    try {
      await this.project(this.state);
      this.status = this.#unsavedMode ? 'session-only' : 'ready';
    } catch {
      this.status = 'projection-error';
    }
  }
}
