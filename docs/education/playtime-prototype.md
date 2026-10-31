# Caregiver playtime prototype

Enable **Grown-ups: playtime** on a lesson, the learning home page, or the maze. Choose 5, 10, or 15 minutes and create a private 4–8 digit PIN. Repeat that PIN to start another session. Playtime is opt-in; existing general-purpose game use is unchanged until enabled.

The selected duration includes the final minute. Lessons and maze play share one absolute deadline on the same origin. Pauses, hints, navigation, refresh, background time, and profile switches do not create more time. The final minute shows a quiet message, offers spoken guidance when device speech is available and unmuted, stops decorative Pip motion, and lowers maze audio. Starting another lesson round or maze journey during closing ends the session. At expiry the simulation pauses, input is blocked, and a native dialog makes the underlying page inert. **All done** ends early without requiring an answer.

The ending lists recorded practice and reached maze goals, including partial work. It does not claim mastery or that an entire bridge was finished. **Hear Pip** repeats the closing invitation; speech respects either app's mute setting. Muted or unavailable speech retains the visible instructions. The final screen invites looking for a triangle away from the screen and has no replay offer. New sessions require the caregiver PIN.

## Scope and limits

This is a local, same-origin prototype. Production `/learn/` and maze routes share an origin; separate local dev ports do not. Browser storage contains a salted PIN hash, session timestamps and bounded practice descriptions, without a child identity. It is not synced to accounts or other devices and is not tamper-resistant parental control: clearing storage, changing browser/device, deliberate clock manipulation, or inspecting client code can bypass local enforcement. Three incorrect authorization attempts introduce a 30-second delay in that page; this is accidental-access friction, not robust authentication. Corrupt or inaccessible storage blocks play and requests caregiver attention.

Starting another session resets its recap and budget. Current lesson/maze state can continue in the same page; reload does not restore an unfinished round or maze position. Ending does not assert that unfinished state was saved. Existing learning evidence remains separate. Family usability, comprehension of the spoken directions, sensory preferences, and developmental suitability remain unverified, especially at age 3.

## Verification

- `pnpm exec vitest run --project @wwm/learning playtime` checks absolute deadlines, sticky expiry, PIN validation, early stopping, corrupt storage and opt-in behavior.
- `pnpm --filter @wwm/web build` includes education at `/learn/`.
- Serve the combined output with `pnpm --filter @wwm/web exec vite preview --host 127.0.0.1 --port 4188`, then `node apps/web/test/playtime-browser.mjs`. `WWM_PLAYTIME_E2E_BASE` overrides the origin. `node apps/web/test/playtime-maze-check.mjs` additionally enters an active maze and verifies expiry freezes its simulation ticks and timer, including a direct resume attempt. The Chromium script checks desktop/mobile lesson practice, closing, navigation to maze, expiry, refresh, cross-tab restart and early stop, incorrect PIN, no horizontal overflow and no page errors. Review screenshots are written to `/tmp/wwm-playtime-review/`.

The functional checks do not demonstrate improved learning or easier emotional transitions. See [the research brief](session-design-research-2026-10-28.md) for the proposed family observation.

## Hosted review preview

Automatic previews remain subject to repository policy. Explicit branch-only static previews use the `preview-check` job: repository type/lint checks, learning and education tests, static-host tests, and a configuration check rejecting production bindings. The preview job builds the combined site, runs both playtime browser scripts before publishing, verifies the hosted commit and smoke checks, then repeats both browser scripts against the hosted URL. Full PR CI remains required independently; a successful static preview is not evidence that the full PR suite passed. Production deployment still requires the original full `check` job.
