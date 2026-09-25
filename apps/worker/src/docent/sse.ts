/**
 * Docent SSE framing, the same shape as the build-job stream (job-events.ts): the SSE `event:` name is the
 * `DocentEvent` type and `data:` is the rest as JSON.
 */
import type { DocentEvent } from '@wwm/schema';

export function docentFrame(e: DocentEvent): string {
  const { type, ...data } = e;
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const DOCENT_SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
  'x-accel-buffering': 'no',
} as const;

/** A complete (already known) event list as an SSE response, e.g. an error or a cached answer. */
export function sseOnce(events: DocentEvent[], status = 200, headers: Record<string, string> = {}): Response {
  return new Response(events.map(docentFrame).join(''), {
    status,
    headers: { ...DOCENT_SSE_HEADERS, ...headers },
  });
}

/**
 * A live SSE response. `run` gets `emit` and an AbortSignal that fires when the client goes away (a failed
 * write); the stream closes when `run` settles. Returns the response and `run`'s promise (for waitUntil).
 */
export function sseLive<T>(
  run: (emit: (e: DocentEvent) => void, signal: AbortSignal) => Promise<T>,
  upstream?: AbortSignal,
): { response: Response; done: Promise<T | undefined> } {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const ac = new AbortController();
  upstream?.addEventListener('abort', () => ac.abort(), { once: true });
  const emit = (e: DocentEvent) => {
    if (ac.signal.aborted) return;
    writer.write(enc.encode(docentFrame(e))).catch(() => ac.abort());
  };
  const done = run(emit, ac.signal)
    .catch((err: unknown) => {
      emit({
        type: 'error',
        code: 'DOCENT_UNAVAILABLE',
        message: 'The docent couldn’t answer just now. Please try again in a moment.',
      });
      throw err;
    })
    .finally(() => writer.close().catch(() => {}));
  return {
    response: new Response(readable, { headers: DOCENT_SSE_HEADERS }),
    done: done.catch(() => undefined),
  };
}
