/**
 * Job progress as server-sent events (task 5, contracts §7/§9): the SSE `event:` name is the JobEvent
 * `type`, `data:` is the rest as JSON. A hub replays everything so far to each new subscriber, streams live
 * events, and ends the stream after the terminal `done`/`error`.
 */
import type { JobEvent } from '@wwm/schema';

export function sseFrame(e: JobEvent): string {
  const { type, ...data } = e;
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function isTerminal(e: JobEvent): boolean {
  return e.type === 'done' || e.type === 'error';
}

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
  'x-accel-buffering': 'no',
} as const;

type Listener = (e: JobEvent) => void;

export class JobEventHub {
  private readonly listeners = new Set<Listener>();
  readonly events: JobEvent[];

  constructor(initial: JobEvent[] = []) {
    this.events = [...initial];
  }

  get finished(): boolean {
    return this.events.some(isTerminal);
  }

  push(e: JobEvent): void {
    if (this.finished) return; // exactly one terminal event per job
    this.events.push(e);
    for (const l of this.listeners) l(e);
  }

  /** An SSE response: replay, then live events until a terminal one (or the client goes away). */
  stream(opts: { keepAliveMs?: number } = {}): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    let closed = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      this.listeners.delete(onEvent);
      writer.close().catch(() => {});
    };
    const write = (s: string) => {
      if (!closed) writer.write(enc.encode(s)).catch(close);
    };
    const onEvent: Listener = (e) => {
      write(sseFrame(e));
      if (isTerminal(e)) close();
    };
    write(': wwm job stream\n\n');
    for (const e of this.events) onEvent(e);
    if (!closed) {
      this.listeners.add(onEvent);
      ping = setInterval(() => write(': keep-alive\n\n'), opts.keepAliveMs ?? 15_000);
    }
    return new Response(readable, { headers: SSE_HEADERS });
  }
}

/** Parse an SSE body back into JobEvents (tests and the dev CLI). */
export function parseSse(text: string): JobEvent[] {
  const out: JobEvent[] = [];
  for (const block of text.split('\n\n')) {
    let type = '';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) type = line.slice(7);
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (type && data) out.push({ type, ...JSON.parse(data) } as JobEvent);
  }
  return out;
}
