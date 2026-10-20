/**
 * A software WebAuthn authenticator (ES256, `none` attestation) for the learning-records integration tests: it
 * produces the same JSON a browser's `navigator.credentials.create()/get()` would, so the real Worker and
 * `@simplewebauthn/server` verify it inside workerd.
 */
import { createHash, webcrypto } from 'node:crypto';

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const sha256 = (bytes: Uint8Array | string) => new Uint8Array(createHash('sha256').update(bytes).digest());

// ── minimal CBOR (just what attestation objects and COSE keys use) ──────────────────────────────────────────
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function head(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length];
  if (length < 0x100) return [(major << 5) | 24, length];
  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];
  return [
    (major << 5) | 26,
    (length >>> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  ];
}
function cbor(value: Cbor): number[] {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return [...head(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value];
  const out = head(5, value.size);
  for (const [k, v] of value) out.push(...cbor(k), ...cbor(v));
  return out;
}

/** WebCrypto's raw (r‖s) ECDSA signature → the ASN.1 DER form WebAuthn uses. */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = [...bytes.slice(i)];
    if ((v[0] ?? 0) & 0x80) v = [0, ...v];
    return [0x02, v.length, ...v];
  };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

export class SoftAuthenticator {
  readonly credentialId = webcrypto.getRandomValues(new Uint8Array(16));
  #counter = 0;
  #keys: CryptoKeyPair | null = null;
  #userHandle: string | undefined;

  constructor(
    readonly rpId: string,
    readonly origin: string,
  ) {}

  get id(): string {
    return b64url(this.credentialId);
  }

  async #pair(): Promise<CryptoKeyPair> {
    this.#keys ??= (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    return this.#keys;
  }

  #clientData(type: string, challenge: string, origin: string): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** `navigator.credentials.create()` for the given options (as returned by register/options). */
  async register(options: { challenge: string; user: { id: string } }, origin = this.origin) {
    const jwk = await webcrypto.subtle.exportKey('jwk', (await this.#pair()).publicKey);
    const cose = new Uint8Array(
      cbor(
        new Map<Cbor, Cbor>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, new Uint8Array(Buffer.from(jwk.x as string, 'base64url'))],
          [-3, new Uint8Array(Buffer.from(jwk.y as string, 'base64url'))],
        ]),
      ),
    );
    const authData = new Uint8Array([
      ...sha256(this.rpId),
      0x45, // user present, user verified, attested credential data
      0,
      0,
      0,
      0,
      ...new Uint8Array(16), // AAGUID
      this.credentialId.length >> 8,
      this.credentialId.length & 0xff,
      ...this.credentialId,
      ...cose,
    ]);
    const attestationObject = new Uint8Array(
      cbor(
        new Map<Cbor, Cbor>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      ),
    );
    this.#userHandle = options.user.id;
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(this.#clientData('webauthn.create', options.challenge, origin)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    };
  }

  /** `navigator.credentials.get()` for the given options (as returned by login/options). */
  async login(options: { challenge: string }, origin = this.origin) {
    this.#counter++;
    const c = this.#counter;
    const authData = new Uint8Array([
      ...sha256(this.rpId),
      0x05,
      (c >>> 24) & 0xff,
      (c >> 16) & 0xff,
      (c >> 8) & 0xff,
      c & 0xff,
    ]);
    const clientData = this.#clientData('webauthn.get', options.challenge, origin);
    const signed = new Uint8Array([...authData, ...sha256(clientData)]);
    const raw = new Uint8Array(
      await webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        (await this.#pair()).privateKey,
        signed,
      ),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(derSignature(raw)),
        ...(this.#userHandle ? { userHandle: this.#userHandle } : {}),
      },
      clientExtensionResults: {},
    };
  }
}
