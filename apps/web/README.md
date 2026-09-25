# @wwm/web

Desktop game shell and phone controller pages (Vite + React + react-router).

**Status:** scaffold (Phase 02). Owners: Phase 08 (shell, routes, HUD), Phase 06 (`src/controller/`), Phase 10 (history/museum pages).

Routes: `/` (home), `/play/:stageId`, `/c/:code` (phone controller, no desktop chrome), `/about`.

- Dev: `pnpm --filter web dev` (http://localhost:5173, `/api` proxied to `wrangler dev` on :8787), or `pnpm dev` at the root for web + worker.
- Build: `pnpm --filter web build`.
- Tests: `pnpm test` at the root (routes are rendered with `react-dom/server` + a memory router).
