import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { Availability } from '../jev/client.ts';
import { adminRequest, errorMessage } from './api.ts';
import { type BudgetSnapshot, budgetPause } from './budget.ts';

const money = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;

export function JevSettings({
  budgetSnapshot,
  active = true,
}: {
  budgetSnapshot: BudgetSnapshot | null;
  active?: boolean;
}) {
  const [state, setState] = useState<Availability | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [limit, setLimit] = useState('0.00');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const value = await adminRequest<Availability>('/jev/settings', { signal });
        if (signal?.aborted) return;
        setState(value);
        setError('');
        if (!dirty) {
          setEnabled(value.budget?.enabled ?? false);
          setLimit(((value.budget?.dailyLimitMicros ?? 0) / 1e6).toFixed(2));
        }
      } catch (e) {
        if (!signal?.aborted) setError(errorMessage(e));
      }
    },
    [dirty],
  );
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    void refresh(abort.signal);
    const timer = setInterval(() => void refresh(abort.signal), 10000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [refresh, active]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await adminRequest<Availability>('/jev/settings', {
        method: 'POST',
        body: JSON.stringify({ enabled, dailyLimitCents: Math.round(Number(limit) * 100) }),
      });
      setState(value);
      setDirty(false);
      setNotice('Jev settings saved.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const budget = state?.budget;
  return (
    <section className="admin-jev" aria-labelledby="jev-settings-title">
      <div className="admin-section-heading">
        <h1 id="jev-settings-title">Jev maze player</h1>
        <span className="admin-status">
          {budgetPause(budgetSnapshot, 'jev') ||
            (!state
              ? 'Loading…'
              : !state.configured
                ? 'Provider not configured'
                : !budget?.enabled
                  ? 'Provider calls off'
                  : !state.available
                    ? 'Provider currently unavailable'
                    : 'Enabled for admins')}
        </span>
      </div>
      <p>
        Watch Jev play, inspect decisions, and replay saved runs. Access is restricted to signed-in
        administrators.
      </p>
      {budgetPause(budgetSnapshot, 'jev') && (
        <p className="admin-help">
          The shared service budget currently prevents Jev calls. Changing the provider setting below does not
          override that gate. <a href="#services">Review services &amp; budget</a>.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!state ? (
        <button type="button" onClick={() => void refresh()}>
          Retry Jev settings
        </button>
      ) : (
        <>
          {!state.configured && (
            <p className="admin-help">
              The server’s TypeSafe API key is not configured. Paid calls remain unavailable.
            </p>
          )}
          <form onSubmit={save} aria-label="Jev controls" aria-busy={busy}>
            <div className="admin-filters">
              <label className="admin-check">
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={enabled}
                  checked={enabled}
                  disabled={busy}
                  onChange={(e) => {
                    setEnabled(e.target.checked);
                    setDirty(true);
                  }}
                />
                Allow Jev provider calls
              </label>
              <label>
                Daily provider limit (USD)
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="0.01"
                  required
                  value={limit}
                  disabled={busy}
                  onChange={(e) => {
                    setLimit(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <button type="submit" disabled={busy || !dirty}>
                {busy ? 'Saving…' : 'Save Jev settings'}
              </button>
            </div>
          </form>
          {budget && (
            <dl className="admin-facts">
              <div>
                <dt>Estimated spend today</dt>
                <dd>{money(budget.spentMicros)}</dd>
              </div>
              <div>
                <dt>Reserved / uncertain calls</dt>
                <dd>{money(budget.reservedMicros)}</dd>
              </div>
              <div>
                <dt>Remaining today</dt>
                <dd>{money(budget.remainingMicros)}</dd>
              </div>
              <div>
                <dt>Next daily reset</dt>
                <dd>{new Date(budget.resetsAt).toLocaleString()} (midnight UTC)</dd>
              </div>
            </dl>
          )}
          <p className="admin-help">
            Disabling stops new provider calls; an in-flight call may finish. The cap covers this deployment’s
            estimated TypeSafe usage. Timed-out calls keep their reservation. Local pilot runs and hosting
            costs are separate.
          </p>
          <a href="/admin/jev">Open Jev spectator and run history →</a>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
