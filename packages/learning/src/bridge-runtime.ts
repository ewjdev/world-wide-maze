import type { BridgeEncounter, LessonV04 } from './lesson-v04.ts';

export interface BridgeState {
  sessionId: string;
  attemptId: string;
  lessonRevision: string;
  activityId: string;
  encounterIndex: number;
  revision: number;
  nextSequence: number;
  acceptedEventIds: string[];
  inventory: Record<string, number>;
  consumedPickupIds: string[];
  tentative: number;
  prediction: number | null;
  completedEncounterIds: string[];
  deposits: Record<string, number>;
  openConnectors: string[];
  hintsUsed: Record<string, number>;
}

export interface BridgeEvent {
  lessonRevision: string;
  sessionId: string;
  attemptId: string;
  nodeId: string;
  eventId: string;
  sequence: number;
  action:
    | { type: 'pickup'; pickupId: string }
    | { type: 'stage'; count: number }
    | { type: 'return'; count: number }
    | { type: 'predict'; remaining: number }
    | { type: 'hint' }
    | { type: 'confirm' }
    | { type: 'next' };
}

export type BridgeTransition =
  | { ok: true; state: BridgeState; effects: { openConnectors: string[]; hiddenPickups: string[] } }
  | { ok: false; reason: string; state: BridgeState };

const encounter = (doc: LessonV04, state: BridgeState): BridgeEncounter | undefined =>
  doc.activities[0]?.encounters[state.encounterIndex];

export function initialBridgeState(doc: LessonV04, sessionId: string, attemptId: string): BridgeState {
  const activity = doc.activities[0];
  const first = activity?.encounters[0];
  if (!activity || !first) throw new Error('Bridge lesson has no first encounter.');
  return {
    sessionId,
    attemptId,
    lessonRevision: doc.revision,
    activityId: activity.id,
    encounterIndex: 0,
    revision: 0,
    nextSequence: 1,
    acceptedEventIds: [],
    inventory: Object.fromEntries(first.initialInventory.map((x) => [x.type, x.count])),
    consumedPickupIds: [],
    tentative: 0,
    prediction: null,
    completedEncounterIds: [],
    deposits: {},
    openConnectors: [],
    hintsUsed: {},
  };
}

export function bridgeProjection(state: BridgeState): { openConnectors: string[]; hiddenPickups: string[] } {
  return { openConnectors: [...state.openConnectors], hiddenPickups: [...state.consumedPickupIds] };
}

/** Pure reducer: the caller commits the returned state before projecting world effects. */
export function transitionBridge(doc: LessonV04, current: BridgeState, event: BridgeEvent): BridgeTransition {
  const reject = (reason: string): BridgeTransition => ({ ok: false, reason, state: current });
  if (event.lessonRevision !== doc.revision || event.lessonRevision !== current.lessonRevision)
    return reject('Lesson revision mismatch.');
  if (event.sessionId !== current.sessionId || event.attemptId !== current.attemptId)
    return reject('Session or attempt mismatch.');
  if (current.acceptedEventIds.includes(event.eventId))
    return { ok: true, state: current, effects: bridgeProjection(current) };
  if (current.acceptedEventIds.length >= 4096)
    return reject('Event limit reached; start a checkpointed new attempt.');
  if (event.sequence !== current.nextSequence) return reject('Out-of-order event.');
  const node = encounter(doc, current);
  if (!node || event.nodeId !== node.id) return reject('Wrong encounter.');
  const state: BridgeState = {
    ...current,
    inventory: { ...current.inventory },
    acceptedEventIds: [...current.acceptedEventIds],
    consumedPickupIds: [...current.consumedPickupIds],
    completedEncounterIds: [...current.completedEncounterIds],
    deposits: { ...current.deposits },
    openConnectors: [...current.openConnectors],
    hintsUsed: { ...current.hintsUsed },
  };
  const completed = state.completedEncounterIds.includes(node.id);
  const action = event.action;
  if (action.type === 'pickup') {
    if (completed) return reject('Encounter already complete.');
    const pickup = node.pickups.find((x) => x.id === action.pickupId);
    if (!pickup) return reject('Unknown pickup.');
    if (state.consumedPickupIds.includes(pickup.id)) return reject('Pickup already consumed.');
    if ((state.inventory[pickup.item] ?? 0) + pickup.count > 99) return reject('Inventory limit.');
    state.inventory[pickup.item] = (state.inventory[pickup.item] ?? 0) + pickup.count;
    state.consumedPickupIds.push(pickup.id);
  } else if (action.type === 'predict') {
    if (completed || node.id !== 'nine-minus-four') return reject('Prediction is not open.');
    if (!Number.isInteger(action.remaining) || action.remaining < 0 || action.remaining > 99)
      return reject('Invalid prediction.');
    state.prediction = action.remaining;
  } else if (action.type === 'stage') {
    if (completed || (node.id === 'nine-minus-four' && state.prediction === null))
      return reject('Prediction required first.');
    if (
      !Number.isInteger(action.count) ||
      action.count < 1 ||
      action.count > (state.inventory[node.deposit.item] ?? 0)
    )
      return reject('Not enough inventory.');
    state.inventory[node.deposit.item] -= action.count;
    state.tentative += action.count;
  } else if (action.type === 'return') {
    if (completed || !Number.isInteger(action.count) || action.count < 1 || action.count > state.tentative)
      return reject('Invalid return.');
    state.tentative -= action.count;
    state.inventory[node.deposit.item] = (state.inventory[node.deposit.item] ?? 0) + action.count;
  } else if (action.type === 'hint') {
    if (completed) return reject('Encounter already complete.');
    state.hintsUsed[node.id] = Math.min(node.hints.length, (state.hintsUsed[node.id] ?? 0) + 1);
  } else if (action.type === 'confirm') {
    if (completed) return reject('Encounter already complete.');
    if (state.tentative + node.deposit.prefilled !== node.deposit.required)
      return reject('The tray needs its exact total.');
    state.deposits[node.deposit.target] = node.deposit.required;
    state.openConnectors.push(node.deposit.connector);
    state.completedEncounterIds.push(node.id);
    state.tentative = 0;
  } else if (action.type === 'next') {
    if (!completed) return reject('Complete this encounter first.');
    const next = doc.activities[0]?.encounters[current.encounterIndex + 1];
    if (!next) return reject('No next encounter.');
    state.encounterIndex++;
    state.inventory = Object.fromEntries(next.initialInventory.map((x) => [x.type, x.count]));
    state.tentative = 0;
    state.prediction = null;
  }
  state.revision++;
  state.nextSequence++;
  state.acceptedEventIds.push(event.eventId);
  return { ok: true, state, effects: bridgeProjection(state) };
}
