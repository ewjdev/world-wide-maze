export * from './baseline.ts';
export * from './checkpoint.ts';
export * from './forks.ts';
export * from './layout.ts';
export { LEGACY_VERSION } from './legacy.ts';
export * from './migrate.ts';
export * from './scene.ts';
export * from './schema.ts';
export * from './script.ts';
export * from './session.ts';
export * from './theme.ts';
export * from './voice.ts';

/** The string a clip hash covers: sha256 of this, first 32 hex characters (tools/learning-voice). */
export function clipKey(text: string, voice: { voiceId: string; model: string; settings: string }): string {
  return JSON.stringify([text, voice.voiceId, voice.model, voice.settings]);
}
