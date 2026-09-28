import { useState } from 'react';
import { adminRequest, errorMessage } from './api.ts';

interface Snapshot {
  initialized: boolean;
  month: string;
  level: string;
  spent: number;
  storedBytes: number;
  staticOnly: boolean;
  telemetryReady: boolean;
  disabled: string[];
  daily: Record<string, number>;
  monthly: Record<string, number>;
}
const features = [
  'build',
  'docent',
  'moderation',
  'jev',
  'room',
  'telemetry',
  'score',
  'card',
  'read',
  'write',
];
export function CostControls() {
  const [value, setValue] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [spend, setSpend] = useState('');
  const [bytes, setBytes] = useState('');
  async function request(body?: object) {
    setBusy(true);
    setError('');
    try {
      const next = await adminRequest<Snapshot>(
        '/budget',
        body ? { method: 'POST', body: JSON.stringify(body) } : {},
      );
      setValue(next);
      setSpend(String(next.spent / 1_000_000));
      setBytes(String(next.storedBytes));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Cost controls">
      <button type="button" disabled={busy} onClick={() => void request()}>
        Load cost controls
      </button>
      {error && <p role="alert">{error}</p>}
      {value && (
        <>
          <h2>Monthly target: $50</h2>
          <p>
            {value.month}: {value.level}. Reserved: ${(value.spent / 1_000_000).toFixed(2)}. New work stops by
            $40; provider bills can differ.
          </p>
          <p>
            Every UTC month starts paused until spend and storage are reconciled. Include fixed fees, prior
            usage and any known excess over reservations. Never lower existing reservations.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void request({ spentMicros: Math.ceil(Number(spend) * 1_000_000), storedBytes: Number(bytes) });
            }}
          >
            <label>
              Reconciled total (USD)
              <input
                type="number"
                min={value.spent / 1_000_000}
                step="0.000001"
                required
                value={spend}
                onChange={(e) => setSpend(e.target.value)}
              />
            </label>
            <label>
              Measured stored bytes
              <input
                type="number"
                min="0"
                step="1"
                required
                value={bytes}
                onChange={(e) => setBytes(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              Save reconciliation
            </button>
          </form>
          <p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void request({ staticOnly: !value.staticOnly })}
            >
              {value.staticOnly ? 'Resume eligible services' : 'Pause online services'}
            </button>{' '}
            <a href="/play/practice?offline=1">Open static practice</a>
          </p>
          <fieldset disabled={busy}>
            <legend>Paused features</legend>
            {features.map((feature) => (
              <label key={feature} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={value.disabled.includes(feature)}
                  onChange={(e) =>
                    void request({
                      disabled: e.target.checked
                        ? [...value.disabled, feature]
                        : value.disabled.filter((x) => x !== feature),
                    })
                  }
                />
                {feature}
              </label>
            ))}
          </fieldset>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={value.telemetryReady}
              onChange={(e) => void request({ telemetryReady: e.target.checked })}
            />
            I verified the PostHog billing limit and remaining allowance for this organization.
          </label>
          <details>
            <summary>Admission counters (UTC)</summary>
            <pre>{JSON.stringify({ daily: value.daily, monthly: value.monthly }, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
