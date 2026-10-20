/**
 * Static HTML for the family account pages (Phase 31 M3), generated at build time like every other page:
 * `/account/` (sign in, passkeys, child devices, export, delete) and `/account/verify` (the emailed link's
 * landing page; the token travels in the URL fragment, so it never reaches a server log). `account.ts` enhances
 * both. Everything is optional: lessons and the Progress page work without an account.
 */
import type { LearningPath } from '@wwm/learning';
import { shell } from './render.ts';

export const PRIVACY_NOTICE_URL =
  'https://github.com/ewjdev/world-wide-maze/blob/main/docs/launch/learning-privacy.md';

/** What the account keeps, in the page itself (the full draft notice is linked). */
export function privacySummaryHtml(): string {
  return `<details class="account-privacy" id="privacy"><summary>What a family account keeps, and why</summary>
    <ul>
      <li><strong>Your email address</strong>, to send sign-in links. <strong>Passkeys</strong> are stored as public keys only.</li>
      <li>For each child: <strong>a nickname, a Pip colour and, if you choose, an age band</strong> (4, 5 or 6). No full name, birth date, photo, voice, school or location.</li>
      <li><strong>Practice records</strong>: which lesson round was solved, on the first try or after a retry, how much help was used, and roughly how long it took. No free text and no recordings.</li>
      <li><strong>Linked devices</strong>: the name you give each one and when it was last used.</li>
    </ul>
    <p>It is used only to show your family its own progress. No ads, no analytics, no selling or sharing. Download everything or delete the account at any time, from this page. A family that doesn’t use the account for 24 months is deleted automatically.</p>
    <p class="small">This notice is a draft under review. <a href="${PRIVACY_NOTICE_URL}">Read the full draft privacy notice</a>.</p>
  </details>`;
}

export function accountPage(path: LearningPath): string {
  return shell(
    'Family account',
    `<div class="account-layout">
  <section class="account-intro" aria-labelledby="account-title">
    <h1 id="account-title">Family account</h1>
    <p class="lead">Keep each child’s practice across your family’s devices. It’s optional: every lesson works without it.</p>
    <p class="save-state" id="account-status" role="status">Checking this browser…</p>
  </section>
  <noscript><p>Family accounts need JavaScript.</p></noscript>
  <section class="account-panel" id="account-unavailable" hidden><h2>Not available yet</h2><p>Family accounts aren’t open here yet. Lessons and progress on this device work as before.</p></section>

  <div class="account-columns" id="signed-out" hidden>
    <section class="account-panel" aria-labelledby="sign-in-heading">
      <h2 id="sign-in-heading">Grown-up sign in</h2>
      <form id="email-form" novalidate>
        <label for="email">Your email</label>
        <p class="field-help" id="email-help">We email you a link that signs you in. It works once, for 15 minutes. No password.</p>
        <input type="email" id="email" name="email" autocomplete="email" maxlength="254" required aria-describedby="email-help">
        <label class="consent" for="consent"><input type="checkbox" id="consent" name="consent"><span>I’m the parent or guardian of the children who will use this, and I agree to the <a href="#privacy">privacy notice</a>. <span class="field-help">Needed to create your family account.</span></span></label>
        <div class="turnstile" id="turnstile"></div>
        <button class="primary" type="submit" id="email-submit">Email me a sign-in link</button>
        <p class="account-feedback" id="email-feedback" role="status" aria-live="polite"></p>
      </form>
      <div class="passkey-signin" id="passkey-signin" hidden>
        <p class="field-help">Added a passkey before? Use it instead of email.</p>
        <button class="secondary" type="button" id="passkey-login">Sign in with a passkey</button>
        <p class="account-feedback" id="passkey-login-feedback" role="status" aria-live="polite"></p>
      </div>
    </section>
    <section class="account-panel" aria-labelledby="claim-heading">
      <h2 id="claim-heading">Is this a child’s device?</h2>
      <p>On the grown-up’s signed-in device, choose “Add a child’s device”. Then type the code here, or scan its QR code with this device.</p>
      <form id="claim-form" novalidate>
        <label for="pair-code">Code</label>
        <input type="text" id="pair-code" name="code" class="code-input" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="6" required aria-describedby="pair-code-help">
        <p class="field-help" id="pair-code-help">6 letters and numbers. Codes last 10 minutes.</p>
        <label for="device-label">Name this device <span class="optional">(optional)</span></label>
        <input type="text" id="device-label" name="label" maxlength="40" autocomplete="off" placeholder="Kitchen tablet">
        <button class="primary" type="submit">Link this device</button>
        <p class="account-feedback" id="claim-feedback" role="status" aria-live="polite"></p>
      </form>
    </section>
  </div>

  <section class="account-panel" id="device-linked" hidden aria-labelledby="device-heading">
    <h2 id="device-heading">This device is linked to your family</h2>
    <p id="device-linked-text"></p>
    <p class="field-help">Practice on this device is sent to your family’s records. Only a signed-in grown-up can see progress.</p>
    <div class="button-row"><button class="secondary" type="button" id="device-sync">Send practice now</button><button class="secondary" type="button" id="device-unlink">Unlink this device</button></div>
    <p class="account-feedback" id="device-feedback" role="status" aria-live="polite"></p>
  </section>

  <div class="account-columns" id="signed-in" hidden>
    <section class="account-panel" aria-labelledby="devices-heading">
      <h2 id="devices-heading">Add a child’s device</h2>
      <p>Show a code. On the child’s tablet or phone, scan the QR code, or open <strong class="account-address" id="account-address">this page</strong> and type the code under “Is this a child’s device?”.</p>
      <button class="primary" type="button" id="make-code">Show a pairing code</button>
      <div class="pair-panel" id="pair-panel" hidden>
        <p class="pair-code" id="pair-code-text" aria-live="polite"></p>
        <div class="pair-qr" id="pair-qr"></div>
        <p class="field-help" id="pair-expiry"></p>
      </div>
      <h3>Linked devices</h3>
      <ul class="device-list" id="device-list"></ul>
      <p class="field-help" id="device-empty">No child devices yet.</p>
      <p class="account-feedback" id="devices-feedback" role="status" aria-live="polite"></p>
    </section>
    <section class="account-panel" aria-labelledby="family-heading">
      <h2 id="family-heading">Your family</h2>
      <h3>This device’s progress</h3>
      <p id="sync-state">Practice saved on this device is sent to your family’s records.</p>
      <button class="secondary" type="button" id="sync-now">Send this device’s practice now</button>
      <h3>Passkey</h3>
      <p id="passkey-state"></p>
      <button class="secondary" type="button" id="add-passkey">Add a passkey</button>
      <p class="account-feedback" id="passkey-feedback" role="status" aria-live="polite"></p>
      <h3>Your data</h3>
      <div class="button-row"><button class="secondary" type="button" id="export">Download everything (JSON)</button><button class="secondary" type="button" id="sign-out">Sign out</button></div>
      <details class="danger-zone" id="delete-panel"><summary>Delete the family account</summary>
        <p>This deletes your account, every child’s profile and practice records, your passkeys and every linked device, straight away. It can’t be undone. Practice saved on each device stays there until you delete it on that device.</p>
        <label for="delete-confirm">Type <strong>DELETE</strong> to confirm</label>
        <input type="text" id="delete-confirm" autocomplete="off" spellcheck="false">
        <button class="primary danger" type="button" id="delete-family" disabled>Delete everything</button>
      </details>
      <p class="account-feedback" id="family-feedback" role="status" aria-live="polite"></p>
    </section>
  </div>
  ${privacySummaryHtml()}
</div>`,
    path,
    '/src/account.ts',
    { bodyClass: 'account-page' },
  );
}

export function verifyPage(path: LearningPath): string {
  return shell(
    'Signing in',
    `<div class="account-layout">
  <section class="account-intro" aria-labelledby="verify-title">
    <h1 id="verify-title">Signing you in</h1>
    <p class="save-state" id="verify-status" role="status">One moment…</p>
    <noscript><p>Signing in needs JavaScript.</p></noscript>
    <p><a class="primary" id="verify-continue" href="/account/" hidden>Go to your family account</a></p>
  </section>
</div>`,
    path,
    '/src/account.ts',
    { bodyClass: 'account-page account-verify' },
  );
}
