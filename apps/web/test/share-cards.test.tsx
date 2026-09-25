/** Phase 18: score permalinks, card image URLs, Web Share with the card file, and the card preview markup. */
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createRankingClient } from '../src/ranking/client.ts';
import { CardPreview } from '../src/ranking/ShareButton.tsx';
import { cardImage, fetchCardFile, runUrl, scoreUrl, shareLink } from '../src/ranking/share.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubDevice(o: { coarse: boolean; canShareFiles: boolean }) {
  const shared: unknown[] = [];
  const copied: string[] = [];
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse') ? o.coarse : false }));
  vi.stubGlobal('navigator', {
    share: async (d: unknown) => {
      shared.push(d);
    },
    canShare: (d: { files?: File[] }) => (d.files ? o.canShareFiles : true),
    clipboard: {
      writeText: async (s: string) => {
        copied.push(s);
      },
    },
  });
  return { shared, copied };
}

describe('share links', () => {
  test('permalinks and card image paths', () => {
    expect(scoreUrl('https://wwm.ewj.dev/', 'a'.repeat(64), 'AbCdEfGhIjKlMnOp')).toBe(
      `https://wwm.ewj.dev/s/${'a'.repeat(64)}/r/AbCdEfGhIjKlMnOp`,
    );
    expect(runUrl('https://wwm.ewj.dev', 'AbCdEfGhIjKlMnOp')).toBe('https://wwm.ewj.dev/r/AbCdEfGhIjKlMnOp');
    expect(cardImage('score', 'AbCd_-')).toBe('/api/cards/score/AbCd_-.png');
    expect(cardImage('site', 'default')).toBe('/api/cards/site/default.png');
  });

  test('phones share the card file with the link in the text', async () => {
    const d = stubDevice({ coarse: true, canShareFiles: true });
    const file = new File([new Uint8Array([1])], 'c.png', { type: 'image/png' });
    expect(await shareLink({ url: 'https://x/r/1', title: 'T', text: 'Beat me', file })).toBe('shared');
    expect(d.shared[0]).toEqual({ files: [file], title: 'T', text: 'Beat me\nhttps://x/r/1' });
  });

  test('phones that cannot share files share the plain link', async () => {
    const d = stubDevice({ coarse: true, canShareFiles: false });
    const file = new File([new Uint8Array([1])], 'c.png', { type: 'image/png' });
    await shareLink({ url: 'https://x/r/1', title: 'T', text: 'Beat me', file });
    expect(d.shared[0]).toEqual({ url: 'https://x/r/1', title: 'T', text: 'Beat me' });
  });

  test('desktops copy the link', async () => {
    const d = stubDevice({ coarse: false, canShareFiles: true });
    expect(await shareLink({ url: 'https://x/s/abc', title: 'T', text: 't' })).toBe('copied');
    expect(d.copied).toEqual(['https://x/s/abc']);
    expect(d.shared).toEqual([]);
  });

  test('the card file is only taken from an image response', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(new Uint8Array([137, 80]), { headers: { 'content-type': 'image/png' } }),
    );
    const f = await fetchCardFile('/api/cards/site/default.png');
    expect(f?.type).toBe('image/png');
    vi.stubGlobal('fetch', async () => Response.json({ error: 'card not found' }, { status: 404 }));
    expect(await fetchCardFile('/api/cards/score/x.png')).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    expect(await fetchCardFile('/api/cards/score/x.png')).toBeNull();
  });

  test('the ranking client keeps the server’s scoreId (and ignores malformed ones)', async () => {
    const answers = [
      Response.json({ rank: 2, verified: true, scoreId: 'AbCdEfGhIjKlMnOp' }, { status: 201 }),
      Response.json({ rank: 2, scoreId: '<bad>' }, { status: 201 }),
    ];
    const client = createRankingClient({ fetch: async () => answers.shift() as Response });
    const sub = { stageId: 's', name: 'mika', score: 10, timeMs: 1000 };
    expect(await client.submitStage(sub)).toMatchObject({ ok: true, scoreId: 'AbCdEfGhIjKlMnOp' });
    expect(await client.submitStage(sub)).not.toHaveProperty('scoreId');
  });

  test('the card preview reserves the card’s shape while it loads', () => {
    const html = renderToString(<CardPreview src="/api/cards/stage/abc.png" alt="Link preview" />);
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('src="/api/cards/stage/abc.png"');
    expect(html).toContain('width="1200"');
    expect(html).toContain('alt="Link preview"');
  });
});
