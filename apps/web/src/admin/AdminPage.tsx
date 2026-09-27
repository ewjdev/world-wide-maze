import type { AdminCatalogResponse, AdminRunDetail, ModerationStatus } from '@wwm/schema';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import '../pages/about/showcase.css';
import './admin.css';
import { adminApi, errorMessage } from './api.ts';
import { CaptureAttempts } from './CaptureAttempts.tsx';
import { JevSettings } from './JevSettings.tsx';
import { PolicyRules } from './PolicyRules.tsx';

const statusNames: Record<ModerationStatus, string> = {
  approved: 'Approved',
  pending_review: 'Pending review',
  blocked: 'Blocked',
};
type Action =
  | 'approved'
  | 'pending_review'
  | 'blocked'
  | 'block-url'
  | 'block-domain'
  | 'clear-url'
  | 'clear-domain'
  | 'refresh'
  | 'remove';
const actions: Record<Action, { label: string; description: string }> = {
  approved: {
    label: 'Approve run',
    description:
      'Make this retained run available, subject to URL and domain rules. Approval does not clear a block rule.',
  },
  pending_review: {
    label: 'Return to review',
    description: 'Keep this run unavailable while it is reviewed.',
  },
  blocked: {
    label: 'Block run',
    description: 'Stop serving this run. Other runs for this URL keep their existing decisions.',
  },
  'block-url': {
    label: 'Block exact URL',
    description: 'Stop serving every hosted run for this exact normalized URL, including future captures.',
  },
  'block-domain': {
    label: 'Block domain',
    description: 'Stop serving this domain and its subdomains, including other URLs and future captures.',
  },
  'clear-url': {
    label: 'Clear URL rule',
    description:
      'Clear this exact URL rule. Run decisions and domain rules still apply; deleted artifacts will not return.',
  },
  'clear-domain': {
    label: 'Clear domain rule',
    description:
      'Clear this domain rule. Individual URL and run decisions still apply; deleted artifacts will not return.',
  },
  refresh: {
    label: 'Request recapture',
    description:
      'Request a fresh capture for review. The current approved version stays available unless it is blocked.',
  },
  remove: {
    label: 'Remove artifacts',
    description:
      'Permanently delete this run’s stored artifacts. Its catalog and decision history remain. This cannot be undone.',
  },
};

function date(value: string) {
  return new Date(value).toLocaleString();
}
function Status({ status }: { status: ModerationStatus }) {
  return (
    <span className="admin-status" data-status={status}>
      {statusNames[status]}
    </span>
  );
}

export default function AdminPage() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ModerationStatus | ''>('pending_review');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [catalog, setCatalog] = useState<AdminCatalogResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminRunDetail | null>(null);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [showAttempts, setShowAttempts] = useState(false);
  const cursor = cursors[cursors.length - 1] ?? null;

  useEffect(() => {
    document.title = 'Content review · World Wide Maze';
  }, []);
  useEffect(() => {
    void revision; // A saved decision or explicit retry refreshes server state.
    const controller = new AbortController();
    setCatalog(null);
    setListError('');
    adminApi
      .catalog(search, status, cursor, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setCatalog(value);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setListError(errorMessage(error));
      });
    return () => controller.abort();
  }, [search, status, cursor, revision]);
  useEffect(() => {
    void revision; // A saved decision or explicit retry refreshes server state.
    const controller = new AbortController();
    setDetail(null);
    setDetailError('');
    if (selected)
      adminApi
        .detail(selected, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setDetail(value);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setDetailError(errorMessage(error));
        });
    return () => controller.abort();
  }, [selected, revision]);

  function filter(event: FormEvent) {
    event.preventDefault();
    setCursors([null]);
    setSelected(null);
    setSearch(query.trim());
    setRevision((value) => value + 1);
  }
  function updated(message: string) {
    setNotice(message);
    setRevision((value) => value + 1);
  }

  return (
    <div className="sc admin-page">
      <a className="sc-skip" href="#admin-main">
        Skip to content review
      </a>
      <header className="admin-mast">
        <a href="/">World Wide Maze</a>
        <span>Operator workspace</span>
      </header>
      <main id="admin-main" className="admin-main">
        <header className="admin-heading">
          <h1>Administration</h1>
          <p>Manage Jev, review saved mazes, and control what can be shared.</p>
        </header>
        <JevSettings />
        {notice && (
          <p className="admin-notice" role="status">
            {notice}
          </p>
        )}
        {catalog && (
          <button
            type="button"
            className="admin-rules-toggle"
            aria-expanded={showRules}
            onClick={() => setShowRules((value) => !value)}
          >
            {showRules ? 'Hide URL and domain policy' : 'Manage URL and domain policy'}
          </button>
        )}
        {showRules && catalog && <PolicyRules onUpdated={updated} />}
        {catalog && (
          <button
            type="button"
            className="admin-rules-toggle"
            aria-expanded={showAttempts}
            onClick={() => setShowAttempts((value) => !value)}
          >
            {showAttempts ? 'Hide capture attempts' : 'Inspect capture attempts'}
          </button>
        )}
        {showAttempts && catalog && (
          <CaptureAttempts
            onSelect={(id) => {
              setSelected(id);
              setShowAttempts(false);
            }}
          />
        )}
        <form className="admin-filters" onSubmit={filter} aria-label="Search maze catalog">
          <label className="admin-search">
            URL or host
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="example.com or a full URL"
            />
          </label>
          <label>
            Review status
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as ModerationStatus | '');
                setCursors([null]);
                setSelected(null);
              }}
            >
              <option value="">All statuses</option>
              <option value="pending_review">Pending review</option>
              <option value="approved">Approved</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
          <button type="submit">Search catalog</button>
        </form>
        <div className="admin-workspace">
          <section className="admin-catalog" aria-label="Catalog results" aria-busy={!catalog && !listError}>
            <div className="admin-section-heading">
              <h2>Saved mazes</h2>
              <span>Page {cursors.length}</span>
            </div>
            {listError ? (
              <div role="alert">
                <p>{listError}</p>
                <button type="button" onClick={() => setRevision((value) => value + 1)}>
                  Retry catalog
                </button>
              </div>
            ) : !catalog ? (
              <p role="status">Loading catalog…</p>
            ) : catalog.items.length === 0 ? (
              <p>No mazes match this search. Try another host or review status.</p>
            ) : (
              <ul className="admin-results">
                {catalog.items.map((item) => (
                  <li key={item.runId}>
                    <button
                      type="button"
                      className="admin-result"
                      aria-pressed={selected === item.runId}
                      onClick={() => {
                        setSelected(item.runId);
                        setNotice('');
                      }}
                    >
                      <span className="admin-result-title">
                        {item.title || item.host || 'Untitled capture'}
                      </span>
                      <span className="admin-url">{item.url}</span>
                      <Status status={item.status} />
                      <span className="admin-result-meta">
                        {date(item.createdAt)}
                        {item.curated ? ' · Curated' : ''}
                        {!item.artifactsAvailable ? ' · Artifacts removed' : ''}
                        {item.refreshRequested ? ' · Recapture requested' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <nav className="admin-pagination" aria-label="Catalog pages">
              <button
                type="button"
                disabled={cursors.length === 1 || !catalog}
                onClick={() => {
                  setCursors((pages) => pages.slice(0, -1));
                  setSelected(null);
                }}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!catalog?.nextCursor}
                onClick={() => {
                  if (catalog?.nextCursor) {
                    setCursors((pages) => [...pages, catalog.nextCursor]);
                    setSelected(null);
                  }
                }}
              >
                Next
              </button>
            </nav>
          </section>
          <section
            className="admin-detail"
            aria-label="Selected maze review"
            aria-busy={Boolean(selected && !detail && !detailError)}
          >
            {!selected ? (
              <div className="admin-empty">
                <h2>Select a maze to review</h2>
                <p>Capture evidence, policy rules, and decision history will appear here.</p>
              </div>
            ) : detailError ? (
              <div role="alert">
                <p>{detailError}</p>
                <button type="button" onClick={() => setRevision((value) => value + 1)}>
                  Retry review
                </button>
              </div>
            ) : !detail ? (
              <p role="status">Loading review evidence…</p>
            ) : (
              <RunReview key={detail.runId} run={detail} onUpdated={updated} />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function RunReview({ run, onUpdated }: { run: AdminRunDetail; onUpdated: (message: string) => void }) {
  const [action, setAction] = useState<Action | null>(null);
  const [ruleTarget, setRuleTarget] = useState<string | undefined>();
  return (
    <>
      <div className="admin-section-heading">
        <h2>{run.title || run.host || 'Untitled capture'}</h2>
        <Status status={run.status} />
      </div>
      <p className="admin-url">{run.url}</p>
      {run.submittedUrl && run.submittedUrl !== run.url && (
        <p className="admin-url">
          <strong>Originally submitted: </strong>
          {run.submittedUrl}
        </p>
      )}
      <dl className="admin-facts">
        <div>
          <dt>Captured</dt>
          <dd>{date(run.createdAt)}</dd>
        </div>
        <div>
          <dt>Availability</dt>
          <dd>{run.artifactsAvailable ? 'Artifacts retained' : 'Artifacts removed'}</dd>
        </div>
        <div>
          <dt>Evaluation</dt>
          <dd>
            {run.provider || 'Human review'} · {run.policyVersion || 'No policy version recorded'}
          </dd>
        </div>
        <div>
          <dt>Current reason</dt>
          <dd>{run.reason || 'No reason recorded'}</dd>
        </div>
      </dl>
      <h3>Capture evidence</h3>
      <p className="admin-help">
        Evidence may contain explicit or sensitive content. Open only what you need to review.
      </p>
      {run.artifactsAvailable ? (
        <details className="admin-evidence">
          <summary>Show screenshot and {run.textures.length} slice previews</summary>
          <Evidence run={run} />
        </details>
      ) : (
        <p>Evidence is no longer retained. Approval cannot restore deleted artifacts.</p>
      )}
      <h3>Run decision</h3>
      <div className="admin-actions">
        {(['approved', 'pending_review', 'blocked'] as const).map((value) => (
          <button
            type="button"
            key={value}
            disabled={Boolean(action) || (value === 'approved' && !run.artifactsAvailable)}
            onClick={() => setAction(value)}
          >
            {actions[value].label}
          </button>
        ))}
      </div>
      <h3>URL and domain rules</h3>
      {run.rules.length ? (
        <ul className="admin-rules">
          {run.rules.map((rule) => (
            <li key={`${rule.scope}:${rule.target}`}>
              <strong>
                {rule.blocked ? 'Blocked' : 'Cleared'} {rule.scope}
              </strong>
              <span className="admin-url">{rule.target}</span>
              <span>{rule.reason}</span>
              {rule.blocked && (
                <button
                  type="button"
                  disabled={Boolean(action)}
                  onClick={() => {
                    setRuleTarget(rule.target);
                    setAction(rule.scope === 'url' ? 'clear-url' : 'clear-domain');
                  }}
                >
                  Clear rule for {rule.target}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-help">No rules recorded for this URL or domain.</p>
      )}
      <div className="admin-actions">
        {(['block-url', 'block-domain'] as const).map((value) => (
          <button type="button" key={value} disabled={Boolean(action)} onClick={() => setAction(value)}>
            {actions[value].label}
          </button>
        ))}
      </div>
      <h3>Capture operations</h3>
      <div className="admin-actions">
        <button
          type="button"
          disabled={Boolean(action) || run.refreshRequested}
          onClick={() => setAction('refresh')}
        >
          {run.refreshRequested ? 'Recapture requested' : 'Request recapture'}
        </button>
        <button
          type="button"
          className="admin-danger"
          disabled={Boolean(action) || !run.artifactsAvailable}
          onClick={() => setAction('remove')}
        >
          Remove artifacts
        </button>
      </div>
      {action && (
        <DecisionForm
          run={run}
          action={action}
          ruleTarget={ruleTarget}
          onCancel={() => {
            setAction(null);
            setRuleTarget(undefined);
          }}
          onDone={(message) => {
            setAction(null);
            setRuleTarget(undefined);
            onUpdated(message);
          }}
        />
      )}
      <h3>Decision history</h3>
      {run.events.length ? (
        <ol className="admin-history">
          {run.events.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{event.action}</strong>
                <time dateTime={event.createdAt}>{date(event.createdAt)}</time>
              </div>
              <p>{event.reason}</p>
              <span>{event.actor}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="admin-help">No decisions have been recorded.</p>
      )}
    </>
  );
}

function Evidence({ run }: { run: AdminRunDetail }) {
  // Render images only after the disclosure opens; hidden evidence must not be fetched prematurely.
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current?.closest('details');
    const changed = () => setOpen(Boolean(element?.open));
    element?.addEventListener('toggle', changed);
    changed();
    return () => element?.removeEventListener('toggle', changed);
  }, []);
  return (
    <div ref={ref} className="admin-evidence-images">
      {open && (
        <>
          <figure>
            <img src={run.screenshotUrl} alt={`Full capture of ${run.host}`} referrerPolicy="no-referrer" />
            <figcaption>Analysis screenshot</figcaption>
          </figure>
          {run.textures.map((texture, index) => (
            <figure key={texture.slice}>
              <img
                src={texture.evidenceUrl}
                alt={`Capture slice ${index + 1} of ${run.host}`}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              <figcaption>Slice {index + 1}</figcaption>
            </figure>
          ))}
        </>
      )}
    </div>
  );
}

export function DecisionForm({
  run,
  action,
  ruleTarget,
  onCancel,
  onDone,
}: {
  run: AdminRunDetail;
  action: Action;
  ruleTarget?: string;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    form.current?.querySelector('textarea')?.focus();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim() || busy || !confirmed) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'approved' || action === 'pending_review' || action === 'blocked')
        await adminApi.decision(run.runId, { status: action, reason: reason.trim() });
      else if (action === 'refresh' || action === 'remove')
        await adminApi.operation(run.runId, action, reason.trim());
      else
        await adminApi.rule({
          scope: action.endsWith('url') ? 'url' : 'domain',
          target: ruleTarget ?? (action.endsWith('url') ? run.url : run.host),
          blocked: action.startsWith('block'),
          reason: reason.trim(),
        });
      onDone(`${actions[action].label}: saved for ${run.host}.`);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  return (
    <form
      ref={form}
      className="admin-confirm"
      onSubmit={submit}
      aria-label={`Confirm: ${actions[action].label}`}
      aria-busy={busy}
    >
      <h3>{actions[action].label}</h3>
      <p>{actions[action].description}</p>
      <p className="admin-url">
        <strong>Applies to: </strong>
        {ruleTarget ?? (action.endsWith('domain') ? run.host : run.url)}
      </p>
      <label>
        Reason for this action
        <textarea
          required
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={busy}
          rows={3}
        />
      </label>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={busy}
        />
        {action === 'remove'
          ? 'I understand that these artifacts will be permanently deleted.'
          : 'I have checked the target and want to apply this action.'}
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="admin-actions">
        <button
          type="submit"
          disabled={busy || !confirmed || !reason.trim()}
          className={action === 'remove' ? 'admin-danger' : 'admin-primary'}
        >
          {busy ? 'Saving…' : `Confirm ${actions[action].label.toLowerCase()}`}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
