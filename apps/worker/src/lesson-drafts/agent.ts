/**
 * `LessonDraftAgent` (contracts §10.5 CCR-31-4): one Agents SDK Durable Object per draft. Its SQLite holds the
 * operator's chat transcript and every draft revision by content hash (records.ts). Each operator message starts
 * one `LESSON_DRAFT` Workflow instance (workflow.ts), which reports back through `recordRevision` and `turnReady`.
 * One well-known instance (`DRAFT_INDEX`) keeps the list of drafts.
 *
 * Only the Access-protected admin router addresses these objects (`/api/admin/lessons/*`); the Worker never routes
 * `/agents/*` requests, and the object refuses HTTP and WebSocket connections of its own.
 */

import type { BankFile, DraftRevision, DraftSnapshot, DraftSummary } from '@wwm/learning';
import { Agent, type Connection, getAgentByName } from 'agents';
import type { DraftParams } from './pipeline.ts';
import { DRAFT_INDEX, DraftConflict, DraftIndex, DraftRecords, type Sql } from './records.ts';

export const WORKFLOW_BINDING = 'LESSON_DRAFT';

export type DraftResult<T> = { ok: true; value: T } | { ok: false; status: 404 | 409; error: string };

export interface TurnInput {
  text: string;
  count: number;
  drop: string[];
  operator: string;
}

export class LessonDraftAgent extends Agent<Env> {
  #records?: DraftRecords;
  #index?: DraftIndex;
  readonly #exec: Sql = (query, ...params) =>
    this.ctx.storage.sql.exec(query, ...params).toArray() as ReturnType<Sql>;

  get #draft(): DraftRecords {
    this.#records ??= new DraftRecords(this.#exec);
    return this.#records;
  }

  get #list(): DraftIndex {
    this.#index ??= new DraftIndex(this.#exec);
    return this.#index;
  }

  // ── operator operations (called by the admin router) ───────────────────────────────────────────────────

  async createDraft(input: TurnInput & { objective: string }): Promise<DraftResult<DraftSnapshot>> {
    return this.#guard(async () => {
      this.#draft.create({
        id: this.name,
        objective: input.objective,
        brief: input.text,
        operator: input.operator,
        now: new Date().toISOString(),
      });
      return this.#turn(input);
    });
  }

  async sendMessage(input: TurnInput): Promise<DraftResult<DraftSnapshot>> {
    return this.#guard(() => this.#turn(input));
  }

  snapshot(): DraftSnapshot | null {
    return this.#draft.snapshot() ?? null;
  }

  getRevision(hash: string): DraftRevision | null {
    return this.#draft.revision(hash) ?? null;
  }

  async review(input: {
    decision: 'approved' | 'rejected';
    note: string;
    revision: string;
    acknowledgeFlags: boolean;
    operator: string;
  }): Promise<DraftResult<DraftSnapshot>> {
    return this.#guard(async () => {
      this.#draft.review({ ...input, now: new Date().toISOString() });
      await this.#publish();
      return this.#draft.snapshot() as DraftSnapshot;
    });
  }

  exportBank(): BankFile | null {
    return this.#draft.exportBank() ?? null;
  }

  // ── Workflow callbacks ─────────────────────────────────────────────────────────────────────────────────

  async recordRevision(revision: DraftRevision): Promise<void> {
    this.#draft.saveRevision(revision);
  }

  async turnReady(turn: number, hash: string, summary: string): Promise<void> {
    this.#draft.finishTurn(turn, hash, summary, new Date().toISOString());
    await this.#publish();
  }

  override async onWorkflowError(_workflowName: string, workflowId: string, error: string): Promise<void> {
    const turn = Number(/-t(\d+)$/.exec(workflowId)?.[1]);
    if (!Number.isInteger(turn)) return;
    this.#draft.failTurn(turn, error || 'The workflow failed.', new Date().toISOString());
    await this.#publish();
  }

  // ── the draft index (only on the DRAFT_INDEX instance) ────────────────────────────────────────────────

  indexUpsert(summary: DraftSummary): void {
    if (this.name === DRAFT_INDEX) this.#list.upsert(summary);
  }

  indexList(): DraftSummary[] {
    return this.name === DRAFT_INDEX ? this.#list.list() : [];
  }

  indexHas(id: string): boolean {
    return this.name === DRAFT_INDEX && this.#list.has(id);
  }

  // ── no direct access ──────────────────────────────────────────────────────────────────────────────────

  override onRequest(): Response {
    return new Response('Not found', { status: 404 });
  }

  override onConnect(connection: Connection): void {
    connection.close(1008, 'Lesson drafts are only available through the admin API.');
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────────────

  async #turn(input: TurnInput): Promise<DraftSnapshot> {
    const now = new Date().toISOString();
    const summary = this.#draft.summary();
    if (!summary) throw new DraftConflict('No such draft.');
    const { items, dropped, avoid } = this.#draft.base(input.drop);
    const turn = this.#draft.startTurn({ text: input.text, operator: input.operator, now });
    const params: DraftParams = {
      draftId: this.name,
      turn,
      objective: summary.objective,
      brief: summary.brief,
      message: input.text,
      count: input.count,
      base: items,
      dropped,
      avoid,
    };
    try {
      await this.runWorkflow(WORKFLOW_BINDING, params, { id: `${this.name}-t${turn}` });
    } catch (error) {
      this.#draft.failTurn(turn, `the workflow could not start (${(error as Error).message})`, now);
    }
    await this.#publish();
    return this.#draft.snapshot() as DraftSnapshot;
  }

  async #publish(): Promise<void> {
    const summary = this.#draft.summary();
    if (!summary) return;
    const index = await getAgentByName(this.env.LESSON_DRAFT_AGENT, DRAFT_INDEX);
    await index.indexUpsert(summary);
  }

  async #guard<T>(fn: () => Promise<T>): Promise<DraftResult<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      if (error instanceof DraftConflict)
        return { ok: false, status: error.message === 'No such draft.' ? 404 : 409, error: error.message };
      throw error;
    }
  }
}
