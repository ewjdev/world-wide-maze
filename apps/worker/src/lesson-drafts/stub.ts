/**
 * How the admin router reaches a draft. `agents` is imported lazily so the router (and its Node tests) never load
 * the Agents SDK unless a lesson-draft endpoint is actually used; esbuild still bundles it into the Worker.
 */

import type { BankFile, DraftRevision, DraftSnapshot, DraftSummary } from '@wwm/learning';
import type { DraftResult, LessonDraftAgent, TurnInput } from './agent.ts';

/** The agent's operator methods, as the router uses them (RPC stubs return promises). */
export interface DraftHandle {
  createDraft(input: TurnInput & { objective: string }): Promise<DraftResult<DraftSnapshot>>;
  sendMessage(input: TurnInput): Promise<DraftResult<DraftSnapshot>>;
  snapshot(): Promise<DraftSnapshot | null>;
  getRevision(hash: string): Promise<DraftRevision | null>;
  review(input: {
    decision: 'approved' | 'rejected';
    note: string;
    revision: string;
    acknowledgeFlags: boolean;
    operator: string;
  }): Promise<DraftResult<DraftSnapshot>>;
  exportBank(): Promise<BankFile | null>;
}

export interface IndexHandle {
  indexList(): Promise<DraftSummary[]>;
  indexHas(id: string): Promise<boolean>;
}

type Namespace = DurableObjectNamespace<LessonDraftAgent>;

export async function draftHandle(env: { LESSON_DRAFT_AGENT: Namespace }, id: string): Promise<DraftHandle> {
  const { getAgentByName } = await import('agents');
  // Workers RPC's stub types widen tuples (a compare round's `islands`) to arrays, so the structurally identical
  // stub needs a cast; the values themselves are structured clones of the agent's return values.
  return (await getAgentByName(env.LESSON_DRAFT_AGENT, id)) as unknown as DraftHandle;
}

export async function indexHandle(
  env: { LESSON_DRAFT_AGENT: Namespace },
  name: string,
): Promise<IndexHandle> {
  const { getAgentByName } = await import('agents');
  return getAgentByName(env.LESSON_DRAFT_AGENT, name);
}
