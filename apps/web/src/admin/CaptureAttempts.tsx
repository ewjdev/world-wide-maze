import type { AdminAttemptsResponse } from '@wwm/schema';
import { type FormEvent, useEffect, useState } from 'react';
import { adminRequest, errorMessage } from './api.ts';

export function CaptureAttempts({ onSelect }: { onSelect: (runId: string) => void }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [result, setResult] = useState<AdminAttemptsResponse | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const cursor = pages[pages.length - 1];
  useEffect(() => {
    void revision;
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: '25' });
    if (search) params.set('q', search);
    if (cursor) params.set('cursor', cursor);
    setResult(null);
    setError('');
    adminRequest<AdminAttemptsResponse>(`/attempts?${params}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, [search, cursor, revision]);
  function filter(event: FormEvent) {
    event.preventDefault();
    setSearch(query.trim());
    setPages([null]);
    setRevision((value) => value + 1);
  }
  return (
    <section className="admin-policy" aria-label="Capture attempts">
      <h2>Capture attempts</h2>
      <p className="admin-help">
        Inspect jobs and failures, including captures that never produced a saved maze. Times show the most
        recent update.
      </p>
      <form className="admin-filters" onSubmit={filter}>
        <label className="admin-search">
          Attempt URL
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Exact URL, or leave blank for all attempts"
          />
        </label>
        <button type="submit">Search attempts</button>
      </form>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            Retry attempts
          </button>
        </div>
      ) : !result ? (
        <p role="status">Loading capture attempts…</p>
      ) : result.items.length === 0 ? (
        <p>No capture attempts match this URL.</p>
      ) : (
        <ul className="admin-rules">
          {result.items.map((attempt) => (
            <li key={attempt.jobId}>
              <strong>{attempt.status}</strong>
              <span className="admin-url">{attempt.url}</span>
              <span>{attempt.reason || 'No failure reason recorded'}</span>
              <time dateTime={attempt.updatedAt}>{new Date(attempt.updatedAt).toLocaleString()}</time>
              <span className="admin-help">Job: {attempt.jobId}</span>
              {attempt.runId && (
                <button
                  type="button"
                  onClick={() => {
                    if (attempt.runId) onSelect(attempt.runId);
                  }}
                >
                  Review resulting maze
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <nav className="admin-pagination" aria-label="Attempt pages">
        <button
          type="button"
          disabled={pages.length === 1 || !result}
          onClick={() => setPages((value) => value.slice(0, -1))}
        >
          Previous attempts
        </button>
        <span>Page {pages.length}</span>
        <button
          type="button"
          disabled={!result?.nextCursor}
          onClick={() => {
            if (result?.nextCursor) setPages((value) => [...value, result.nextCursor]);
          }}
        >
          Next attempts
        </button>
      </nav>
    </section>
  );
}
