import { type BridgeEvent, bridgeBuilders, parseLessonWorldManifest } from '@wwm/learning';
import { parseStage } from '@wwm/schema';
import { describe, expect, it } from 'vitest';
import bindingJson from '../../../fixtures/learning/bridge-builders/binding.json' with { type: 'json' };
import stageJson from '../../../fixtures/learning/bridge-builders/stage.json' with { type: 'json' };
import { BridgeSession, type ProgressStore } from '../src/learning/bridge-session.ts';
import { type BridgeSnapshot, ProgressConflict } from '../src/learning/storage.ts';

const stage = parseStage(stageJson);
const manifest = parseLessonWorldManifest(bindingJson);

function event(session: BridgeSession, action: BridgeEvent['action']): BridgeEvent {
  return {
    lessonRevision: bridgeBuilders.revision,
    sessionId: session.state.sessionId,
    attemptId: session.state.attemptId,
    nodeId: 'first-five',
    eventId: `event-${session.state.nextSequence}`,
    sequence: session.state.nextSequence,
    action,
  };
}

function memoryStore() {
  let saved: BridgeSnapshot | undefined;
  let fail = false;
  const store: ProgressStore = {
    async read() {
      return saved;
    },
    async commit(next, expectedRevision) {
      if (fail) throw new Error('Quota exceeded');
      if ((saved?.state.revision ?? null) !== expectedRevision) throw new ProgressConflict();
      saved = structuredClone(next);
    },
  };
  return {
    store,
    get saved() {
      return saved;
    },
    setFail(value: boolean) {
      fail = value;
    },
  };
}

async function open(store: ProgressStore, project: (state: BridgeSession['state']) => Promise<void>) {
  return BridgeSession.open({
    doc: bridgeBuilders,
    stage,
    manifest,
    sessionId: 'session',
    attemptId: 'attempt',
    seed: 42,
    levelId: 'guided',
    store,
    project,
  });
}

describe('BridgeSession commit boundary', () => {
  it('saves the next state before projecting it, and restores the committed world', async () => {
    const memory = memoryStore();
    const revisions: number[] = [];
    const session = await open(memory.store, async (state) => {
      expect(memory.saved?.state).toEqual(state);
      revisions.push(state.revision);
    });
    expect(await session.dispatch(event(session, { type: 'pickup', pickupId: 'gem-1a' }))).toEqual({
      accepted: true,
    });
    expect(revisions).toEqual([0, 1]);
    expect(session.worldEffects.hiddenPickups).toEqual(['gem-1a']);
    const restored = await open(memory.store, async (state) => {
      expect(state.consumedPickupIds).toEqual(['gem-1a']);
    });
    expect(restored.state.revision).toBe(1);
  });

  it('does not acknowledge a failed write and offers explicit session-only continuation', async () => {
    const memory = memoryStore();
    const session = await open(memory.store, async () => {});
    memory.setFail(true);
    const result = await session.dispatch(event(session, { type: 'pickup', pickupId: 'gem-1a' }));
    expect(result.accepted).toBe(false);
    expect(session.status).toBe('save-error');
    expect(session.state.revision).toBe(0);
    expect(memory.saved?.state.revision).toBe(0);
    await session.continueWithoutSaving();
    expect(session.status).toBe('session-only');
    expect(session.state.revision).toBe(1);
    expect(memory.saved?.state.revision).toBe(0);
  });

  it('keeps a committed state paused until projection can be retried', async () => {
    const memory = memoryStore();
    let failProjection = false;
    const session = await open(memory.store, async () => {
      if (failProjection) throw new Error('Renderer missing');
    });
    failProjection = true;
    expect((await session.dispatch(event(session, { type: 'pickup', pickupId: 'gem-1a' }))).accepted).toBe(
      false,
    );
    expect(session.status).toBe('projection-error');
    expect(memory.saved?.state.revision).toBe(1);
    failProjection = false;
    await session.retry();
    expect(session.status).toBe('ready');
  });

  it('preserves mismatched progress and stops on a stale second-tab revision', async () => {
    const memory = memoryStore();
    const first = await open(memory.store, async () => {});
    const second = await open(memory.store, async () => {});
    expect((await first.dispatch(event(first, { type: 'pickup', pickupId: 'gem-1a' }))).accepted).toBe(true);
    const stale = await second.dispatch(event(second, { type: 'pickup', pickupId: 'gem-1b' }));
    expect(stale.accepted).toBe(false);
    expect(second.status).toBe('conflict');
    expect(second.state.revision).toBe(0);
    expect(memory.saved?.state.consumedPickupIds).toEqual(['gem-1a']);
    const changedStore: ProgressStore = {
      read: async () => ({ ...memory.saved, contentHash: 'different' }),
      commit: async () => {
        throw new ProgressConflict();
      },
    };
    await expect(open(changedStore, async () => {})).rejects.toThrow('different contentHash');
  });
});
