# Mazify extension: distribution and release plan

Assessed 2026-09-26 against checkout `0a0b941` and https://wwm.ewj.dev/mazify.

## Finding

The extension already exists. Reuse `apps/extension`; do not rebuild Phase 14.
The public installation path is incomplete: the live page instructs visitors to download
the extension folder but exposes neither a download link nor a store link.
`apps/extension/README.md` says it is not published, and `STORE_LISTING.md` is a draft.
Store-account submission status was not independently checked.

Verified during this assessment:

- Production-origin build succeeds with
  `pnpm --filter @wwm/extension build --origin https://wwm.ewj.dev`.
- Outputs: `apps/extension/dist/chrome/` and
  `apps/extension/dist/wwm-maze-this-page-0.1.0.zip`.
- Capture and web receiver unit tests pass: 54 tests across two files.
- Source includes screenshot stitching, DOM extraction, progress/errors, local game handoff,
  client-side maze construction, bookmarklet fallback, and explicit sharing.
- Phase 14's build log records earlier local browser E2E success. That is historical evidence;
  neither browser E2E nor the production extension-to-game flow was rerun for this assessment.

## 1. Make installation possible

Owner: extension/release engineering.

- Add a repeatable release build that explicitly targets `https://wwm.ewj.dev`;
  the current build defaults to localhost when no origin is supplied.
- Publish a versioned ZIP through the existing site's asset pipeline or a repository release,
  choosing one canonical download location. Record version, source revision and SHA-256.
- Update `apps/web/src/local-capture/MazifyPage.tsx` and its English/Japanese strings:
  add a real download button, label this as a developer preview, and explain unzip →
  Developer mode → Load unpacked → select the folder containing `manifest.json`.
- Explain unpacked-extension updates and browser restrictions. Keep browser support claims
  limited to what is verified; Firefox remains experimental.

Acceptance: a visitor starting at `/mazify` can obtain the exact release without a checkout,
install it, and see the correct production game address. The download returns a valid ZIP,
not the SPA fallback HTML. A release check rejects localhost as the production default.

## 2. Verify the release against the deployed game

Owner: extension/web engineering, with a human desktop-browser check.

- Run the existing extension E2E suite and the repository checks required for release.
- Test the packaged build against production using public or synthetic pages: short and long
  pages, fixed/sticky headers, lazy-loaded content, and an app with an inner scroll container.
- Exercise a real toolbar click at display DPR 1 and 2. Verify capture → maze → keyboard play,
  page/scroll restoration after success and failure, popup closure, tab switching, and retry.
- Inspect network traffic to confirm capture content is not uploaded before Share. Use a
  synthetic capture for the explicit Share test, then open its link in a fresh session.
- Audit every local-run share action. The Phase 14 log reports a result-screen link that could
  point to `/play/local`; confirm current behavior and route all local sharing through upload.
- Treat inner-scroll viewport-only captures and sticky-element omissions as explicit limits
  until fixed. Prevent misleading whole-page success claims when capture is partial.

Acceptance: the downloaded release produces a playable maze on the deployed game; no unrelated
tab is captured; errors restore the source page; shared links work outside the capturing session.
Record browser versions, display scale and remaining limits separately from unit-test results.

## 3. Prepare the normal installation path

Owner: engineering prepares artifacts; project owner supplies the store account and submission.

- Finalize `apps/extension/STORE_LISTING.md`, production privacy URL, screenshots and permission
  explanations. Reconcile data-use disclosures with actual screenshot/DOM handoff, optional
  uploads, and website telemetry; do not assume a blanket "no data collected" answer is valid.
- Decide whether custom game-origin settings belong in the public release. Retaining them
  requires accurate optional-permission disclosures; removing them narrows the public package.
- Submit the verified ZIP through the owner's Chrome Web Store account when authorized.
- After approval, make the verified store listing the primary `/mazify` action, retaining
  manual installation as a secondary developer option.

Acceptance: installation from the published listing works in a clean Chrome profile and the
listing, manifest, privacy copy and live page describe the same version and behavior.

## Rollout and fallback

Ship the developer preview download first, then store installation after review. Keep the
previous verified version and checksum available for rollback. If capture or privacy checks
fail, withdraw the affected download/link and show a clear unavailable state. Preserve the
bookmarklet as a separately qualified sketch-mode option, not proof that the extension works.

This document is a plan. No site deployment, store submission or product-code changes were
made during the assessment; the production-targeted build is local only.
