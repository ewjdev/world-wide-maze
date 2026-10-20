/**
 * The learning-records account index in D1 (`LEARNING_DB`, database `wwm-learning-records`): parents, passkeys,
 * sessions, one-use sign-in links, WebAuthn challenges, pair codes and devices. Every secret is looked up by its
 * SHA-256 digest; the raw value only ever exists in the response that hands it out.
 */
import { CONSENT_VERSION, type DeviceSummary } from '@wwm/learning';
import { iso, pairCode, randomId, randomToken, sha256Hex } from './tokens.ts';

export const SESSION_TTL_MS = 30 * 24 * 3600_000;
/** Roll the session (new expiry and cookie) once it is older than a day. */
export const SESSION_ROLL_AFTER_MS = 24 * 3600_000;
export const LINK_TTL_MS = 15 * 60_000;
export const PAIR_TTL_MS = 10 * 60_000;
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const RETENTION_MS = 730 * 24 * 3600_000; // 24 months
export const MAX_DEVICES = 20;
export const MAX_PASSKEYS = 10;

export interface Parent {
  id: string;
  email: string;
  consent_version: string;
  consent_at: string;
  created_at: string;
  last_active_at: string;
}
export interface PasskeyRow {
  id: string;
  family_id: string;
  public_key: string;
  counter: number;
  transports: string;
}
export interface DeviceRow {
  id: string;
  family_id: string;
  label: string;
  created_at: string;
  last_seen_at: string | null;
}

export class Accounts {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}

  // ── parents ───────────────────────────────────────────────────────────────────────────────────────────

  parentByEmail(email: string): Promise<Parent | null> {
    return this.db.prepare('SELECT * FROM parents WHERE email = ?').bind(email).first<Parent>();
  }
  parent(id: string): Promise<Parent | null> {
    return this.db.prepare('SELECT * FROM parents WHERE id = ?').bind(id).first<Parent>();
  }

  /** A new family for a consenting parent. Returns the existing one if the email raced in meanwhile. */
  async createParent(email: string, consentVersion: string): Promise<Parent> {
    const t = iso(this.now());
    await this.db
      .prepare(
        `INSERT INTO parents (id, email, consent_version, consent_at, created_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING`,
      )
      .bind(randomId(), email, consentVersion, t, t, t)
      .run();
    const parent = await this.parentByEmail(email);
    if (!parent) throw new Error('family was not created');
    return parent;
  }

  async recordConsent(familyId: string, consentVersion: string): Promise<void> {
    await this.db
      .prepare('UPDATE parents SET consent_version = ?, consent_at = ? WHERE id = ?')
      .bind(consentVersion, iso(this.now()), familyId)
      .run();
  }

  /** Mark the family active today (at most one write per day per family). */
  async touchFamily(familyId: string): Promise<void> {
    const today = iso(this.now()).slice(0, 10);
    await this.db
      .prepare('UPDATE parents SET last_active_at = ? WHERE id = ? AND substr(last_active_at, 1, 10) < ?')
      .bind(iso(this.now()), familyId, today)
      .run();
  }

  // ── sign-in links ─────────────────────────────────────────────────────────────────────────────────────

  async createLink(email: string, consent: boolean): Promise<string> {
    const token = randomToken();
    const t = this.now();
    await this.db
      .prepare(
        `INSERT INTO sign_in_links (token_hash, email, consent_version, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(await sha256Hex(token), email, consent ? CONSENT_VERSION : null, iso(t), iso(t + LINK_TTL_MS))
      .run();
    return token;
  }

  /** Atomically use a link: it works once, and only before it expires. */
  async consumeLink(token: string): Promise<{ email: string; consent_version: string | null } | null> {
    const t = iso(this.now());
    return this.db
      .prepare(
        `UPDATE sign_in_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
         RETURNING email, consent_version`,
      )
      .bind(t, await sha256Hex(token), t)
      .first<{ email: string; consent_version: string | null }>();
  }

  // ── sessions ──────────────────────────────────────────────────────────────────────────────────────────

  async createSession(familyId: string): Promise<{ token: string; expiresAt: number }> {
    const token = randomToken();
    const t = this.now();
    const expiresAt = t + SESSION_TTL_MS;
    await this.db
      .prepare(
        'INSERT INTO sessions (token_hash, family_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(await sha256Hex(token), familyId, iso(t), iso(expiresAt), iso(t))
      .run();
    await this.touchFamily(familyId);
    return { token, expiresAt };
  }

  /**
   * The family for a session token, or null. Rolling: a session seen more than a day after its last roll gets a
   * fresh 30-day expiry (`rolled` tells the caller to re-send the cookie).
   */
  async session(token: string): Promise<{ familyId: string; expiresAt: number; rolled: boolean } | null> {
    const hash = await sha256Hex(token);
    const t = this.now();
    const row = await this.db
      .prepare(
        'SELECT family_id, expires_at, last_seen_at FROM sessions WHERE token_hash = ? AND expires_at > ?',
      )
      .bind(hash, iso(t))
      .first<{ family_id: string; expires_at: string; last_seen_at: string }>();
    if (!row) return null;
    if (t - Date.parse(row.last_seen_at) < SESSION_ROLL_AFTER_MS)
      return { familyId: row.family_id, expiresAt: Date.parse(row.expires_at), rolled: false };
    const expiresAt = t + SESSION_TTL_MS;
    await this.db
      .prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?')
      .bind(iso(expiresAt), iso(t), hash)
      .run();
    await this.touchFamily(row.family_id);
    return { familyId: row.family_id, expiresAt, rolled: true };
  }

  async deleteSession(token: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token))
      .run();
  }

  // ── WebAuthn challenges ───────────────────────────────────────────────────────────────────────────────

  async saveChallenge(challenge: string, kind: 'register' | 'login', familyId: string | null): Promise<void> {
    await this.db
      .prepare('INSERT INTO auth_challenges (challenge, kind, family_id, expires_at) VALUES (?, ?, ?, ?)')
      .bind(challenge, kind, familyId, iso(this.now() + CHALLENGE_TTL_MS))
      .run();
  }

  /** One use: deleted as it is read. Registration challenges belong to one family. */
  async takeChallenge(
    challenge: string,
    kind: 'register' | 'login',
    familyId: string | null,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        'DELETE FROM auth_challenges WHERE challenge = ? AND kind = ? AND expires_at > ? RETURNING family_id',
      )
      .bind(challenge, kind, iso(this.now()))
      .first<{ family_id: string | null }>();
    return row !== null && row.family_id === familyId;
  }

  // ── passkeys ──────────────────────────────────────────────────────────────────────────────────────────

  passkeys(familyId: string): Promise<PasskeyRow[]> {
    return this.db
      .prepare('SELECT id, family_id, public_key, counter, transports FROM passkeys WHERE family_id = ?')
      .bind(familyId)
      .all<PasskeyRow>()
      .then((r) => r.results);
  }
  passkey(id: string): Promise<PasskeyRow | null> {
    return this.db
      .prepare('SELECT id, family_id, public_key, counter, transports FROM passkeys WHERE id = ?')
      .bind(id)
      .first<PasskeyRow>();
  }
  async passkeyCount(familyId: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS n FROM passkeys WHERE family_id = ?')
      .bind(familyId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
  async addPasskey(
    familyId: string,
    key: { id: string; publicKey: string; counter: number; transports: string[] },
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO passkeys (id, family_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(key.id, familyId, key.publicKey, key.counter, JSON.stringify(key.transports), iso(this.now()))
      .run();
  }
  async usePasskey(id: string, counter: number): Promise<void> {
    await this.db
      .prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
      .bind(counter, iso(this.now()), id)
      .run();
  }

  // ── pairing and devices ───────────────────────────────────────────────────────────────────────────────

  async createPairCode(familyId: string): Promise<{ code: string; expiresAt: string }> {
    const t = this.now();
    const expiresAt = iso(t + PAIR_TTL_MS);
    for (let attempt = 0; ; attempt++) {
      const code = pairCode();
      const r = await this.db
        .prepare(
          `INSERT INTO pair_codes (code_hash, family_id, created_at, expires_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (code_hash) DO NOTHING`,
        )
        .bind(await sha256Hex(code), familyId, iso(t), expiresAt)
        .run();
      if (r.meta.changes > 0) return { code, expiresAt };
      if (attempt >= 4) throw new Error('could not allocate a pair code');
    }
  }

  /** Use a pair code (once, before it expires) and register the device. Returns its bearer token. */
  async claimPairCode(
    code: string,
    label: string,
  ): Promise<{ token: string; device: { id: string; label: string }; familyId: string } | 'full' | null> {
    const t = iso(this.now());
    const row = await this.db
      .prepare(
        `UPDATE pair_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
         RETURNING family_id`,
      )
      .bind(t, await sha256Hex(code), t)
      .first<{ family_id: string }>();
    if (!row) return null;
    const count = await this.db
      .prepare('SELECT COUNT(*) AS n FROM devices WHERE family_id = ?')
      .bind(row.family_id)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_DEVICES) return 'full';
    const token = randomToken();
    const id = randomId();
    await this.db
      .prepare(
        'INSERT INTO devices (id, family_id, token_hash, label, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(id, row.family_id, await sha256Hex(token), label, t, t)
      .run();
    await this.touchFamily(row.family_id);
    return { token, device: { id, label }, familyId: row.family_id };
  }

  /** The device for a bearer token (revoked devices have no row). Updates last-seen at most hourly. */
  async device(token: string): Promise<DeviceRow | null> {
    const row = await this.db
      .prepare('SELECT id, family_id, label, created_at, last_seen_at FROM devices WHERE token_hash = ?')
      .bind(await sha256Hex(token))
      .first<DeviceRow>();
    if (!row) return null;
    const t = this.now();
    if (!row.last_seen_at || t - Date.parse(row.last_seen_at) > 3600_000) {
      await this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(iso(t), row.id).run();
      await this.touchFamily(row.family_id);
    }
    return row;
  }

  async devices(familyId: string): Promise<DeviceSummary[]> {
    const { results } = await this.db
      .prepare(
        'SELECT id, label, created_at, last_seen_at FROM devices WHERE family_id = ? ORDER BY created_at',
      )
      .bind(familyId)
      .all<{ id: string; label: string; created_at: string; last_seen_at: string | null }>();
    return results.map((d) => ({
      id: d.id,
      label: d.label,
      createdAt: d.created_at,
      ...(d.last_seen_at ? { lastSeenAt: d.last_seen_at } : {}),
    }));
  }

  /** Revoke: the row (and so the token) is gone. Only within the family. */
  async revokeDevice(familyId: string, id: string): Promise<boolean> {
    const r = await this.db
      .prepare('DELETE FROM devices WHERE id = ? AND family_id = ?')
      .bind(id, familyId)
      .run();
    return r.meta.changes > 0;
  }

  // ── deletion and retention ────────────────────────────────────────────────────────────────────────────

  /** Every D1 row of a family, in one batch (atomic). */
  async deleteFamily(parent: Pick<Parent, 'id' | 'email'>): Promise<void> {
    const id = parent.id;
    await this.db.batch([
      this.db.prepare('DELETE FROM passkeys WHERE family_id = ?').bind(id),
      this.db.prepare('DELETE FROM sessions WHERE family_id = ?').bind(id),
      this.db.prepare('DELETE FROM devices WHERE family_id = ?').bind(id),
      this.db.prepare('DELETE FROM pair_codes WHERE family_id = ?').bind(id),
      this.db.prepare('DELETE FROM auth_challenges WHERE family_id = ?').bind(id),
      this.db.prepare('DELETE FROM sign_in_links WHERE email = ?').bind(parent.email),
      this.db.prepare('DELETE FROM parents WHERE id = ?').bind(id),
    ]);
  }

  /** Families with no activity since `before`. */
  async inactiveFamilies(before: number, limit: number): Promise<Pick<Parent, 'id' | 'email'>[]> {
    const { results } = await this.db
      .prepare('SELECT id, email FROM parents WHERE last_active_at < ? ORDER BY last_active_at LIMIT ?')
      .bind(iso(before), limit)
      .all<Pick<Parent, 'id' | 'email'>>();
    return results;
  }

  /** Expired sessions, links, challenges and pair codes (used links are kept only until they expire). */
  async purgeExpired(): Promise<number> {
    const t = iso(this.now());
    const results = await this.db.batch([
      this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(t),
      this.db.prepare('DELETE FROM sign_in_links WHERE expires_at <= ?').bind(t),
      this.db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').bind(t),
      this.db.prepare('DELETE FROM pair_codes WHERE expires_at <= ?').bind(t),
    ]);
    return results.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
  }
}
