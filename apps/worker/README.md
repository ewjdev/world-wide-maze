# @wwm/worker

Cloudflare Worker: capture/stage/score HTTP API (contracts §7), Browser Rendering captures, and the `Room`
Durable Object relay (contracts §6).

**Status:** scaffold (Phase 02). Owners: Phase 07 (API, capture, storage), Phase 06 (`src/room.ts` only).

## Bindings (`wrangler.jsonc`)
| Binding | Type | Purpose |
|---|---|---|
| `STAGES` | R2 | stage JSON + textures |
| `DB` | D1 | scores, jobs, stage metadata |
| `CACHE` | KV | normalized URL → stageId cache |
| `BROWSER` | Browser Rendering | headless Chromium for captures |
| `ROOM` | Durable Object (`Room`, SQLite) | 6-digit room WebSocket relay |

All IDs are **placeholders**; no Cloudflare resources have been created. Local dev uses Miniflare simulations.

## Commands
- Dev: `pnpm --filter worker dev` (http://localhost:8787, try `/api/health`).
- Regenerate binding/runtime types after editing `wrangler.jsonc`: `pnpm --filter worker types` (writes `worker-configuration.d.ts`, committed).
- Tests: `pnpm test` at the root. `src/router.ts` has no `cloudflare:*` imports so it runs under plain Vitest; Phase 07 may add `@cloudflare/vitest-pool-workers` for binding-level tests.
