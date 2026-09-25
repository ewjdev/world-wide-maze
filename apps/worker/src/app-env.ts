import type { Services } from './config.ts';

/** Hono environment shared by every route module (Phase 06/10 route files use it too). */
export interface AppEnv {
  Bindings: Env;
  Variables: { services: Services; ip: string };
}
