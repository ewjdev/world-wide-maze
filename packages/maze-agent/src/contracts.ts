import { type BallState, type InputSample, SIM_HZ, type SimEvent } from '@wwm/schema';
export const VERSION = 'jev-spectator/1';
export const PHYSICS_VERSION = '@wwm/physics:0.2.0/rapier-deterministic:0.20.0';
export const MODEL = 'jev-1.13.0';
export const LIMITS = {
  attempts: 64,
  pilotAttempts: 600,
  actions: 256,
  ticks: 300 * SIM_HZ,
  payload: 16384,
  response: 262144,
  recording: 10 * 1024 * 1024,
  runBytes: 32 * 1024 * 1024,
  pilotBytes: 512 * 1024 * 1024,
} as const;
export type Policy = 'jev' | 'baseline' | 'scripted';
export type Status = 'ready' | 'running' | 'paused' | 'finished' | 'failed' | 'stopped' | 'interrupted';
export interface Candidate {
  id: string;
  direction: string;
  kind: 'flat' | 'ramp' | 'goal' | 'gem';
  points?: number;
  gems?: number;
  travelSeconds?: number;
  destination: string | null;
  traversals: number;
}
export interface Observation {
  score?: {
    small: number;
    large: number;
    gems: number;
    gemScore: number;
    timeRemaining: number;
    bonus: number;
    score: number;
    totalGems: number;
    objective: string;
    mode: 'high-score';
  };
  current: string;
  goalVisible: boolean;
  nodes: { id: string; visits: number }[];
  edges: { id: string; from: string; to: string | null; traversals: number }[];
  history: { node: string; edge: string | null }[];
}
export interface Frame {
  id: string;
  tick: number;
  observation: Observation;
  candidates: Candidate[];
  digest: string;
}
export interface Receipt {
  attemptId: string;
  decisionId: string;
  source: Policy | 'forced' | 'forced-goal';
  choice: string;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  latencyMs: number;
  status: 'accepted' | 'discarded';
}
export interface TickedEvent {
  tick: number;
  event: SimEvent;
}
export interface Chunk {
  sequence: number;
  from: number;
  to: number;
  inputs: InputSample[];
  events: TickedEvent[];
  ball: BallState;
  digest: string;
}
export interface JournalEvent {
  seq: number;
  at: string;
  type: string;
  data: Record<string, unknown>;
}
export interface RunSummary {
  id: string;
  fixture: string;
  fixtureHash: string;
  policy: Policy;
  model: string | null;
  orderSeed: number;
  parentRunId: string | null;
  createdAt: string;
  endedAt: string | null;
  status: Status;
  reason: string | null;
  tick: number;
  decisions: number;
  attempts: number;
  actions: number;
  saved: boolean;
  title?: string;
  url?: string;
  scoreMode?: boolean;
  score?: number;
  gems?: number;
}
export interface RunDetail {
  summary: RunSummary;
  events: JournalEvent[];
  artifacts: Record<string, unknown>;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, '0')).join('');
}
export function modelPayload(frame: Frame) {
  return {
    state: frame.observation,
    questions: {
      move: {
        type: 'choice',
        instructions: frame.observation.score
          ? 'Play the visible maze for the highest score. Choose one supplied gem target or finish at the goal. Compare gem value against travel time and the lost time bonus (5 points/second). Prefer valuable nearby large gems, avoid small-gem detours costing more than they earn, and leave enough time to reach the goal. The local controller follows your target; it does not choose your strategy. Estimates may be optimistic. Select finish when collecting more is not worth the risk.'
          : 'Explore the maze to find its goal. Choose one adjacent connection. Prefer unexplored branches, remember dead ends, and backtrack when needed. Only the discovered graph is known. Select a supplied option.',
        criteria: Object.fromEntries(frame.candidates.map((c) => [c.id, c])),
      },
    },
  };
}
export function parseAnswer(value: unknown, frame: Frame) {
  const r = value as {
    model?: unknown;
    answers?: { move?: { type?: unknown; choice?: unknown; probabilities?: unknown; confidence?: unknown } };
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  const a = r?.answers?.move;
  const probs = a?.probabilities as Record<string, number>;
  const ids = frame.candidates.map((c) => c.id);
  if (
    r?.model !== MODEL ||
    a?.type !== 'choice' ||
    typeof a.choice !== 'string' ||
    !ids.includes(a.choice) ||
    !probs ||
    typeof probs !== 'object' ||
    Object.keys(probs).length !== ids.length ||
    ids.some((id) => !Number.isFinite(probs[id]) || probs[id] < 0 || probs[id] > 1) ||
    Math.abs(Object.values(probs).reduce((x, y) => x + y, 0) - 1) > 1e-4 ||
    typeof a.confidence !== 'number' ||
    !Number.isFinite(a.confidence) ||
    a.confidence < 0 ||
    a.confidence > 1 ||
    !Number.isInteger(r.usage?.input_tokens) ||
    !Number.isInteger(r.usage?.output_tokens) ||
    Number(r.usage?.input_tokens) < 0 ||
    Number(r.usage?.output_tokens) < 0
  )
    throw new Error('Invalid provider response');
  return {
    choice: a.choice,
    probabilities: probs,
    confidence: a.confidence,
    model: r.model as string,
    usage: r.usage as { input_tokens: number; output_tokens: number },
  };
}
