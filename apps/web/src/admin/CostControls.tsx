import { useEffect, useState } from 'react';
import { type AdminBudget, budgetPause, services } from './budget.ts';

export function CostControls({ budget }: { budget: AdminBudget }) {
  const { value, error, busy, notice, request } = budget;
  const [spend, setSpend] = useState('');
  const [bytes, setBytes] = useState('');
  useEffect(() => {
    if (!value) return;
    setSpend(String(value.spent / 1_000_000));
    setBytes(String(value.storedBytes));
  }, [value]);
  return (
    <section className="admin-costs" aria-label="Cost controls">
      <div className="admin-section-heading">
        <div>
          <h1>Services &amp; budget</h1>
          <p className="admin-help">Control new work and reconcile the monthly allowance.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void request()}>
          {busy ? 'Refreshing…' : 'Refresh budget'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}
      {!value && !error && <p role="status">Loading cost controls…</p>}
      {value && (
        <>
          <div className="admin-budget-summary">
            <div>
              <h2>
                Monthly allowance <span className="admin-help">{value.month} · UTC</span>
              </h2>
              <p>
                <strong>${(value.spent / 1_000_000).toFixed(2)} reserved</strong> of a $50 operating target
              </p>
              <p className="admin-help">
                Reservations include fixed costs and attempted work. Provider bills may differ.
              </p>
              <ul className="admin-thresholds">
                <li>$25 · Review usage</li>
                <li>$35 · Reduce services</li>
                <li>$40 · Stop paid work</li>
              </ul>
            </div>
            <div className="admin-global-control">
              <strong>
                {!value.initialized
                  ? 'Reconciliation required'
                  : value.staticOnly
                    ? 'Online services paused'
                    : 'Individual service controls apply'}
              </strong>
              <p className="admin-help">Static practice stays available when online services pause.</p>
              <button
                type="button"
                className={value.staticOnly ? 'admin-primary' : 'admin-danger'}
                disabled={busy || !value.initialized}
                onClick={() => void request({ staticOnly: !value.staticOnly })}
              >
                {value.staticOnly ? 'Resume eligible services' : 'Pause online services'}
              </button>
              <a href="/play/practice?offline=1">Open static practice</a>
            </div>
          </div>
          <details className="admin-reconcile" open={!value.initialized}>
            <summary>Reconcile spend and storage</summary>
            <p className="admin-help">
              Every UTC month starts paused. Include fixed fees, prior spend and uncertainty. Existing
              reservations cannot be lowered.
            </p>
            <form
              className="admin-reconcile-form"
              onSubmit={(event) => {
                event.preventDefault();
                void request({
                  spentMicros: Math.ceil(Number(spend) * 1_000_000),
                  storedBytes: Number(bytes),
                });
              }}
            >
              <label>
                Reconciled total (USD)
                <input
                  type="number"
                  min={value.spent / 1_000_000}
                  step="0.000001"
                  required
                  disabled={busy}
                  value={spend}
                  onChange={(event) => setSpend(event.target.value)}
                />
              </label>
              <label>
                Measured stored bytes
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  disabled={busy}
                  value={bytes}
                  onChange={(event) => setBytes(event.target.value)}
                />
                <span className="admin-help">
                  Current reservation: {(value.storedBytes / 1_000_000).toFixed(2)} MB
                </span>
              </label>
              <button type="submit" className="admin-primary" disabled={busy}>
                Save reconciliation
              </button>
            </form>
          </details>
          <h2>Service controls</h2>
          <p className="admin-help">
            Pausing a service stops new work immediately. Enabling a service still requires available quotas,
            provider configuration and any content review.
          </p>
          <div className="admin-service-list">
            {services.map(([key, name, description]) => {
              const paused = budgetPause(value, key);
              const enabled = !value.disabled.includes(key);
              return (
                <div className="admin-service" key={key}>
                  <div>
                    <strong>{name}</strong>
                    <p>{description}</p>
                  </div>
                  <span className="admin-status" data-status={paused ? 'pending_review' : 'approved'}>
                    {paused || 'Enabled in budget'}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`${enabled ? 'Pause' : 'Enable'} ${name}`}
                    onClick={() =>
                      void request({
                        disabled: enabled
                          ? [...value.disabled, key]
                          : value.disabled.filter((item) => item !== key),
                      })
                    }
                  >
                    {enabled ? 'Pause' : 'Enable'}
                  </button>
                </div>
              );
            })}
          </div>
          <label className="admin-check admin-provider-check">
            <input
              type="checkbox"
              disabled={busy}
              checked={value.telemetryReady}
              onChange={(event) => void request({ telemetryReady: event.target.checked })}
            />
            I verified the PostHog billing limit and remaining allowance for this organization.
          </label>
          <details className="admin-counters">
            <summary>Usage counters · UTC</summary>
            <p className="admin-help">
              Reserved operations, not successful completions. Storage writes are counted in bytes.
            </p>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Service</th>
                    <th scope="col">Today</th>
                    <th scope="col">This month</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map(([key, name]) => (
                    <tr key={key}>
                      <th scope="row">{name}</th>
                      <td>{(value.daily[key] ?? 0).toLocaleString()}</td>
                      <td>{(value.monthly[key] ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>Raw counters</summary>
              <pre>{JSON.stringify({ daily: value.daily, monthly: value.monthly }, null, 2)}</pre>
            </details>
          </details>
        </>
      )}
    </section>
  );
}
