/**
 * Passkeys (WebAuthn) with `@simplewebauthn/server`, which runs on WebCrypto and is exercised in workerd by
 * test/learning-records.integration.test.ts (a software authenticator registers and signs in through the real
 * Worker). Challenges are stored in D1 and used once. The RP id and allowed origins come from configuration
 * (`LEARNING_RP_ID`, `LEARNING_ORIGIN`); without them passkeys are refused.
 */
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { Accounts } from './accounts.ts';
import type { LearningConfig } from './config.ts';
import { base64url } from './tokens.ts';

const RP_NAME = 'World Wide Maze Learning';
const TIMEOUT_MS = 5 * 60_000;

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** The challenge a response was made for (from its clientDataJSON), or null if unreadable. */
function responseChallenge(clientDataJSON: unknown): string | null {
  if (typeof clientDataJSON !== 'string' || clientDataJSON.length > 4096) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64url(clientDataJSON))) as {
      challenge?: unknown;
    };
    return typeof data.challenge === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(data.challenge)
      ? data.challenge
      : null;
  } catch {
    return null;
  }
}

export interface PasskeyContext {
  accounts: Accounts;
  config: LearningConfig;
}

const ready = (config: LearningConfig): config is LearningConfig & { rpId: string } =>
  Boolean(config.rpId && config.origins.length);

export async function registrationOptions(
  { accounts, config }: PasskeyContext,
  family: { id: string; email: string },
) {
  if (!ready(config)) return null;
  const existing = await accounts.passkeys(family.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: config.rpId,
    userName: family.email,
    userDisplayName: 'Family grown-up',
    userID: new TextEncoder().encode(family.id),
    timeout: TIMEOUT_MS,
    attestationType: 'none',
    excludeCredentials: existing.map((key) => ({
      id: key.id,
      transports: JSON.parse(key.transports) as string[],
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  await accounts.saveChallenge(options.challenge, 'register', family.id);
  return options;
}

export async function verifyRegistration(
  { accounts, config }: PasskeyContext,
  familyId: string,
  body: unknown,
): Promise<boolean> {
  if (!ready(config) || !body || typeof body !== 'object') return false;
  const response = body as RegistrationResponseJSON;
  const challenge = responseChallenge(response.response?.clientDataJSON);
  if (!challenge || !(await accounts.takeChallenge(challenge, 'register', familyId))) return false;
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.origins,
      expectedRPID: config.rpId,
      requireUserVerification: false,
    });
    if (!result.verified) return false;
    const { credential } = result.registrationInfo;
    if (await accounts.passkey(credential.id)) return false;
    await accounts.addPasskey(familyId, {
      id: credential.id,
      publicKey: base64url(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
    });
    return true;
  } catch {
    return false;
  }
}

export async function authenticationOptions({ accounts, config }: PasskeyContext) {
  if (!ready(config)) return null;
  // Discoverable credentials: no allow-list, so the response never reveals which accounts exist.
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    timeout: TIMEOUT_MS,
    userVerification: 'preferred',
  });
  await accounts.saveChallenge(options.challenge, 'login', null);
  return options;
}

/** The family the passkey belongs to, or null. */
export async function verifyAuthentication({ accounts, config }: PasskeyContext, body: unknown) {
  if (!ready(config) || !body || typeof body !== 'object') return null;
  const response = body as AuthenticationResponseJSON;
  const challenge = responseChallenge(response.response?.clientDataJSON);
  if (!challenge || typeof response.id !== 'string') return null;
  if (!(await accounts.takeChallenge(challenge, 'login', null))) return null;
  const key = await accounts.passkey(response.id);
  if (!key) return null;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.origins,
      expectedRPID: config.rpId,
      requireUserVerification: false,
      credential: {
        id: key.id,
        publicKey: fromBase64url(key.public_key),
        counter: key.counter,
        transports: JSON.parse(key.transports) as string[],
      },
    });
    if (!result.verified) return null;
    await accounts.usePasskey(key.id, result.authenticationInfo.newCounter);
    return key.family_id;
  } catch {
    return null;
  }
}
