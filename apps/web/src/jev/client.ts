import type { RunDetail, RunSummary } from '@wwm/maze-agent';
export interface Availability {
  available: boolean;
  model: string;
  attempts: number;
  limit: number;
  archiveBytes?: number;
  archiveLimit?: number;
}
export class JevClient {
  token = '';
  availability: Availability = { available: false, model: '', attempts: 0, limit: 600 };
  async connect() {
    const r = await fetch('/api/jev/session');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? 'Start this page with pnpm dev:jev');
    this.token = data.token;
    this.availability = data;
    return data as Availability;
  }
  async request<T>(path: string, data?: unknown): Promise<T> {
    const r = await fetch(`/api/jev/${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        'X-Jev-Session': this.token,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const value = await r.json();
    if (!r.ok) throw new Error(value.error ?? 'Local archive unavailable');
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
