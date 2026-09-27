import type { RunDetail, RunSummary } from '@wwm/maze-agent';
export interface Availability {
  available: boolean;
  configured?: boolean;
  budget?: {
    enabled: boolean;
    dailyLimitMicros: number;
    spentMicros: number;
    reservedMicros: number;
    remainingMicros: number;
    resetsAt: string;
  };
  model: string;
  attempts: number;
  limit: number;
  archiveBytes?: number;
  archiveLimit?: number;
}
export class JevClient {
  constructor(readonly base = '/api/jev') {}
  get ownerPrefix() {
    return this.base === '/api/jev' ? 'jev-owner:' : 'jev-admin-owner:';
  }
  token = '';
  availability: Availability = { available: false, model: '', attempts: 0, limit: 600 };
  async connect() {
    const r = await fetch(`${this.base}/session`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? 'Start this page with pnpm dev:jev');
    this.token = data.token;
    this.availability = data;
    return data as Availability;
  }
  async request<T>(path: string, data?: unknown): Promise<T> {
    const r = await fetch(`${this.base}/${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        ...(this.base === '/api/jev' ? { 'X-Jev-Session': this.token } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const value = await r.json();
    if (!r.ok) throw new Error(value.error ?? 'Run archive unavailable');
    return value as T;
  }
  history(query = '', offset = 0) {
    return this.request<{ runs: RunSummary[]; total: number } & Availability>(
      `runs?q=${encodeURIComponent(query)}&offset=${offset}`,
    );
  }
  detail(id: string) {
    return this.request<RunDetail>(`runs/${id}`);
  }
}
