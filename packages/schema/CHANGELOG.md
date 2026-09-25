# @wwm/schema changelog

Contract version = `CONTRACT_VERSION` in `src/constants.ts`. Only the orchestrator bumps it (after a Contract Change Request).

## 0.1.0 (2026-09-25, Phase 02)
Initial implementation of `plans/contracts.md` v0.1.0.
- All §1–§7 types, constants, and the §7 error codes.
- Zod schemas for every type, `parseStage`, `parseCapture`, `parseControlMessage`, and `validateStage` (every §3 invariant plus the consistency rules; see README).
- `space.ts` (`pageToWorld`/`worldToPage`), `rng.ts` (mulberry32 plus `fork(label)`), and the 12-byte INPUT codec.
- Interpretations recorded as Contract Change Requests in `docs/build-log/phase-02.md`: ring-orientation definition, `|`-joined id hashing, the `JobEvent` SSE shape, extra derived constants, and the extra validation rules (bridge endpoint levels, flat ⇔ equal levels, guardrail gaps at bridge mouths, start/goal inside their island).
