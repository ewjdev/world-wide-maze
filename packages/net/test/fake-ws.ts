import type { WebSocketLike } from '../src/connection.ts';

/** In-memory WebSocket double. A `FakeRelay` wires host and controller sockets like the Room DO would. */
export class FakeSocket implements WebSocketLike {
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: (string | ArrayBuffer)[] = [];
  onSend: ((data: string | ArrayBuffer) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== 1) throw new Error('not open');
    const d = typeof data === 'string' || data instanceof ArrayBuffer ? data : (data.buffer as ArrayBuffer);
    this.sent.push(d);
    this.onSend?.(d);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  // test helpers
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(data: string | ArrayBuffer | object): void {
    const d = typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data);
    this.onmessage?.({ data: d });
  }
  serverClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  sentJson(): Record<string, unknown>[] {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
}

export function socketFactory() {
  const sockets: FakeSocket[] = [];
  const create = (url: string) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  return { sockets, create, last: () => sockets[sockets.length - 1] as FakeSocket };
}
