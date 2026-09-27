import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/learning/bridge-builders/lesson.json' with { type: 'json' };
import {
  baselinePath,
  bridgeBuilders,
  initialBridgeState,
  learningScriptV04,
  normalizeLearningDocument,
  parseLessonV04,
  readLearningHtmlAny,
  transitionBridge,
  validateLesson,
} from '../src/index.ts';

function play(
  action: Parameters<typeof transitionBridge>[2]['action'],
  state = initialBridgeState(bridgeBuilders, 'session', 'attempt'),
  eventId = `e-${state.nextSequence}`,
) {
  const node = bridgeBuilders.activities[0]?.encounters[state.encounterIndex];
  if (!node) throw new Error('Missing encounter');
  return transitionBridge(bridgeBuilders, state, {
    lessonRevision: bridgeBuilders.revision,
    sessionId: state.sessionId,
    attemptId: state.attemptId,
    nodeId: node.id,
    eventId,
    sequence: state.nextSequence,
    action,
  });
}

describe('experimental bridge contract', () => {
  it('keeps legacy and experimental formats distinct and bounded', () => {
    expect(parseLessonV04(fixture)).toEqual(bridgeBuilders);
    expect(normalizeLearningDocument(baselinePath).kind).toBe('legacy-linear');
    expect(normalizeLearningDocument(bridgeBuilders).kind).toBe('v04');
    const html = `<!doctype html><title>Bridge Builders</title>${learningScriptV04(bridgeBuilders)}`;
    expect(readLearningHtmlAny(html)).toEqual({ kind: 'v04', path: bridgeBuilders });
    expect(validateLesson(bridgeBuilders, ['session.resume'])).toEqual([
      'Unsupported required capability: inventory.deposit',
    ]);
    const invalid = structuredClone(bridgeBuilders);
    const first = invalid.activities[0]?.encounters[0];
    if (!first) throw new Error('Missing fixture encounter');
    first.deposit.connector = 'missing';
    expect(() => parseLessonV04(invalid)).toThrow();
  });

  it('preserves exact stock through reversible transfers and deduplicates pickup and confirm', () => {
    let state = initialBridgeState(bridgeBuilders, 'session', 'attempt');
    for (const pickupId of ['gem-1a', 'gem-1b', 'gem-1c']) {
      const result = play({ type: 'pickup', pickupId }, state);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }
    expect(state.inventory.gem).toBe(5);
    const stage = play({ type: 'stage', count: 5 }, state);
    expect(stage.ok).toBe(true);
    if (!stage.ok) return;
    state = stage.state;
    const returned = play({ type: 'return', count: 2 }, state);
    expect(returned.ok).toBe(true);
    if (!returned.ok) return;
    state = returned.state;
    expect(state.inventory.gem).toBe(2);
    expect(state.tentative).toBe(3);
    expect(play({ type: 'confirm' }, state).ok).toBe(false);
    const restaged = play({ type: 'stage', count: 2 }, state);
    expect(restaged.ok).toBe(true);
    if (!restaged.ok) return;
    state = restaged.state;
    const confirm = play({ type: 'confirm' }, state);
    expect(confirm.ok).toBe(true);
    if (!confirm.ok) return;
    state = confirm.state;
    expect(state.deposits['repair-1']).toBe(5);
    expect(state.openConnectors).toEqual(['crossing-1']);
    expect(state.inventory.gem).toBe(0);
    const duplicate = transitionBridge(bridgeBuilders, state, {
      lessonRevision: bridgeBuilders.revision,
      sessionId: 'session',
      attemptId: 'attempt',
      nodeId: 'first-five',
      eventId: `e-${state.nextSequence - 1}`,
      sequence: state.nextSequence - 1,
      action: { type: 'confirm' },
    });
    expect(duplicate.ok).toBe(true);
    expect(duplicate.state).toEqual(state);
  });

  it('rejects out-of-order events and requires prediction in encounter three', () => {
    const state = initialBridgeState(bridgeBuilders, 'session', 'attempt');
    expect(
      transitionBridge(bridgeBuilders, state, {
        lessonRevision: bridgeBuilders.revision,
        sessionId: 'session',
        attemptId: 'attempt',
        nodeId: 'first-five',
        eventId: 'late',
        sequence: 2,
        action: { type: 'pickup', pickupId: 'gem-1a' },
      }).ok,
    ).toBe(false);
    const third = { ...state, encounterIndex: 2, inventory: { gem: 9 } };
    expect(play({ type: 'stage', count: 4 }, third).ok).toBe(false);
    const predicted = play({ type: 'predict', remaining: 5 }, third);
    expect(predicted.ok).toBe(true);
    if (predicted.ok) expect(play({ type: 'stage', count: 4 }, predicted.state).ok).toBe(true);
  });
});
