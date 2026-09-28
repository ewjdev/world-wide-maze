import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { body, jevPlugin } from '../src/plugin.ts';
import { CreateSchema } from '../src/validation.ts';

describe('jev plugin', () => {
  it('decodes multi-byte characters split across request chunks', async () => {
    const bytes = Buffer.from(JSON.stringify({ title: '迷路🌏' }));
    const split = bytes.indexOf(Buffer.from('🌏')) + 2;
    const req = Readable.from([
      bytes.subarray(0, split),
      bytes.subarray(split),
    ]) as unknown as IncomingMessage;
    expect(await body(req)).toEqual({ title: '迷路🌏' });
  });

  it('rejects bodies over the limit', async () => {
    const req = Readable.from([Buffer.alloc(8), Buffer.alloc(8)]) as unknown as IncomingMessage;
    await expect(body(req, 10)).rejects.toThrow('Request too large');
  });

  it("keeps Vite's default fs.deny entries alongside the Jev ones", () => {
    const config = (jevPlugin(process.cwd()).config as () => { server: { fs: { deny: string[] } } })();
    expect(config.server.fs.deny).toEqual(
      expect.arrayContaining([
        '.env',
        '.npmrc',
        '**/.git/**',
        '*.{crt,pem,key,p12,pfx,cer,der}',
        '**/local/jev/**',
      ]),
    );
  });

  it('accepts JPEG texture fallbacks but not PNG', () => {
    const create = (textureDataUrl: string) =>
      CreateSchema.shape.maze.unwrap().shape.textureDataUrl.safeParse(textureDataUrl).success;
    expect(create('data:image/webp;base64,AAAA')).toBe(true);
    expect(create('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(create('data:image/png;base64,AAAA')).toBe(false);
  });
});
