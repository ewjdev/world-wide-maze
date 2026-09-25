/**
 * Room Durable Object — STUB created by Phase 02 so the binding exists. Phase 06 owns this file and
 * implements the 6-digit room WebSocket relay (contracts §6).
 */
import { DurableObject } from 'cloudflare:workers';

export class Room extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return Response.json({ error: 'Room relay not implemented yet (Phase 06)' }, { status: 501 });
  }
}
