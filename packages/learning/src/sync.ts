/**
 * Phase 31 shared contract (CCR-31-3): child profiles, the device's progress store, and the bodies of the
 * `/api/learning/*` sync API. The lesson page and game (store, outbox), the Worker (accounts, family records) and
 * the parent area all import these; none redeclares them. See plans/contracts.md §10.6.
 */
import { z } from 'zod';
import { evidenceSchema, type LearningEvidence } from './evidence.ts';

// ── child profiles ────────────────────────────────────────────────────────────────────────────────────────

/** Opaque, random, URL-safe. Made on the device (so local evidence keeps its profile when an account links). */
export const profileIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
/** Avatars are Pip in a palette colour: a child picks by picture, never by reading. */
export const AVATARS = ['pip-blue', 'pip-green', 'pip-yellow', 'pip-red', 'pip-teal', 'pip-orange'] as const;
export const profileSchema = z
  .object({
    id: profileIdSchema,
    /** What the grown-up calls the child here; spoken only by the browser's own voice. Not a full name. */
    nickname: z
      .string()
      .trim()
      .min(1)
      .max(24)
      .regex(/^[\p{L}\p{M} '’-]+$/u, 'Letters, spaces, apostrophes and hyphens only.'),
    avatar: z.enum(AVATARS),
    /** Optional, for recommended levels. Never a birth date. */
    ageBand: z.union([z.literal(4), z.literal(5), z.literal(6)]).optional(),
  })
  .strict();
export type Profile = z.infer<typeof profileSchema>;

/** A new random profile id (22 base64url characters, 128 bits). */
export function newProfileId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── the device's progress store (implemented in browser-store.ts, Phase 31 M2) ─────────────────────────────

/**
 * Same-origin IndexedDB on the device. Every write is one transaction; `appendEvidence` adds the event and its
 * outbox entry together. Works with no account: syncing is optional.
 */
export interface ProgressStore {
  listProfiles(): Promise<Profile[]>;
  saveProfile(profile: Profile): Promise<void>;
  /** Removes the profile, its events and its outbox entries. */
  deleteProfile(id: string): Promise<void>;
  activeProfile(): Promise<string | null>;
  setActiveProfile(id: string | null): Promise<void>;
  /** Idempotent by event id. */
  appendEvidence(event: LearningEvidence): Promise<void>;
  events(profile: string): Promise<LearningEvidence[]>;
  /** Item hashes this profile has met (for `expandActivity`'s `seen`). */
  seenItems(profile: string): Promise<Set<string>>;
  /** Oldest first, at most `limit`. */
  outbox(limit: number): Promise<LearningEvidence[]>;
  /** Drop accepted or duplicate ids from the outbox (events stay). */
  markSynced(ids: readonly string[]): Promise<void>;
  /** Everything on this device, for the grown-up's export. */
  exportAll(): Promise<{ profiles: Profile[]; events: LearningEvidence[] }>;
  /** Delete everything on this device (profiles, events, outbox, device link). */
  clear(): Promise<void>;
  /** A paired device's bearer token, if this device is linked to a family. */
  deviceToken(): Promise<string | null>;
  setDeviceToken(token: string | null): Promise<void>;
}

// ── `/api/learning/*` bodies ──────────────────────────────────────────────────────────────────────────────

export const LEARNING_ERROR_CODES = [
  'LEARNING_UNAVAILABLE',
  'LEARNING_AUTH_REQUIRED',
  'LEARNING_FORBIDDEN',
  'LEARNING_NOT_FOUND',
  'LEARNING_INVALID',
  'LEARNING_RATE_LIMITED',
] as const;
export type LearningErrorCode = (typeof LEARNING_ERROR_CODES)[number];
export interface LearningError {
  code: LearningErrorCode;
  message: string;
}

/** Bump when the privacy notice or consent wording changes; families re-consent at next sign-in. */
export const CONSENT_VERSION = '2026-10-19';

export const emailSignInSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    /** Required to create a family; ignored for an existing account. */
    consent: z
      .object({ version: z.literal(CONSENT_VERSION), parent: z.literal(true) })
      .strict()
      .optional(),
    turnstile: z.string().min(1).max(4096),
  })
  .strict();
export type EmailSignIn = z.infer<typeof emailSignInSchema>;
export const emailVerifySchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) }).strict();

export interface SessionResponse {
  signedIn: boolean;
  /** `parent` with a session cookie; `device` with a paired device token. */
  as?: 'parent' | 'device';
  family?: { id: string; profiles: Profile[]; passkeys: number; consentVersion: string };
  device?: { id: string; label: string };
}

export const pairClaimSchema = z
  .object({
    code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/),
    label: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
export interface PairCodeResponse {
  code: string;
  expiresAt: string;
}
export interface PairClaimResponse {
  token: string;
  device: { id: string; label: string };
}
export interface DeviceSummary {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt?: string;
}

export const MAX_EVENTS_PER_BATCH = 200;
export const eventBatchSchema = z
  .object({ events: z.array(evidenceSchema).min(1).max(MAX_EVENTS_PER_BATCH) })
  .strict();
export interface EventBatchResponse {
  accepted: number;
  duplicate: number;
  rejected: { id: string; code: 'UNKNOWN_PROFILE' | 'INVALID' }[];
}
export interface EventPage {
  events: LearningEvidence[];
  /** Pass as `cursor` for the next page; absent on the last page. */
  next?: string;
}

/** `GET /api/learning/export`: everything the family has, as one JSON document. */
export interface FamilyExport {
  format: 'wwm-learning-family-export/1';
  exportedAt: string;
  family: { id: string; createdAt: string; consentVersion: string; consentAt: string; email: string };
  profiles: Profile[];
  devices: DeviceSummary[];
  events: LearningEvidence[];
}
