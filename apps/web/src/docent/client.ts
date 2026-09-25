/**
 * Client for `POST /api/docent` (contracts §10.3). The answer arrives as server-sent events on a POST, so it is
 * read from the fetch body stream (EventSource can only GET). Frames: `event: <type>` + `data: <json>`.
 */
import type { DocentEvent, DocentRequest } from '@wwm/schema';

export class DocentHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DocentHttpError';
  }
}

/** Parses complete SSE frames out of `buffer`; returns the events and the unfinished rest. */
export function parseFrames(buffer: string): { events: DocentEvent[]; rest: string } {
  const events: DocentEvent[] = [];
  const frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = frames.pop() ?? '';
  for (const frame of frames) {
    let type = '';
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!type) continue;
    try {
      events.push({ type, ...(data ? (JSON.parse(data) as object) : {}) } as DocentEvent);
    } catch {
      // a malformed frame is skipped
    }
  }
  return { events, rest };
}

export interface StreamOptions {
  signal?: AbortSignal;
  onEvent: (e: DocentEvent) => void;
  fetch?: typeof fetch;
  endpoint?: string;
}

export async function streamDocent(req: DocentRequest, opts: StreamOptions): Promise<void> {
  const f = opts.fetch ?? fetch;
  const res = await f(opts.endpoint ?? '/api/docent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(req),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  // DOCENT errors come as SSE whatever the status (429/503); anything else is a transport failure.
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream') || !res.body)
    throw new DocentHttpError(res.status, `docent request failed (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = parseFrames(buffer + value);
    buffer = parsed.rest;
    for (const e of parsed.events) opts.onEvent(e);
  }
  const tail = parseFrames(`${buffer}\n\n`);
  for (const e of tail.events) opts.onEvent(e);
}
