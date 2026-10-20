/**
 * A draft's records in its Durable Object's SQLite: the draft itself, the operator chat transcript and every
 * revision (by content hash). Plain SQL over a minimal `exec`, so tests run it on `node:sqlite` and the Agent on
 * `ctx.storage.sql`. Also the draft index, kept by one well-known instance of the same class.
 */
import {
  AUTHORING_OBJECTIVES,
  BANK_FILE_FORMAT,
  type BankFile,
  type DraftMessage,
  type DraftReview,
  type DraftRevision,
  type DraftRevisionSummary,
  type DraftSnapshot,
  type DraftStatus,
  type DraftSummary,
  type Round,
} from '@wwm/learning';

/** The instance of `LessonDraftAgent` that keeps the draft list. */
export const DRAFT_INDEX = 'draft-index';

export type SqlValue = string | number | null;
/** Run one statement and return its rows. */
export type Sql = (query: string, ...params: SqlValue[]) => Record<string, SqlValue>[];

export class DraftConflict extends Error {}

interface DraftRow {
  id: string;
  objective: string;
  brief: string;
  status: DraftStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  turn: number;
  error: string | null;
  review: string | null;
}

const str = (value: SqlValue | undefined) => (value === null || value === undefined ? '' : String(value));

export class DraftRecords {
  readonly #sql: Sql;
  constructor(sql: Sql) {
    this.#sql = sql;
    sql(`CREATE TABLE IF NOT EXISTS draft (
      id TEXT PRIMARY KEY, objective TEXT NOT NULL, brief TEXT NOT NULL, status TEXT NOT NULL,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      turn INTEGER NOT NULL DEFAULT 0, error TEXT, review TEXT)`);
    sql(`CREATE TABLE IF NOT EXISTS draft_messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, author TEXT, text TEXT NOT NULL,
      at TEXT NOT NULL, revision TEXT)`);
    sql(`CREATE TABLE IF NOT EXISTS draft_revisions (
      hash TEXT PRIMARY KEY, seq INTEGER NOT NULL, turn INTEGER NOT NULL, created_at TEXT NOT NULL,
      body TEXT NOT NULL)`);
  }

  #row(): DraftRow | undefined {
    const row = this.#sql('SELECT * FROM draft LIMIT 1')[0];
    return row as unknown as DraftRow | undefined;
  }

  exists(): boolean {
    return Boolean(this.#row());
  }

  create(input: { id: string; objective: string; brief: string; operator: string; now: string }): void {
    if (this.#row()) throw new DraftConflict('This draft already exists.');
    this.#sql(
      'INSERT INTO draft (id, objective, brief, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      input.id,
      input.objective,
      input.brief,
      'ready',
      input.operator,
      input.now,
      input.now,
    );
  }

  /** Record an operator message and open the next turn. Refuses while a turn runs or after a decision. */
  startTurn(input: { text: string; operator: string; now: string }): number {
    const row = this.#row();
    if (!row) throw new DraftConflict('No such draft.');
    if (row.status === 'generating')
      throw new DraftConflict('The agent is still working on the last message.');
    if (row.status === 'approved' || row.status === 'rejected')
      throw new DraftConflict(`This draft was ${row.status}; start a new draft to make changes.`);
    const turn = Number(row.turn) + 1;
    this.#sql(
      'INSERT INTO draft_messages (role, author, text, at) VALUES (?, ?, ?, ?)',
      'operator',
      input.operator,
      input.text,
      input.now,
    );
    this.#sql(
      'UPDATE draft SET status = ?, turn = ?, error = NULL, updated_at = ? WHERE id = ?',
      'generating',
      turn,
      input.now,
      row.id,
    );
    return turn;
  }

  /** Store a revision once; a replayed Workflow step stores nothing new. */
  saveRevision(revision: DraftRevision): void {
    const seq = Number(this.#sql('SELECT COUNT(*) AS n FROM draft_revisions')[0]?.n ?? 0) + 1;
    this.#sql(
      'INSERT OR IGNORE INTO draft_revisions (hash, seq, turn, created_at, body) VALUES (?, ?, ?, ?, ?)',
      revision.hash,
      seq,
      revision.turn,
      revision.createdAt,
      JSON.stringify(revision),
    );
  }

  /** The turn finished: post the pipeline's summary to the chat and mark the draft ready for review. */
  finishTurn(turn: number, hash: string, summary: string, now: string): void {
    const row = this.#row();
    // A replayed step finds the turn already finished (or superseded) and changes nothing.
    if (!row || Number(row.turn) !== turn || row.status !== 'generating') return;
    this.#sql(
      'INSERT INTO draft_messages (role, text, at, revision) VALUES (?, ?, ?, ?)',
      'agent',
      summary,
      now,
      hash,
    );
    this.#sql('UPDATE draft SET status = ?, updated_at = ? WHERE id = ?', 'ready', now, row.id);
  }

  failTurn(turn: number, error: string, now: string): void {
    const row = this.#row();
    if (!row || Number(row.turn) !== turn || row.status !== 'generating') return;
    const text = `Turn ${turn} failed: ${error.slice(0, 300)}. Nothing was saved; send the message again to retry.`;
    this.#sql('INSERT INTO draft_messages (role, text, at) VALUES (?, ?, ?)', 'agent', text, now);
    this.#sql(
      'UPDATE draft SET status = ?, error = ?, updated_at = ? WHERE id = ?',
      'failed',
      error.slice(0, 300),
      now,
      row.id,
    );
  }

  revision(hash: string): DraftRevision | undefined {
    const body = this.#sql('SELECT body FROM draft_revisions WHERE hash = ?', hash)[0]?.body;
    return body ? (JSON.parse(String(body)) as DraftRevision) : undefined;
  }

  latest(): DraftRevision | undefined {
    const body = this.#sql('SELECT body FROM draft_revisions ORDER BY seq DESC LIMIT 1')[0]?.body;
    return body ? (JSON.parse(String(body)) as DraftRevision) : undefined;
  }

  /**
   * The bank the next turn builds on: the latest revision's items minus the ones the operator dropped, plus the
   * labels (words) of every item this draft has dropped so far, so the agent doesn't offer them again.
   */
  base(drop: readonly string[]): { items: Round[]; dropped: string[]; avoid: string[] } {
    const items = this.latest()?.bank.items ?? [];
    const dropped = items.filter((item) => drop.includes(item.id)).map((item) => item.id);
    const kept = items.filter((item) => !dropped.includes(item.id));
    const label = AUTHORING_OBJECTIVES[this.#row()?.objective ?? '']?.label ?? (() => '');
    const keptLabels = new Set(kept.map(label));
    const avoid = new Set<string>();
    for (const { body } of this.#sql('SELECT body FROM draft_revisions'))
      for (const item of (JSON.parse(String(body)) as DraftRevision).bank.items)
        if (!keptLabels.has(label(item))) avoid.add(label(item));
    return { items: kept, dropped, avoid: [...avoid].filter(Boolean).sort() };
  }

  review(input: {
    decision: 'approved' | 'rejected';
    note: string;
    operator: string;
    revision: string;
    acknowledgeFlags: boolean;
    now: string;
  }): void {
    const row = this.#row();
    if (!row) throw new DraftConflict('No such draft.');
    if (row.status === 'approved' || row.status === 'rejected')
      throw new DraftConflict(`This draft was already ${row.status}.`);
    if (row.status === 'generating') throw new DraftConflict('Wait for the agent to finish this turn.');
    const revision = this.revision(input.revision);
    if (input.decision === 'approved') {
      if (!revision) throw new DraftConflict('Choose a revision to approve.');
      if (revision.hash !== this.latest()?.hash)
        throw new DraftConflict('Only the latest revision can be approved.');
      if (revision.issues.length) throw new DraftConflict('This revision has issues that block approval.');
      if (revision.flags.length && !input.acknowledgeFlags)
        throw new DraftConflict('Read and acknowledge the reviewer flags before approving.');
    }
    const review: DraftReview = {
      decision: input.decision,
      note: input.note,
      by: input.operator,
      at: input.now,
      ...(revision ? { revision: revision.hash } : {}),
    };
    this.#sql(
      'INSERT INTO draft_messages (role, author, text, at, revision) VALUES (?, ?, ?, ?, ?)',
      'operator',
      input.operator,
      `${input.decision === 'approved' ? 'Approved' : 'Rejected'}: ${input.note}`,
      input.now,
      revision?.hash ?? null,
    );
    this.#sql(
      'UPDATE draft SET status = ?, review = ?, updated_at = ? WHERE id = ?',
      input.decision,
      JSON.stringify(review),
      input.now,
      row.id,
    );
  }

  /**
   * The approved bank as a file for `pnpm learning:bank import`. Carries the revision hash and the review note for
   * the git review, but no operator identity (the repo is public).
   */
  exportBank(): BankFile | undefined {
    const row = this.#row();
    const review = row?.review ? (JSON.parse(row.review) as DraftReview) : undefined;
    if (row?.status !== 'approved' || !review?.revision) return undefined;
    const revision = this.revision(review.revision);
    if (!revision) return undefined;
    const model =
      revision.calls.map((call) => call.model).find((name) => name !== 'mock') ?? revision.calls[0]?.model;
    return {
      format: BANK_FILE_FORMAT,
      objective: revision.objective,
      items: revision.bank.items,
      provenance: {
        draft: row.id,
        revision: revision.hash,
        approvedAt: review.at,
        note: review.note,
        ...(model ? { model } : {}),
        vocabulary: revision.vocabulary,
      },
    };
  }

  summary(): DraftSummary | undefined {
    const row = this.#row();
    if (!row) return undefined;
    const latest = this.#sql(
      'SELECT hash, (SELECT COUNT(*) FROM draft_revisions) AS n FROM draft_revisions ORDER BY seq DESC LIMIT 1',
    )[0];
    return {
      id: row.id,
      objective: row.objective,
      brief: row.brief,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revisionCount: Number(latest?.n ?? 0),
      ...(latest ? { latest: str(latest.hash) } : {}),
    };
  }

  snapshot(): DraftSnapshot | undefined {
    const row = this.#row();
    const summary = this.summary();
    if (!row || !summary) return undefined;
    const messages = this.#sql('SELECT * FROM draft_messages ORDER BY seq').map(
      (message): DraftMessage => ({
        seq: Number(message.seq),
        role: message.role === 'agent' ? 'agent' : 'operator',
        ...(message.author ? { author: str(message.author) } : {}),
        text: str(message.text),
        at: str(message.at),
        ...(message.revision ? { revision: str(message.revision) } : {}),
      }),
    );
    const revisions = this.#sql('SELECT body FROM draft_revisions ORDER BY seq').map(({ body }) => {
      const revision = JSON.parse(String(body)) as DraftRevision;
      return {
        hash: revision.hash,
        turn: revision.turn,
        createdAt: revision.createdAt,
        items: revision.bank.items.length,
        added: revision.added.length,
        issues: revision.issues.length,
        flags: revision.flags.length,
      } satisfies DraftRevisionSummary;
    });
    return {
      ...summary,
      createdBy: row.created_by,
      turn: Number(row.turn),
      ...(row.error ? { error: row.error } : {}),
      ...(row.review ? { review: JSON.parse(row.review) as DraftReview } : {}),
      messages,
      revisions,
    };
  }
}

/** The list of drafts, kept by one instance (`DRAFT_INDEX`) so the workbench can list them without a scan. */
export class DraftIndex {
  readonly #sql: Sql;
  constructor(sql: Sql) {
    this.#sql = sql;
    sql(`CREATE TABLE IF NOT EXISTS draft_index (
      id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, body TEXT NOT NULL)`);
  }

  upsert(summary: DraftSummary): void {
    this.#sql(
      'INSERT INTO draft_index (id, updated_at, body) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, body = excluded.body',
      summary.id,
      summary.updatedAt,
      JSON.stringify(summary),
    );
  }

  has(id: string): boolean {
    return this.#sql('SELECT id FROM draft_index WHERE id = ?', id).length > 0;
  }

  list(limit = 100): DraftSummary[] {
    return this.#sql('SELECT body FROM draft_index ORDER BY updated_at DESC LIMIT ?', limit).map(
      ({ body }) => JSON.parse(String(body)) as DraftSummary,
    );
  }
}
