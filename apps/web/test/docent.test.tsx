/** Phase 15: the docent client (SSE over a POST body) and the panel mounted on /about and /log. */
import type { DocentEvent } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import { parseFrames, streamDocent } from '../src/docent/client.ts';
import { citationHref } from '../src/docent/DocentPanel.tsx';
import { DOCENT_STRINGS, EN_SUGGESTIONS } from '../src/docent/strings.ts';
import { renderRoute } from './render-route.tsx';

const frames = (events: DocentEvent[]) =>
  events
    .map((e) => {
      const { type, ...data } = e;
      return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    })
    .join('');

describe('docent client', () => {
  test('parseFrames keeps an unfinished frame for the next chunk', () => {
    const all = frames([{ type: 'delta', text: 'Hi [1]' }, { type: 'done' }]);
    const cut = all.length - 5;
    const a = parseFrames(all.slice(0, cut));
    expect(a.events).toEqual([{ type: 'delta', text: 'Hi [1]' }]);
    const b = parseFrames(a.rest + all.slice(cut));
    expect(b.events).toEqual([{ type: 'done' }]);
  });

  test('streamDocent reads events split across arbitrary byte chunks, whatever the status', async () => {
    const body = frames([
      { type: 'delta', text: 'PARTY was the agency ' },
      { type: 'delta', text: '[1].' },
      {
        type: 'citations',
        items: [{ title: 'Who made it', path: 'a.ts', anchor: 'credits', url: '/about#credits' }],
      },
      { type: 'done' },
    ]);
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    let sent: unknown;
    const fake = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    const got: DocentEvent[] = [];
    await streamDocent({ question: 'Who made the original?' }, { fetch: fake, onEvent: (e) => got.push(e) });
    expect(sent).toEqual({ question: 'Who made the original?' });
    expect(got.map((e) => e.type)).toEqual(['delta', 'delta', 'citations', 'done']);

    const limited = (async () =>
      new Response(frames([{ type: 'error', code: 'RATE_LIMITED', message: 'slow down' }]), {
        status: 429,
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof fetch;
    const errs: DocentEvent[] = [];
    await streamDocent({ question: 'q' }, { fetch: limited, onEvent: (e) => errs.push(e) });
    expect(errs).toEqual([{ type: 'error', code: 'RATE_LIMITED', message: 'slow down' }]);

    const html404 = (async () => new Response('<html>', { status: 404 })) as unknown as typeof fetch;
    await expect(streamDocent({ question: 'q' }, { fetch: html404, onEvent: () => {} })).rejects.toThrow(
      /404/,
    );
  });

  test('citation links: site pages, GitHub when the repo is public, else none', () => {
    expect(
      citationHref({ title: 't', path: 'docs/build-log/phase-10.md', url: '/log#phase-10' }, null),
    ).toEqual({
      href: '/log#phase-10',
      site: true,
    });
    expect(
      citationHref({ title: 't', path: 'RESEARCH.md', anchor: 'part-1' }, 'https://github.com/o/r'),
    ).toEqual({
      href: 'https://github.com/o/r/blob/main/RESEARCH.md#part-1',
      site: false,
    });
    expect(citationHref({ title: 't', path: 'RESEARCH.md' }, null)).toBeNull();
  });
});

describe('docent panel', () => {
  test('/about and /log mount it with the suggested questions', async () => {
    for (const path of ['/about', '/log']) {
      const html = await renderRoute(path);
      expect(html, path).toContain('Ask the docent');
      expect(html, path).toContain('id="ask"');
      for (const q of EN_SUGGESTIONS) expect(html, path).toContain(q);
      expect(html, path).toMatch(/<label[^>]*>Your question<\/label>/);
    }
  });

  test('English and Japanese strings cover the same keys; Japanese suggestions ask the English question', () => {
    expect(Object.keys(DOCENT_STRINGS.ja).sort()).toEqual(Object.keys(DOCENT_STRINGS.en).sort());
    expect(DOCENT_STRINGS.ja.suggestions.map((s) => s.ask.split(' (')[0])).toEqual(EN_SUGGESTIONS);
  });
});
