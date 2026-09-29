import { useCallback, useEffect, useRef, useState } from 'react';
import { adminRequest, errorMessage } from './api.ts';

export interface BudgetSnapshot {
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
export const services = [
  ['build', 'Website capture', 'Turn a submitted page into a new maze.'],
  ['write', 'Capture storage', 'Save new captured pages and maze files.'],
  ['read', 'Saved maze access', 'Load existing mazes and their assets.'],
  ['room', 'Phone pairing', 'Connect a phone controller to a game.'],
  ['moderation', 'Automated moderation', 'Use AI to review captured content.'],
  ['docent', 'Docent answers', 'Answer questions about World Wide Maze.'],
  ['jev', 'Jev maze player', 'Allow the AI maze player to make decisions.'],
  ['telemetry', 'Analytics forwarding', 'Send permitted usage events to PostHog.'],
  ['score', 'Score verification', 'Verify and save submitted scores.'],
  ['card', 'Share images', 'Render images for shared runs.'],
] as const;

/** Describes known budget gates, not provider readiness or remaining operation quotas. */
export function budgetPause(value: BudgetSnapshot | null, feature: string): string | null {
  if (!value) return 'Budget status unavailable';
  if (!value.initialized) return 'Reconciliation required';
  if (value.staticOnly) return 'All online services paused';
  if (value.disabled.includes(feature)) return 'Paused by operator';
  if (value.spent > 40_000_000 || (value.spent >= 40_000_000 && feature !== 'write'))
    return 'Monthly stop reached';
  if (value.spent >= 35_000_000 && ['build', 'moderation', 'jev', 'card', 'telemetry'].includes(feature))
    return 'Monthly reduction reached';
  if (feature === 'telemetry' && !value.telemetryReady) return 'Provider limit unverified';
  return null;
}

export function useAdminBudget() {
  const [value, setValue] = useState<BudgetSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const request = useCallback(async (body?: object, signal?: AbortSignal) => {
    if (pending.current && !signal) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await adminRequest<BudgetSnapshot>('/budget', {
        signal,
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      });
      if (signal?.aborted) return;
      setValue(next);
      if (body) setNotice('Budget settings saved.');
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted) {
        pending.current = false;
        setBusy(false);
      }
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void request(undefined, abort.signal);
    return () => abort.abort();
  }, [request]);
  return { value, error, busy, notice, request };
}
export type AdminBudget = ReturnType<typeof useAdminBudget>;
