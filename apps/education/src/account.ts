/**
 * The family account pages (Phase 31 M3): grown-up sign-in by email (Turnstile, consent) or passkey, child
 * devices (pair code and QR, claim, list, revoke), this device's sync, export and deletion. `/account/verify`
 * finishes an emailed sign-in link. Nothing is logged and nothing is sent anywhere but the family's own records.
 */
import '@fontsource-variable/figtree';
import '@fontsource-variable/unbounded';
import './style.css';
import './account.css';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import {
  CONSENT_VERSION,
  type DeviceSummary,
  LearningApiError,
  pairClaimSchema,
  type SessionResponse,
} from '@wwm/learning';
import { qrSvg } from './account-qr.ts';
import { progressStore, writeDeviceToken } from './account-store.ts';
import { accountSession, accountUrl, learningApi, syncNow } from './account-sync.ts';
import { mountTurnstile } from './account-turnstile.ts';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
};
const say = (selector: string, text: string) => {
  $(selector).textContent = text;
};
const problem = (e: unknown, fallback: string) =>
  e instanceof LearningApiError
    ? e.code === 'NETWORK'
      ? 'You seem to be offline. Check the connection and try again.'
      : e.message
    : fallback;

// ── verify page ─────────────────────────────────────────────────────────────────────────────────────────────

async function verify(): Promise<void> {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  // The token is single use; take it out of the address bar and history straight away.
  history.replaceState(null, '', location.pathname);
  const continueLink = $<HTMLAnchorElement>('#verify-continue');
  continueLink.href = accountUrl();
  if (!token) {
    say('#verify-status', 'This link is incomplete. Ask for a new one from the family account page.');
    continueLink.hidden = false;
    return;
  }
  try {
    await learningApi.verifyEmailLink(token);
    say('#verify-status', 'You’re signed in.');
    location.replace(accountUrl());
  } catch (e) {
    say('#verify-status', problem(e, 'This link didn’t work. Ask for a new one.'));
    continueLink.textContent = 'Back to the family account page';
    continueLink.hidden = false;
  }
}

// ── account page ────────────────────────────────────────────────────────────────────────────────────────────

const views = ['#account-unavailable', '#signed-out', '#device-linked', '#signed-in'] as const;
function show(view: (typeof views)[number]): void {
  for (const id of views) $(id).hidden = id !== view;
}

let pairTimer: number | undefined;

function deviceItem(device: DeviceSummary): HTMLLIElement {
  const item = document.createElement('li');
  const name = document.createElement('span');
  name.className = 'device-name';
  name.textContent = device.label;
  const when = document.createElement('span');
  when.className = 'field-help';
  const seen = device.lastSeenAt ?? device.createdAt;
  when.textContent = `Last used ${new Date(seen).toLocaleDateString(undefined, { dateStyle: 'medium' })}`;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-label', `Remove ${device.label}`);
  remove.addEventListener('click', async () => {
    remove.disabled = true;
    try {
      await learningApi.revokeDevice(device.id);
      item.remove();
      say('#devices-feedback', `${device.label} can no longer send practice.`);
      $('#device-empty').hidden = $('#device-list').children.length > 0;
    } catch (e) {
      remove.disabled = false;
      say('#devices-feedback', problem(e, 'Couldn’t remove that device. Try again.'));
    }
  });
  item.append(name, when, remove);
  return item;
}

async function listDevices(): Promise<void> {
  try {
    const devices = await learningApi.listDevices();
    $('#device-list').replaceChildren(...devices.map(deviceItem));
    $('#device-empty').hidden = devices.length > 0;
  } catch (e) {
    say('#devices-feedback', problem(e, 'Couldn’t load your devices.'));
  }
}

function showPasskeys(session: SessionResponse): void {
  const count = session.family?.passkeys ?? 0;
  say(
    '#passkey-state',
    count
      ? `${count === 1 ? 'One passkey' : `${count} passkeys`} can sign in to this family. Add one for each grown-up device you use.`
      : 'Sign in faster next time with this device’s fingerprint, face or screen lock instead of email.',
  );
}

async function syncHere(feedback: string, session: SessionResponse): Promise<void> {
  const store = await progressStore();
  if (!store) {
    say(feedback, 'This browser isn’t keeping practice, so there is nothing to send from here.');
    return;
  }
  say(feedback, 'Sending…');
  const result = await syncNow(store, session).catch(() => null);
  say(
    feedback,
    !result
      ? 'Couldn’t reach your family’s records. Practice stays on this device and is sent later.'
      : result.status === 'done'
        ? `Up to date${result.accepted ? `: ${result.accepted} new ${result.accepted === 1 ? 'round' : 'rounds'} sent` : ''}.`
        : 'Some practice is still waiting. It stays on this device and is sent later.',
  );
}

async function render(): Promise<void> {
  const session = await accountSession();
  if (!session) {
    say('#account-status', 'Family accounts aren’t available here right now.');
    show('#account-unavailable');
    return;
  }
  if (!session.signedIn) {
    say('#account-status', 'Not signed in.');
    show('#signed-out');
    const pair = new URLSearchParams(location.hash.slice(1)).get('pair');
    if (pair) {
      $<HTMLInputElement>('#pair-code').value = pair.toUpperCase().slice(0, 6);
      history.replaceState(null, '', location.pathname);
      $('#pair-code').focus();
    }
    return;
  }
  if (session.as === 'device') {
    say('#account-status', 'This is a child’s device.');
    say('#device-linked-text', `It’s linked as “${session.device?.label ?? 'Child’s device'}”.`);
    show('#device-linked');
    await syncHere('#device-feedback', session);
    return;
  }
  say('#account-status', 'Signed in as the family’s grown-up.');
  show('#signed-in');
  showPasskeys(session);
  await Promise.all([listDevices(), syncHere('#sync-state', session)]);
}

function wireSignedOut(): void {
  const turnstile = mountTurnstile($('#turnstile'));
  const form = $<HTMLFormElement>('#email-form');
  if (!turnstile.available) {
    say('#email-feedback', 'Sign-in by email isn’t set up in this build.');
    $<HTMLButtonElement>('#email-submit').disabled = true;
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $<HTMLInputElement>('#email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      say('#email-feedback', 'Enter your email address.');
      $('#email').focus();
      return;
    }
    const token = turnstile.token();
    if (!token) {
      say('#email-feedback', 'Please finish the “are you human” check first.');
      return;
    }
    const consent = $<HTMLInputElement>('#consent').checked;
    const submit = $<HTMLButtonElement>('#email-submit');
    submit.disabled = true;
    try {
      await learningApi.requestEmailLink({
        email,
        turnstile: token,
        ...(consent ? { consent: { version: CONSENT_VERSION, parent: true as const } } : {}),
      });
      say(
        '#email-feedback',
        `Check ${email} for a sign-in link. It works once, for 15 minutes. If this is a new family account and you didn’t tick the box, the email explains what to do.`,
      );
    } catch (e) {
      say('#email-feedback', problem(e, 'Couldn’t send the link. Try again.'));
    } finally {
      submit.disabled = false;
      turnstile.reset();
    }
  });

  if (typeof PublicKeyCredential !== 'undefined') {
    $('#passkey-signin').hidden = false;
    $('#passkey-login').addEventListener('click', async () => {
      say('#passkey-login-feedback', '');
      try {
        const options = await learningApi.passkeyLoginOptions();
        const response = await startAuthentication({ optionsJSON: options as never });
        await learningApi.passkeyLoginVerify(response as unknown as Record<string, unknown>);
        await render();
      } catch (e) {
        say('#passkey-login-feedback', problem(e, 'That passkey didn’t work. Sign in by email instead.'));
      }
    });
  }

  $<HTMLFormElement>('#claim-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = $<HTMLInputElement>('#pair-code').value.trim().toUpperCase();
    const label = $<HTMLInputElement>('#device-label').value.trim();
    if (!pairClaimSchema.shape.code.safeParse(code).success) {
      say('#claim-feedback', 'Codes are 6 letters and numbers, like K7Q2MX.');
      $('#pair-code').focus();
      return;
    }
    try {
      const claimed = await learningApi.claimDevice(code, label || undefined);
      await writeDeviceToken(claimed.token);
      await render();
    } catch (e) {
      say('#claim-feedback', problem(e, 'That code didn’t work. Ask for a new one.'));
    }
  });
}

function wireDevice(): void {
  $('#device-sync').addEventListener('click', async () => {
    const session = await accountSession();
    if (session) await syncHere('#device-feedback', session);
  });
  $('#device-unlink').addEventListener('click', async () => {
    await writeDeviceToken(null);
    say('#device-feedback', '');
    await render();
  });
}

function wireSignedIn(): void {
  say('#account-address', new URL(accountUrl(), location.origin).href.replace(/^https?:\/\//, ''));
  $('#make-code').addEventListener('click', async () => {
    try {
      const { code, expiresAt } = await learningApi.createPairCode();
      say('#pair-code-text', code);
      $('#pair-code-text').setAttribute('aria-label', `Pairing code ${code.split('').join(' ')}`);
      $('#pair-qr').replaceChildren(
        qrSvg(
          new URL(accountUrl(`#pair=${code}`), location.origin).href,
          200,
          `QR code for pairing code ${code}`,
        ),
      );
      $('#pair-panel').hidden = false;
      window.clearInterval(pairTimer);
      const tick = () => {
        const left = Date.parse(expiresAt) - Date.now();
        if (left <= 0) {
          window.clearInterval(pairTimer);
          say('#pair-expiry', 'This code has expired. Show a new one.');
          $('#pair-panel').classList.add('expired');
          return;
        }
        $('#pair-panel').classList.remove('expired');
        const minutes = Math.ceil(left / 60_000);
        say('#pair-expiry', `Works once, for ${minutes} more ${minutes === 1 ? 'minute' : 'minutes'}.`);
      };
      tick();
      pairTimer = window.setInterval(tick, 15_000);
    } catch (e) {
      say('#devices-feedback', problem(e, 'Couldn’t make a code. Try again.'));
    }
  });

  $('#sync-now').addEventListener('click', async () => {
    const session = await accountSession();
    if (session) await syncHere('#sync-state', session);
  });

  $('#add-passkey').addEventListener('click', async () => {
    say('#passkey-feedback', '');
    try {
      const options = await learningApi.passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON: options as never });
      const session = await learningApi.passkeyRegisterVerify(response as unknown as Record<string, unknown>);
      showPasskeys(session);
      say('#passkey-feedback', 'Passkey added. Next time, choose “Sign in with a passkey”.');
    } catch (e) {
      say('#passkey-feedback', problem(e, 'The passkey wasn’t added.'));
    }
  });

  $('#export').addEventListener('click', async () => {
    try {
      const data = await learningApi.exportFamily();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `wwm-learning-family-${data.exportedAt.slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say('#family-feedback', 'Downloaded everything your family account holds.');
    } catch (e) {
      say('#family-feedback', problem(e, 'Couldn’t download your data. Try again.'));
    }
  });

  $('#sign-out').addEventListener('click', async () => {
    await learningApi.signOut().catch(() => {});
    await render();
  });

  const confirm = $<HTMLInputElement>('#delete-confirm');
  const remove = $<HTMLButtonElement>('#delete-family');
  confirm.addEventListener('input', () => {
    remove.disabled = confirm.value.trim() !== 'DELETE';
  });
  remove.addEventListener('click', async () => {
    if (confirm.value.trim() !== 'DELETE') return;
    remove.disabled = true;
    try {
      await learningApi.deleteFamily();
      confirm.value = '';
      ($('#delete-panel') as HTMLDetailsElement).open = false;
      await render();
      say('#account-status', 'Your family account and everything in it has been deleted.');
    } catch (e) {
      remove.disabled = false;
      say('#family-feedback', problem(e, 'Couldn’t delete the account. Try again.'));
    }
  });
}

if (document.body.classList.contains('account-verify')) {
  void verify();
} else {
  wireSignedOut();
  wireDevice();
  wireSignedIn();
  void render();
}
