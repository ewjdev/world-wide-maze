import type {
  AdminCatalogResponse,
  AdminDecisionRequest,
  AdminRuleRequest,
  AdminRunDetail,
  ModerationStatus,
} from '@wwm/schema';

export class AdminError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Access's HttpOnly session cookie is the only browser credential. Never persist evidence or tokens. */
export async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw new AdminError(
      response.status === 200 ? 401 : response.status,
      'Your operator session could not be verified.',
    );
  }
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new AdminError(response.status, body.error || 'The request failed.');
  return body;
}

export const adminApi = {
  catalog: (q: string, status: ModerationStatus | '', cursor: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q, status, limit: '25' });
    if (cursor) params.set('cursor', cursor);
    return adminRequest<AdminCatalogResponse>(`/catalog?${params}`, { signal });
  },
  detail: (id: string, signal?: AbortSignal) =>
    adminRequest<AdminRunDetail>(`/runs/${encodeURIComponent(id)}`, { signal }),
  decision: (id: string, body: AdminDecisionRequest) =>
    adminRequest(`/runs/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify(body) }),
  rule: (body: AdminRuleRequest) => adminRequest('/rules', { method: 'POST', body: JSON.stringify(body) }),
  operation: (id: string, action: 'refresh' | 'remove', reason: string) =>
    adminRequest(`/runs/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof AdminError) {
    if (error.status === 401 || error.status === 403)
      return 'Operator access required. Sign in through the configured Cloudflare Access application, then reload this page.';
    if (error.status === 503)
      return 'Administration is unavailable. Check the Access configuration and service availability, then retry.';
    return error.message;
  }
  return 'Could not reach administration. Check your connection and operator session, then retry.';
}
