import { Buffer } from 'node:buffer';
import { describe, expect, test, vi } from 'vitest';
import type { ModerationInput } from '../src/builder.ts';
import { createLogger } from '../src/log.ts';
import { createModerator, parseModerationDecision } from '../src/moderation.ts';

const env = {
  MODERATION_MODE: 'auto',
  AI_GATEWAY_ACCOUNT_ID: 'account',
  AI_GATEWAY_ID: 'gateway',
  ANTHROPIC_API_KEY: 'test-key',
};
const textureBytes = new Uint8Array([9, 8, 7]);
const input: ModerationInput = {
  png: new Uint8Array([1, 2, 3]),
  width: 1280,
  height: 800,
  url: 'https://example.com/final',
  title: 'Page title',
  text: 'Extracted text',
  textures: [
    {
      sliceIndex: 0,
      y: 0,
      height: 800,
      width: 2560,
      heightPx: 1600,
      scale: 2,
      contentType: 'image/webp',
      bytes: textureBytes,
    },
  ],
};
function response(text: string, stopReason = 'end_turn') {
  return new Response(
    JSON.stringify({
      id: 'test',
      type: 'message',
      role: 'assistant',
      model: 'test',
      stop_reason: stopReason,
      stop_sequence: null,
      content: [{ type: 'text', text }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
const safe = JSON.stringify({ verdict: 'safe', confidence: 0.99, reason: 'ordinary_content' });

describe('hosted moderation', () => {
  test('default/manual, unknown modes and production test mode never call a provider or approve', async () => {
    const request = vi.fn<typeof fetch>();
    for (const cfg of [
      {},
      { ...env, MODERATION_MODE: 'manual' },
      { ...env, MODERATION_MODE: 'typo' },
      { ...env, WWM_ENV: 'production', MODERATION_MODE: 'test-allow' },
    ]) {
      expect(await createModerator(cfg, { fetch: request })(input)).toMatchObject({
        status: 'pending_review',
        reason: 'manual_review',
      });
    }
    expect(request).not.toHaveBeenCalled();
  });
  test('explicit development test mode is isolated from production', async () => {
    expect(
      await createModerator({ WWM_ENV: 'development', MODERATION_MODE: 'test-allow' })(input),
    ).toMatchObject({ status: 'approved', provider: 'development-test' });
    expect(await createModerator({ MODERATION_MODE: 'auto' })(input)).toMatchObject({
      status: 'pending_review',
      reason: 'provider_unconfigured',
    });
  });
  test('includes full screenshot, independent textures, final URL, title and text in one bounded call', async () => {
    const request = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toContain('gateway.ai.cloudflare.com/v1/account/gateway/anthropic');
      const headers = new Headers(init?.headers);
      expect(headers.get('cf-aig-collect-log')).toBe('false');
      expect(headers.get('cf-aig-skip-cache')).toBe('true');
      const body = JSON.parse(String(init?.body));
      expect(body.messages[0].content).toEqual([
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: Buffer.from(input.png).toString('base64'),
          },
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/webp',
            data: Buffer.from(textureBytes).toString('base64'),
          },
        },
        { type: 'text', text: expect.stringContaining('Extracted text') },
      ]);
      expect(body.messages[0].content[2].text).toContain(input.url);
      expect(body.messages[0].content[2].text).toContain(input.title);
      return response(safe);
    });
    expect(await createModerator(env, { fetch: request })(input)).toMatchObject({ status: 'approved' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  test('explicit independent texture blocks an otherwise safe analysis screenshot', async () => {
    const request: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const hasTexture = body.messages[0].content.some(
        (c: { source?: { data: string } }) => c.source?.data === Buffer.from(textureBytes).toString('base64'),
      );
      return response(
        hasTexture
          ? JSON.stringify({ verdict: 'blocked', confidence: 0.99, reason: 'explicit_content' })
          : safe,
      );
    };
    expect(await createModerator(env, { fetch: request })(input)).toMatchObject({ status: 'blocked' });
  });
  test.each([
    'not json',
    '{"verdict":"safe"}',
    JSON.stringify({ verdict: 'safe', confidence: 0.7, reason: 'ordinary_content' }),
    JSON.stringify({ verdict: 'safe', confidence: 1, reason: 'access_wall' }),
    JSON.stringify({ verdict: 'safe', confidence: 1, reason: 'ordinary_content', ignored: true }),
    JSON.stringify({ verdict: 'safe', confidence: 1, reason: 'raw private captured words' }),
  ])('rejects malformed, ambiguous or inconsistent output: %s', (raw) => {
    expect(parseModerationDecision(raw, 'test', 'v1').status).toBe('pending_review');
  });
  test('provider outages fail closed with one attempt and without recording the exception', async () => {
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error('sensitive https://private.example/?secret=value');
    });
    expect(await createModerator(env, { fetch: request })(input)).toMatchObject({
      status: 'pending_review',
      reason: 'provider_error',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  test('provider timeout aborts and returns pending even if fetch ignores the signal', async () => {
    const request: typeof fetch = async () => new Promise<Response>(() => {});
    expect(
      await createModerator({ ...env, MODERATION_TIMEOUT_MS: '10' }, { fetch: request })(input),
    ).toMatchObject({ status: 'pending_review', reason: 'provider_timeout' });
  });
  test('missing textures, oversized image/text and truncated results are pending', async () => {
    const request = vi.fn<typeof fetch>(async () => response(safe, 'max_tokens'));
    expect(await createModerator(env, { fetch: request })({ ...input, textures: [] })).toMatchObject({
      status: 'pending_review',
      reason: 'evidence_limit',
    });
    expect(await createModerator(env, { fetch: request })({ ...input, height: 8001 })).toMatchObject({
      status: 'pending_review',
      reason: 'evidence_limit',
    });
    expect(
      await createModerator(env, { fetch: request })({ ...input, text: 'x'.repeat(24001) }),
    ).toMatchObject({ status: 'pending_review', reason: 'evidence_limit' });
    expect(request).not.toHaveBeenCalled();
    expect(await createModerator(env, { fetch: request })(input)).toMatchObject({
      status: 'pending_review',
      reason: 'incomplete_response',
    });
  });
  test('gateway-token-only auth omits provider API key', async () => {
    const request: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-api-key')).toBeNull();
      expect(headers.get('cf-aig-authorization')).toBe('Bearer gateway-token');
      return response(safe);
    };
    expect(
      await createModerator(
        { ...env, ANTHROPIC_API_KEY: undefined, AI_GATEWAY_TOKEN: 'gateway-token' },
        { fetch: request },
      )(input),
    ).toMatchObject({ status: 'approved' });
  });
  test('structured logs redact URLs, nested URLs, raw page titles/text and exception URL queries', () => {
    const lines: string[] = [];
    createLogger({ url: 'https://example.com/?secret=value' }, (line) => lines.push(line)).warn(
      'fetch https://private.example/path?token=secret failed',
      { nested: { finalUrl: 'https://x.test/private', title: 'Private title', text: 'private content' } },
    );
    expect(lines.join('')).not.toMatch(/secret|private\.example|Private title|private content/);
    expect(JSON.parse(lines[0] || '{}').url).toBe('[redacted-url]');
  });
});
