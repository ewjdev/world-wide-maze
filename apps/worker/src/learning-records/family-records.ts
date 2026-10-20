/**
 * FamilyRecords (Phase 31 M3, contracts §10.5): one SQLite-backed Durable Object per family, named by the
 * family id. It is the single writer for the family's child profiles and learning events. The Worker only calls
 * it after authenticating a parent session or a device token of that same family, so the object itself never
 * sees a credential. Inputs are validated by the Worker against the `@wwm/learning` schemas before they get here.
 *
 * - Events are idempotent by id (`INSERT OR IGNORE`); an event for a profile this family doesn't have is rejected
 *   with `UNKNOWN_PROFILE`, so one family can never write into another's records.
 * - Deleting a profile deletes its events in the same transaction.
 * - `destroy()` calls `deleteAll()`: nothing of the family remains in the object's storage.
 */

import { DurableObject } from 'cloudflare:workers';
import type { EventBatchResponse, EventPage, LearningEvidence, Profile } from '@wwm/learning';

/** Profiles per family (a family of children, not a classroom). */
export const MAX_PROFILES = 12;
/** Stored events per family; beyond this new events are rejected rather than growing without bound. */
export const MAX_EVENTS = 250_000;
export const EVENT_PAGE_SIZE = 500;

interface ProfileRow extends Record<string, SqlStorageValue> {
  id: string;
  nickname: string;
  avatar: string;
  age_band: number | null;
}
interface EventRow extends Record<string, SqlStorageValue> {
  id: string;
  at: string;
  body: string;
}

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  nickname: row.nickname,
  avatar: row.avatar as Profile['avatar'],
  ...(row.age_band === null ? {} : { ageBand: row.age_band as NonNullable<Profile['ageBand']> }),
});

/** Opaque cursor: the (at, id) of the last event on the page. */
function encodeCursor(at: string, id: string): string {
  return btoa(`${at}|${id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCursor(cursor: string): { at: string; id: string } | null {
  try {
    const text = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const [at, id, extra] = text.split('|');
    if (!at || !id || extra !== undefined) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export class FamilyRecords extends DurableObject<Env> {
  #ready = false;

  #schema(): SqlStorage {
    const sql = this.ctx.storage.sql;
    if (!this.#ready) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY,
          nickname TEXT NOT NULL,
          avatar TEXT NOT NULL,
          age_band INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          profile TEXT NOT NULL,
          at TEXT NOT NULL,
          body TEXT NOT NULL,
          received_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS events_profile_at ON events (profile, at, id);
        CREATE INDEX IF NOT EXISTS events_at ON events (at, id);
      `);
      this.#ready = true;
    }
    return sql;
  }

  async listProfiles(): Promise<Profile[]> {
    return this.#schema()
      .exec<ProfileRow>('SELECT id, nickname, avatar, age_band FROM profiles ORDER BY created_at, id')
      .toArray()
      .map(toProfile);
  }

  /** Create (with the device-made id) or replace a profile. `created` is false when the id already existed. */
  async putProfile(
    profile: Profile,
    mode: 'upsert' | 'update',
  ): Promise<{ ok: true; created: boolean } | { ok: false; reason: 'not-found' | 'limit' }> {
    const sql = this.#schema();
    const exists = sql.exec('SELECT 1 FROM profiles WHERE id = ?', profile.id).toArray().length > 0;
    if (!exists && mode === 'update') return { ok: false, reason: 'not-found' };
    if (!exists && sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM profiles').one().n >= MAX_PROFILES)
      return { ok: false, reason: 'limit' };
    const now = new Date().toISOString();
    sql.exec(
      `INSERT INTO profiles (id, nickname, avatar, age_band, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET nickname = excluded.nickname, avatar = excluded.avatar,
         age_band = excluded.age_band, updated_at = excluded.updated_at`,
      profile.id,
      profile.nickname,
      profile.avatar,
      profile.ageBand ?? null,
      now,
      now,
    );
    return { ok: true, created: !exists };
  }

  async getProfile(id: string): Promise<Profile | null> {
    const row = this.#schema()
      .exec<ProfileRow>('SELECT id, nickname, avatar, age_band FROM profiles WHERE id = ?', id)
      .toArray()[0];
    return row ? toProfile(row) : null;
  }

  /** Removes the profile and every event recorded for it (one transaction). */
  async deleteProfile(id: string): Promise<{ deleted: boolean; events: number }> {
    const sql = this.#schema();
    return this.ctx.storage.transactionSync(() => {
      const events = sql.exec('DELETE FROM events WHERE profile = ?', id).rowsWritten;
      const deleted = sql.exec('DELETE FROM profiles WHERE id = ?', id).rowsWritten > 0;
      return { deleted, events };
    });
  }

  /** Validated events in; accepted, duplicate and rejected out. Idempotent by event id. */
  async appendEvents(events: LearningEvidence[]): Promise<EventBatchResponse> {
    const sql = this.#schema();
    return this.ctx.storage.transactionSync(() => {
      const profiles = new Set(
        sql
          .exec<{ id: string }>('SELECT id FROM profiles')
          .toArray()
          .map((r) => r.id),
      );
      let stored = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM events').one().n;
      const result: EventBatchResponse = { accepted: 0, duplicate: 0, rejected: [] };
      const now = new Date().toISOString();
      for (const event of events) {
        if (!profiles.has(event.profile)) {
          result.rejected.push({ id: event.id, code: 'UNKNOWN_PROFILE' });
          continue;
        }
        if (stored >= MAX_EVENTS) {
          result.rejected.push({ id: event.id, code: 'INVALID' });
          continue;
        }
        const written = sql.exec(
          'INSERT OR IGNORE INTO events (id, profile, at, body, received_at) VALUES (?, ?, ?, ?, ?)',
          event.id,
          event.profile,
          event.at,
          JSON.stringify(event),
          now,
        ).rowsWritten;
        if (written > 0) {
          result.accepted++;
          stored++;
        } else result.duplicate++;
      }
      return result;
    });
  }

  /** Oldest first by (at, id); `profile` narrows to one child. */
  async eventPage(options: { profile?: string; cursor?: string; limit?: number }): Promise<EventPage> {
    const sql = this.#schema();
    const limit = Math.max(1, Math.min(EVENT_PAGE_SIZE, options.limit ?? EVENT_PAGE_SIZE));
    const after = options.cursor ? decodeCursor(options.cursor) : null;
    const where: string[] = [];
    const args: SqlStorageValue[] = [];
    if (options.profile) {
      where.push('profile = ?');
      args.push(options.profile);
    }
    if (after) {
      where.push('(at > ? OR (at = ? AND id > ?))');
      args.push(after.at, after.at, after.id);
    }
    const rows = sql
      .exec<EventRow>(
        `SELECT id, at, body FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY at, id LIMIT ?`,
        ...args,
        limit + 1,
      )
      .toArray();
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      events: page.map((row) => JSON.parse(row.body) as LearningEvidence),
      ...(rows.length > limit && last ? { next: encodeCursor(last.at, last.id) } : {}),
    };
  }

  /** Everything, for `GET /api/learning/export`. */
  async exportAll(): Promise<{ profiles: Profile[]; events: LearningEvidence[] }> {
    const profiles = await this.listProfiles();
    const events = this.#schema()
      .exec<EventRow>('SELECT id, at, body FROM events ORDER BY at, id')
      .toArray()
      .map((row) => JSON.parse(row.body) as LearningEvidence);
    return { profiles, events };
  }

  async counts(): Promise<{ profiles: number; events: number }> {
    const sql = this.#schema();
    return {
      profiles: sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM profiles').one().n,
      events: sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM events').one().n,
    };
  }

  /** Delete the family's records: every table, every row, any alarm. */
  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.#ready = false;
  }
}
