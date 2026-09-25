/**
 * Worker entry (Phase 02 scaffold). Phase 07 owns the API; Phase 06 owns src/room.ts.
 */

import { handleBasic } from './router.ts';
import { handleRooms } from './routes/rooms.ts';

export { Room } from './room.ts';

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const rooms = await handleRooms(request, env); // Phase 06
    if (rooms) return rooms;
    return handleBasic(request) ?? Response.json({ error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
