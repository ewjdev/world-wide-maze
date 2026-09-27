import type { AdminPolicyRule, AdminRuleRequest } from '@wwm/schema';
import { type FormEvent, useEffect, useState } from 'react';
import { adminApi, adminRequest, errorMessage } from './api.ts';

/** Rules can be created before a URL has ever been captured. */
export function PolicyRules({ onUpdated }: { onUpdated: (message: string) => void }) {
  const [rules, setRules] = useState<AdminPolicyRule[] | null>(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<AdminRuleRequest['scope']>('url');
  const [target, setTarget] = useState('');
  const [blocked, setBlocked] = useState(true);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    void revision;
    const controller = new AbortController();
    adminRequest<{ items: AdminPolicyRule[] }>('/rules', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setRules(result.items);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, [revision]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !confirmed || !target.trim() || !reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await adminApi.rule({ scope, target: target.trim(), blocked, reason: reason.trim() });
      onUpdated(`${blocked ? 'Blocked' : 'Cleared rule for'} ${target.trim()}.`);
      setConfirmed(false);
      setReason('');
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-policy" aria-label="Manage all policy rules">
      <h2>URL and domain policy</h2>
      <p className="admin-help">
        Block a URL before its first capture, or clear an existing rule. Clearing a rule leaves individual run
        decisions in place.
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setError('');
              setRevision((value) => value + 1);
            }}
          >
            Retry rules
          </button>
        </div>
      )}
      <form
        className="admin-rule-form"
        onSubmit={submit}
        aria-label="Set URL or domain rule"
        aria-busy={busy}
      >
        <label>
          Rule scope
          <select
            value={scope}
            disabled={busy}
            onChange={(event) => {
              setScope(event.target.value as AdminRuleRequest['scope']);
              setConfirmed(false);
            }}
          >
            <option value="url">Exact URL</option>
            <option value="domain">Domain and subdomains</option>
          </select>
        </label>
        <label>
          Rule target
          <input
            required
            value={target}
            disabled={busy}
            placeholder={scope === 'url' ? 'https://example.com/page' : 'example.com'}
            onChange={(event) => {
              setTarget(event.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <label>
          Rule action
          <select
            value={blocked ? 'block' : 'clear'}
            disabled={busy}
            onChange={(event) => {
              setBlocked(event.target.value === 'block');
              setConfirmed(false);
            }}
          >
            <option value="block">Block</option>
            <option value="clear">Clear rule</option>
          </select>
        </label>
        <label className="admin-rule-wide">
          Rule reason
          <textarea
            required
            maxLength={1000}
            rows={2}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label className="admin-check admin-rule-wide">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I have checked this {scope === 'domain' ? 'domain and its subdomains' : 'exact URL'} and want to{' '}
          {blocked ? 'block it' : 'clear its rule'}.
        </label>
        <button type="submit" disabled={busy || !confirmed || !target.trim() || !reason.trim()}>
          {busy ? 'Saving rule…' : 'Confirm rule change'}
        </button>
      </form>
      <h3>Recorded rules</h3>
      {!rules ? (
        <p role="status">Loading policy rules…</p>
      ) : rules.length === 0 ? (
        <p>No policy rules recorded.</p>
      ) : (
        <ul className="admin-rules">
          {rules.map((rule) => (
            <li key={`${rule.scope}:${rule.target}`}>
              <strong>
                {rule.blocked ? 'Blocked' : 'Cleared'} {rule.scope}
              </strong>
              <span className="admin-url">{rule.target}</span>
              <span>{rule.reason}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setScope(rule.scope);
                  setTarget(rule.target);
                  setBlocked(!rule.blocked);
                  setConfirmed(false);
                  setReason('');
                }}
              >
                Prepare to {rule.blocked ? 'clear' : 'block'} {rule.target}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
