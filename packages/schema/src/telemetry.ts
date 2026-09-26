/** Product analytics v1. Closed enums and bounded numbers only; never arbitrary page/player content. */
import { z } from 'zod';
import { ANALYTICS_VERSION } from './constants.ts';
import { API_ERROR_CODES } from './errors.ts';

z.config({ jitless: true });
export const ANALYTICS_PHASES = [
  'none',
  'title',
  'howto',
  'pairing',
  'calibrate',
  'select',
  'building',
  'intro',
  'countdown',
  'play',
  'paused',
  'falling',
  'timeup',
  'restarting',
  'goal',
  'result',
  'gameover',
  'ranking',
  'error',
] as const;
export const AnalyticsPhaseSchema = z.enum(ANALYTICS_PHASES);
export const AnalyticsRouteSchema = z.enum([
  'home',
  'play',
  'local',
  'host',
  'controller',
  'about',
  'making',
  'log',
  'journey',
  'mazify',
  'privacy',
  'other',
]);
export const AnalyticsSourceSchema = z.enum([
  'direct',
  'internal',
  'google',
  'bing',
  'linkedin',
  'github',
  'reddit',
  'x',
  'facebook',
  'email',
  'referral',
  'other',
]);
export const AnalyticsRunSchema = z.enum(['practice', 'fixture', 'api', 'local', 'sketch', 'unknown']);
const input = z.enum(['keyboard', 'phone', 'gamepad', 'unknown']);
const ms = z.int().min(0).max(86_400_000);
const uuid = z.uuid();
const stage = { run: AnalyticsRunSchema, slice: z.int().min(0).max(999), attempt: uuid };

export const TelemetryEventSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('page_viewed') }),
  z.object({ name: z.literal('page_left') }),
  z.object({ name: z.literal('title') }),
  z.object({ name: z.literal('start_clicked') }),
  z.object({ name: z.literal('stage_selected'), run: AnalyticsRunSchema }),
  z.object({ name: z.literal('input_selected'), input }),
  z.object({ name: z.literal('pairing_started') }),
  z.object({ name: z.literal('paired'), input: z.literal('phone') }),
  z.object({ name: z.literal('pairing_failed'), reason: z.enum(['room_error', 'calibration_timeout']) }),
  z.object({
    name: z.literal('controller_state'),
    state: z.enum([
      'connecting',
      'not-found',
      'replaced',
      'unauthorized',
      'enable',
      'requesting',
      'denied',
      'no-sensor',
      'calibrate',
      'calibration-failed',
      'play',
    ]),
  }),
  z.object({
    name: z.literal('controller_connection'),
    state: z.enum(['idle', 'connecting', 'open', 'reconnecting', 'closed']),
  }),
  z.object({ name: z.literal('build_started'), attempt: uuid }),
  z.object({ name: z.literal('stage_loaded'), ...stage, duration_ms: ms }),
  z.object({
    name: z.literal('build_failed'),
    attempt: uuid,
    code: z.enum([...API_ERROR_CODES, 'NETWORK', 'NOT_FOUND', 'OTHER']),
  }),
  z.object({ name: z.literal('build_cancelled'), attempt: uuid, duration_ms: ms }),
  z.object({ name: z.literal('played'), ...stage, input }),
  z.object({ name: z.literal('finished'), ...stage }),
  z.object({ name: z.literal('ended'), ...stage, reason: z.enum(['gameover', 'timeup']) }),
  z.object({
    name: z.literal('game_phase'),
    phase: AnalyticsPhaseSchema,
    from: AnalyticsPhaseSchema,
    attempt: uuid.optional(),
  }),
  z.object({ name: z.literal('stage_restarted') }),
  z.object({ name: z.literal('next_selected') }),
  z.object({ name: z.literal('portal_selected'), action: z.enum(['travel', 'stay']) }),
  z.object({ name: z.literal('controller_disconnected') }),
  z.object({
    name: z.literal('engagement'),
    active_ms: ms,
    play_ms: ms,
    phase: AnalyticsPhaseSchema,
    reason: z.enum(['interval', 'hidden', 'pagehide', 'route', 'phase', 'stop']),
    ...stage,
  }),
  z.object({
    name: z.literal('outbound_clicked'),
    destination: z.enum(['github', 'source', 'social', 'other']),
  }),
  z.object({
    name: z.literal('client_error'),
    kind: z.enum([
      'Error',
      'TypeError',
      'RangeError',
      'ReferenceError',
      'SyntaxError',
      'UnhandledRejection',
      'Other',
    ]),
  }),
]);

export const TelemetryContextSchema = z.object({
  route: AnalyticsRouteSchema,
  surface: z.enum(['host', 'controller', 'site']),
  device: z.enum(['desktop', 'mobile', 'tablet']),
  browser: z.enum(['Chrome', 'Safari', 'Firefox', 'Edge', 'Other']),
  language: z.enum(['en', 'ja', 'other']),
  source: AnalyticsSourceSchema,
  medium: z.enum(['none', 'social', 'email', 'referral', 'organic', 'paid', 'other']),
  campaign: z.enum(['none', 'launch', 'build-story', 'tribute', 'other']),
});
export const TelemetryEnvelopeSchema = z.object({
  version: z.literal(ANALYTICS_VERSION),
  event_id: uuid,
  visit: uuid,
  visitor: uuid.optional(),
  identity: z.enum(['visit', 'browser']),
  timestamp: z.int().positive(),
  context: TelemetryContextSchema,
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type TelemetryContext = z.infer<typeof TelemetryContextSchema>;
export type TelemetryEnvelope = z.infer<typeof TelemetryEnvelopeSchema>;
export type TelemetryRecord = TelemetryEvent & TelemetryEnvelope;
export type AnalyticsPhase = z.infer<typeof AnalyticsPhaseSchema>;
export type AnalyticsRun = z.infer<typeof AnalyticsRunSchema>;
