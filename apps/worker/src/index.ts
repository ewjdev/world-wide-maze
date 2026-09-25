/**
 * Worker entry (Phase 02 scaffold). Phase 07 owns the API; Phase 06 owns src/room.ts.
 */
import { handleBasic } from './router.ts';

export { Room } from './room.ts';

export default {
  async fetch(request, _env, _ctx): Promise<Response> {
    return handleBasic(request) ?? Response.json({ error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
