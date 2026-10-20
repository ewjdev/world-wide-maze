/**
 * Lesson drafts (Phase 31 M4, contracts §10.5 CCR-31-4): the operator chats with the authoring agent, reviews each
 * revision's items, validation issues and reviewer flags, previews it as a lesson page, then approves and exports
 * the bank for `pnpm learning:bank import`. Model output is shown only as React text (escaped) or inside the
 * sandboxed preview, which the trusted renderer produced. Nothing here reaches a child.
 */
import type {
  DraftItemVerdict,
  DraftListResponse,
  DraftRevision,
  DraftSnapshot,
  DraftStatus,
  DraftSummary,
} from '@wwm/learning';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AdminError, adminRequest, errorMessage } from './api.ts';
import './lesson-drafts.css';

const BASE = '/lessons';
const statusNames: Record<DraftStatus, string> = {
  generating: 'Agent working',
  ready: 'Ready for review',
  failed: 'Turn failed',
  approved: 'Approved',
  rejected: 'Rejected',
};
const statusTone: Record<DraftStatus, string> = {
  generating: 'pending_review',
  ready: 'pending_review',
  failed: 'blocked',
  approved: 'approved',
  rejected: 'blocked',
};

export const lessonApi = {
  list: (signal?: AbortSignal) => adminRequest<DraftListResponse>(BASE, { signal }),
  create: (body: { objective: string; brief: string; count: number }) =>
    adminRequest<DraftSnapshot>(BASE, { method: 'POST', body: JSON.stringify(body) }),
  draft: (id: string, signal?: AbortSignal) =>
    adminRequest<DraftSnapshot>(`${BASE}/${encodeURIComponent(id)}`, { signal }),
  revision: (id: string, hash: string, signal?: AbortSignal) =>
    adminRequest<DraftRevision>(`${BASE}/${encodeURIComponent(id)}/revisions/${encodeURIComponent(hash)}`, {
      signal,
    }),
  message: (id: string, body: { text: string; count: number; drop: string[] }) =>
    adminRequest<DraftSnapshot>(`${BASE}/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  review: (
    id: string,
    body: { decision: 'approved' | 'rejected'; note: string; revision: string; acknowledgeFlags: boolean },
  ) =>
    adminRequest<DraftSnapshot>(`${BASE}/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  previewUrl: (id: string, hash: string) =>
    `/api/admin${BASE}/${encodeURIComponent(id)}/revisions/${encodeURIComponent(hash)}/preview`,
  exportUrl: (id: string) => `/api/admin${BASE}/${encodeURIComponent(id)}/export`,
};

function date(value: string) {
  return new Date(value).toLocaleString();
}
function Status({ status }: { status: DraftStatus }) {
  return (
    <span className="admin-status" data-status={statusTone[status]}>
      {statusNames[status]}
    </span>
  );
}

export function LessonDrafts({ active = true }: { active?: boolean }) {
  const [list, setList] = useState<DraftListResponse | null>(null);
  const [off, setOff] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    void revision;
    if (!active) return;
    const controller = new AbortController();
    lessonApi
      .list(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setList(value);
        setError('');
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof AdminError && cause.status === 404) setOff(true);
        else setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, [active, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  return (
    <section className="admin-lessons" aria-label="Lesson drafts">
      <header className="admin-heading">
        <h1>Lesson drafts</h1>
        <p>
          Ask the authoring agent for fresh bank items, check every one, then approve and export. Drafts are
          inert data: nothing reaches a child until the exported bank is imported with{' '}
          <code>pnpm learning:bank import</code>, reviewed in git and deployed.
        </p>
      </header>
      {off ? (
        <div className="admin-empty">
          <h2>Lesson drafts are off</h2>
          <p>
            Set <code>LESSON_DRAFTS</code> to <code>on</code> for this Worker to use the authoring agent. See
            docs/education/lesson-drafts.md.
          </p>
        </div>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={refresh}>
            Retry lesson drafts
          </button>
        </div>
      ) : !list ? (
        <p role="status">Loading lesson drafts…</p>
      ) : (
        <>
          <DraftSettings list={list} />
          <div className="admin-workspace" data-selected={Boolean(selected)}>
            <section className="admin-catalog" aria-label="Drafts">
              <div className="admin-section-heading">
                <h2>Drafts</h2>
                <span>{list.drafts.length}</span>
              </div>
              <NewDraft
                list={list}
                onCreated={(id) => {
                  setSelected(id);
                  refresh();
                }}
              />
              {list.drafts.length === 0 ? (
                <p>No drafts yet. Start one with a short brief.</p>
              ) : (
                <ul className="admin-results">
                  {list.drafts.map((draft) => (
                    <DraftRow
                      key={draft.id}
                      draft={draft}
                      selected={selected === draft.id}
                      onSelect={setSelected}
                    />
                  ))}
                </ul>
              )}
            </section>
            <section className="admin-detail" aria-label="Selected draft">
              {selected && (
                <button type="button" className="admin-back" onClick={() => setSelected(null)}>
                  Back to drafts
                </button>
              )}
              {selected ? (
                <DraftDetail key={selected} id={selected} onChanged={refresh} />
              ) : (
                <div className="admin-empty">
                  <h2>Select a draft</h2>
                  <p>Choose a draft to read the conversation, check its items and preview the lesson.</p>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function DraftSettings({ list }: { list: DraftListResponse }) {
  return (
    <dl className="admin-facts admin-lessons-facts">
      <div>
        <dt>Model</dt>
        <dd>
          {list.provider.mode === 'mock'
            ? 'Offline mock (no AI model connected)'
            : list.provider.mode === 'off'
              ? 'No provider configured: drafts can be read but not generated'
              : `${list.provider.model} through AI Gateway`}
        </dd>
      </div>
      <div>
        <dt>Word list</dt>
        <dd>
          {list.vocabulary.id}, {list.vocabulary.words} words ·{' '}
          {list.vocabulary.reviewStatus === 'reviewed' ? 'Reviewed' : 'Needs owner review'}
        </dd>
      </div>
    </dl>
  );
}

function DraftRow({
  draft,
  selected,
  onSelect,
}: {
  draft: DraftSummary;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="admin-result"
        aria-pressed={selected}
        onClick={() => onSelect(draft.id)}
      >
        <span className="admin-result-title">{draft.brief}</span>
        <span className="admin-url">{draft.objective}</span>
        <Status status={draft.status} />
        <span className="admin-result-meta">
          {date(draft.updatedAt)} · {draft.revisionCount} revision{draft.revisionCount === 1 ? '' : 's'}
        </span>
      </button>
    </li>
  );
}

function NewDraft({ list, onCreated }: { list: DraftListResponse; onCreated: (id: string) => void }) {
  const [objective, setObjective] = useState(list.objectives[0]?.id ?? '');
  const [brief, setBrief] = useState('');
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !brief.trim() || !objective) return;
    setBusy(true);
    setError('');
    try {
      const draft = await lessonApi.create({ objective, brief: brief.trim(), count });
      setBrief('');
      onCreated(draft.id);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="admin-advanced admin-lessons-new">
      <summary>Start a new draft</summary>
      <form onSubmit={submit} aria-label="Start a lesson draft" aria-busy={busy}>
        <label>
          Objective
          <select value={objective} disabled={busy} onChange={(event) => setObjective(event.target.value)}>
            {list.objectives.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Brief for the agent
          <textarea
            required
            rows={3}
            maxLength={2000}
            value={brief}
            disabled={busy}
            placeholder="For example: animals and things in the kitchen; vary the blank position."
            onChange={(event) => setBrief(event.target.value)}
          />
        </label>
        <label>
          New items in the first turn
          <input
            type="number"
            min={1}
            max={12}
            value={count}
            disabled={busy}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="admin-primary" disabled={busy || !brief.trim() || !objective}>
          {busy ? 'Starting…' : 'Start draft'}
        </button>
      </form>
    </details>
  );
}

function DraftDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [draft, setDraft] = useState<DraftSnapshot | null>(null);
  const [error, setError] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const generating = draft?.status === 'generating';
  const wasGenerating = useRef(false);
  useEffect(() => {
    void tick;
    const controller = new AbortController();
    lessonApi
      .draft(id, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setDraft(value);
        setError('');
        const finished = wasGenerating.current && value.status !== 'generating';
        // Keep the revision the operator chose, unless a turn just finished: then show its result.
        setHash((current) =>
          !finished && current && value.revisions.some((r) => r.hash === current)
            ? current
            : (value.latest ?? null),
        );
        if (finished) onChanged();
        wasGenerating.current = value.status === 'generating';
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, [id, tick, onChanged]);
  // While the agent works, check back every two seconds.
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => setTick((value) => value + 1), 2000);
    return () => clearInterval(timer);
  }, [generating]);
  const reload = () => setTick((value) => value + 1);

  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <button type="button" onClick={reload}>
          Retry draft
        </button>
      </div>
    );
  if (!draft) return <p role="status">Loading draft…</p>;
  const locked = draft.status === 'approved' || draft.status === 'rejected';
  return (
    <>
      <div className="admin-section-heading">
        <h2>{draft.brief}</h2>
        <Status status={draft.status} />
      </div>
      <p className="admin-help">
        {draft.objective} · started {date(draft.createdAt)} by {draft.createdBy}
      </p>
      <h3>Conversation</h3>
      <Transcript draft={draft} onShow={setHash} />
      {!locked && (
        <MessageForm
          id={id}
          disabled={generating}
          latest={draft.latest ?? null}
          onSent={(value) => {
            setDraft(value);
            wasGenerating.current = true;
            onChanged();
          }}
        />
      )}
      {draft.revisions.length > 0 && (
        <>
          <h3>Revisions</h3>
          <label className="admin-lessons-revision">
            Revision
            <select value={hash ?? ''} onChange={(event) => setHash(event.target.value)}>
              {[...draft.revisions].reverse().map((rev) => (
                <option key={rev.hash} value={rev.hash}>
                  Turn {rev.turn} · {rev.items} items · {rev.issues} issues · {rev.flags} flags ·{' '}
                  {rev.hash.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {hash && (
            <RevisionView
              key={hash}
              draft={draft}
              hash={hash}
              onReviewed={(value) => {
                setDraft(value);
                onChanged();
              }}
            />
          )}
        </>
      )}
    </>
  );
}

export function Transcript({ draft, onShow }: { draft: DraftSnapshot; onShow?: (hash: string) => void }) {
  return (
    <ol className="admin-history admin-lessons-chat" aria-live="polite">
      {draft.messages.map((message) => (
        <li key={message.seq} data-role={message.role}>
          <div>
            <strong>{message.role === 'agent' ? 'Agent' : (message.author ?? 'Operator')}</strong>
            <time dateTime={message.at}>{date(message.at)}</time>
          </div>
          <p>{message.text}</p>
          {message.revision && onShow && (
            <button type="button" onClick={() => onShow(message.revision as string)}>
              Show revision {message.revision.slice(0, 8)}
            </button>
          )}
        </li>
      ))}
      {draft.status === 'generating' && (
        <li data-role="agent">
          <p role="status">The agent is writing and checking items…</p>
        </li>
      )}
    </ol>
  );
}

function MessageForm({
  id,
  disabled,
  latest,
  onSent,
}: {
  id: string;
  disabled: boolean;
  latest: string | null;
  onSent: (draft: DraftSnapshot) => void;
}) {
  const [text, setText] = useState('');
  const [count, setCount] = useState(6);
  const [drop, setDrop] = useState<string[]>([]);
  const [items, setItems] = useState<DraftItemVerdict[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setDrop([]);
    setItems([]);
    if (!latest) return;
    const controller = new AbortController();
    lessonApi
      .revision(id, latest, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setItems(value.items.filter((item) => item.added));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id, latest]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled || !text.trim()) return;
    setBusy(true);
    setError('');
    try {
      onSent(await lessonApi.message(id, { text: text.trim(), count, drop }));
      setText('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="admin-confirm admin-lessons-message"
      onSubmit={submit}
      aria-label="Message the agent"
      aria-busy={busy}
    >
      <label>
        Message
        <textarea
          required
          rows={2}
          maxLength={2000}
          value={text}
          disabled={busy || disabled}
          placeholder="For example: six more, with the blank at the start."
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label>
        New items
        <input
          type="number"
          min={1}
          max={12}
          value={count}
          disabled={busy || disabled}
          onChange={(event) => setCount(Number(event.target.value))}
        />
      </label>
      {items.length > 0 && (
        <fieldset disabled={busy || disabled}>
          <legend>Drop from the next revision</legend>
          {items.map((item) => (
            <label key={item.id} className="admin-check">
              <input
                type="checkbox"
                checked={drop.includes(item.id ?? '')}
                onChange={(event) =>
                  setDrop((value) =>
                    event.target.checked ? [...value, item.id ?? ''] : value.filter((x) => x !== item.id),
                  )
                }
              />
              {item.label}
            </label>
          ))}
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="admin-primary" disabled={busy || disabled || !text.trim()}>
        {busy ? 'Sending…' : disabled ? 'The agent is working…' : 'Send to the agent'}
      </button>
    </form>
  );
}

function RevisionView({
  draft,
  hash,
  onReviewed,
}: {
  draft: DraftSnapshot;
  hash: string;
  onReviewed: (draft: DraftSnapshot) => void;
}) {
  const [revision, setRevision] = useState<DraftRevision | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    lessonApi
      .revision(draft.id, hash, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setRevision(value);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, [draft.id, hash]);
  if (error) return <p role="alert">{error}</p>;
  if (!revision) return <p role="status">Loading revision…</p>;
  return (
    <RevisionReport
      draft={draft}
      revision={revision}
      previewUrl={lessonApi.previewUrl(draft.id, hash)}
      onReviewed={onReviewed}
    />
  );
}

/** One revision: what changed, what blocks approval, what a reviewer should read, every item, and the decision. */
export function RevisionReport({
  draft,
  revision,
  previewUrl,
  onReviewed,
}: {
  draft: DraftSnapshot;
  revision: DraftRevision;
  previewUrl: string;
  onReviewed: (draft: DraftSnapshot) => void;
}) {
  const latest = revision.hash === draft.latest;
  const tokens = revision.calls.reduce((sum, call) => sum + call.inputTokens + call.outputTokens, 0);
  return (
    <div className="admin-lessons-revision-report">
      <p>{revision.summary}</p>
      <p className="admin-help">
        {revision.bank.items.length} items in the bank · {revision.added.length} new ·{' '}
        {revision.dropped.length} dropped · {revision.calls.length} model call
        {revision.calls.length === 1 ? '' : 's'} ({tokens} tokens) · prompt {revision.promptVersion} ·{' '}
        {revision.hash}
      </p>
      {revision.issues.length > 0 && (
        <div role="alert">
          <h4>Validation issues (block approval)</h4>
          <ul>
            {revision.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {revision.flags.length > 0 && (
        <div className="admin-lessons-flags">
          <h4>Reviewer flags</h4>
          <ul>
            {revision.flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </div>
      )}
      <h4>Items written this turn</h4>
      <ul className="admin-rules admin-lessons-items">
        {revision.items.map((item) => (
          <ItemRow key={item.draftId} item={item} />
        ))}
      </ul>
      {revision.bank.items.length > 0 && <Preview url={previewUrl} />}
      {draft.review ? (
        <ReviewOutcome draft={draft} />
      ) : (
        draft.status !== 'generating' && (
          <ReviewForm draft={draft} revision={revision} latest={latest} onReviewed={onReviewed} />
        )
      )}
    </div>
  );
}

function ItemRow({ item }: { item: DraftItemVerdict }) {
  return (
    <li>
      <strong>
        {item.label || item.draftId} · {item.added ? 'Added' : item.ok ? 'Valid, not added' : 'Failed'}
      </strong>
      {item.issues.map((issue) => (
        <span key={issue} className="admin-lessons-issue">
          {issue}
        </span>
      ))}
      {item.flags.map((flag) => (
        <span key={flag}>Flag: {flag}</span>
      ))}
      {(item.spoken?.length || item.raw !== undefined) && (
        <details>
          <summary>{item.spoken?.length ? 'What Pip says' : 'Model output'}</summary>
          {item.spoken?.length ? (
            <ol>
              {item.spoken.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : (
            <pre>{JSON.stringify(item.raw, null, 1)}</pre>
          )}
        </details>
      )}
    </li>
  );
}

function Preview({ url }: { url: string }) {
  // Load the frame only when the disclosure opens.
  const [open, setOpen] = useState(false);
  return (
    <details
      className="admin-evidence"
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary>Preview as a lesson page</summary>
      {open && <PreviewFrame url={url} />}
    </details>
  );
}

/** The trusted renderer's page, sandboxed: no scripts, no same-origin access, no navigation. */
export function PreviewFrame({ url }: { url: string }) {
  return (
    <iframe
      className="admin-lessons-preview"
      title="Lesson preview"
      src={url}
      sandbox=""
      referrerPolicy="no-referrer"
      loading="lazy"
    />
  );
}

function ReviewOutcome({ draft }: { draft: DraftSnapshot }) {
  const review = draft.review;
  if (!review) return null;
  return (
    <div className="admin-confirm">
      <h3>{review.decision === 'approved' ? 'Approved' : 'Rejected'}</h3>
      <p>
        {review.note} · {review.by} · {date(review.at)}
      </p>
      {review.decision === 'approved' && (
        <>
          <p>
            <a href={lessonApi.exportUrl(draft.id)} download>
              Export the approved bank (JSON)
            </a>
          </p>
          <p className="admin-help">
            Then, in the repo: <code>pnpm learning:bank import ~/Downloads/{draft.objective}.json</code>, run{' '}
            <code>pnpm check</code>, and open a pull request. The bank reaches children only after that is
            merged and deployed.
          </p>
        </>
      )}
    </div>
  );
}

export function ReviewForm({
  draft,
  revision,
  latest,
  onReviewed,
}: {
  draft: DraftSnapshot;
  revision: DraftRevision;
  latest: boolean;
  onReviewed: (draft: DraftSnapshot) => void;
}) {
  const [note, setNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flagged = revision.flags.length > 0;
  const canApprove =
    latest && !revision.issues.length && revision.bank.items.length > 0 && (!flagged || acknowledged);
  async function decide(decision: 'approved' | 'rejected') {
    if (busy || !note.trim()) return;
    setBusy(true);
    setError('');
    try {
      onReviewed(
        await lessonApi.review(draft.id, {
          decision,
          note: note.trim(),
          revision: revision.hash,
          acknowledgeFlags: acknowledged,
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  return (
    <form
      className="admin-confirm"
      aria-label="Review this revision"
      aria-busy={busy}
      onSubmit={(e) => e.preventDefault()}
    >
      <h3>Review</h3>
      <p>
        Approving locks the draft and makes this revision’s bank exportable. Rejecting closes the draft.
        Either way, nothing changes for children until a bank is imported, reviewed in git and deployed.
      </p>
      {!latest && <p className="admin-help">Only the latest revision can be approved.</p>}
      <label>
        Note for the record
        <textarea
          required
          maxLength={1000}
          rows={2}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {flagged && (
        <label className="admin-check">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={busy}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          I have read the {revision.flags.length} reviewer flag{revision.flags.length === 1 ? '' : 's'} and
          checked the preview.
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="admin-actions">
        <button
          type="button"
          className="admin-primary"
          disabled={busy || !note.trim() || !canApprove}
          onClick={() => void decide('approved')}
        >
          Approve this revision
        </button>
        <button
          type="button"
          className="admin-danger"
          disabled={busy || !note.trim()}
          onClick={() => void decide('rejected')}
        >
          Reject the draft
        </button>
      </div>
    </form>
  );
}
