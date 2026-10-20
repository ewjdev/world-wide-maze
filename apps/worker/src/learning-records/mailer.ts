/**
 * Sign-in email. `send` uses the Cloudflare Email Service binding `LEARNING_MAIL`; `mock` (development only, see
 * `learningConfig`) records the message in a local mailbox (KV, 15 minutes) that the dev-only
 * `GET /api/learning/dev/mailbox` route and the tests read. Nothing here logs an address or a link.
 */
import type { LearningConfig } from './config.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const MAILBOX_PREFIX = 'learning:dev-mailbox:';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function signInMessage(to: string, link: string, isNew: boolean): MailMessage {
  const subject = 'Your World Wide Maze Learning sign-in link';
  const intro = isNew
    ? 'Here is the link to finish creating your family account for World Wide Maze Learning.'
    : 'Here is your link to sign in to World Wide Maze Learning.';
  const text = `${intro}\n\n${link}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email: nothing happens unless the link is opened.`;
  const html = `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(link)}">Sign in</a></p><p>The link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email: nothing happens unless the link is opened.</p>`;
  return { to, subject, text, html };
}

/** For a new email that came without the parent's consent: no link, just how to start properly. */
export function consentNeededMessage(to: string, page: string): MailMessage {
  const subject = 'Finish setting up World Wide Maze Learning';
  const text = `Someone (probably you) asked to sign in to World Wide Maze Learning with this address, but there is no family account for it yet.\n\nTo create one, go to ${page}, enter this address again and tick the box confirming you are the child's parent or guardian and agree to the privacy notice.\n\nIf this wasn't you, ignore this email. No account was created.`;
  const html = `<p>Someone (probably you) asked to sign in to World Wide Maze Learning with this address, but there is no family account for it yet.</p><p>To create one, <a href="${escapeHtml(page)}">open the sign-in page</a>, enter this address again and tick the box confirming you are the child's parent or guardian and agree to the privacy notice.</p><p>If this wasn't you, ignore this email. No account was created.</p>`;
  return { to, subject, text, html };
}

export async function sendMail(env: Env, config: LearningConfig, message: MailMessage): Promise<boolean> {
  if (config.email.mode === 'mock') {
    const key = `${MAILBOX_PREFIX}${message.to}`;
    const box = ((await env.CACHE.get<MailMessage[]>(key, 'json')) ?? []).slice(-9);
    box.push(message);
    await env.CACHE.put(key, JSON.stringify(box), { expirationTtl: 900 });
    return true;
  }
  if (config.email.mode !== 'send') return false;
  try {
    await env.LEARNING_MAIL.send({
      to: message.to,
      from: { email: config.email.from, name: 'World Wide Maze Learning' },
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return true;
  } catch {
    return false;
  }
}

/** Development only: the messages the mock sent to `to`, newest last. */
export async function mockMailbox(env: Env, to: string): Promise<MailMessage[]> {
  return (await env.CACHE.get<MailMessage[]>(`${MAILBOX_PREFIX}${to}`, 'json')) ?? [];
}
