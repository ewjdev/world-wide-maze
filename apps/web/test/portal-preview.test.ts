/** Portal windows (N; plans/portal-windows-execution.md): the flag, the fixture picture source and the loader. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StageData } from '@wwm/schema';
import { describe, expect, test } from 'vitest';
import {
  PortalPreviews,
  type PreviewService,
  pngSize,
  portalWindowsEnabled,
  previewablePortals,
  topSquare,
} from '../src/game/portal-preview.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

describe('flag', () => {
  test('needs an explicit "true", even in development', () => {
    expect(portalWindowsEnabled({})).toBe(false);
    expect(portalWindowsEnabled({ VITE_PORTAL_WINDOWS_ENABLED: '1' })).toBe(false);
    expect(portalWindowsEnabled({ VITE_PORTAL_WINDOWS_ENABLED: 'false' })).toBe(false);
    expect(portalWindowsEnabled({ VITE_PORTAL_WINDOWS_ENABLED: 'true' })).toBe(true);
  });
});

describe('picture helpers', () => {
  test('pngSize reads the IHDR of a real fixture screenshot', () => {
    const bytes = readFileSync(resolve(ROOT, 'fixtures/captures/portal-hub/screenshot.png'));
    expect(pngSize(new Uint8Array(bytes.subarray(0, 24)))).toEqual({ width: 2560, height: 1972 });
  });

  test('pngSize rejects anything that is not a PNG', () => {
    expect(pngSize(new Uint8Array(24))).toBeNull();
    expect(pngSize(new Uint8Array(8))).toBeNull();
  });

  test('topSquare keeps the top of the page, centred', () => {
    expect(topSquare(2560, 1972)).toEqual({ sx: 294, sy: 0, sw: 1972, sh: 1972 });
    expect(topSquare(1280, 6000)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 1280 });
  });
});

describe('previewable portals', () => {
  const stage = (hrefs: string[]) =>
    ({ portals: hrefs.map((href, id) => ({ id, href })) }) as unknown as StageData;

  test('fixture targets only; real sites and Pip gates are skipped', () => {
    const got = previewablePortals(
      stage([
        'https://en.wikipedia.org/wiki/Labyrinth',
        'https://www.w3.org/',
        'https://example.com/',
        'wwm-learning:sky-islands/1#4f9fd6',
      ]),
    );
    expect(got.map((p) => [p.id, p.entry.slug])).toEqual([
      [0, 'wikipedia-article'],
      [2, 'example-sparse'],
    ]);
  });

  test('the portal-hub fixture stage has portals to at least three fixtures', () => {
    const golden = JSON.parse(
      readFileSync(resolve(ROOT, 'fixtures/builder/portal-hub.normal.seed1.json'), 'utf8'),
    ) as StageData;
    expect(previewablePortals(golden).length).toBeGreaterThanOrEqual(3);
  });

  test('a stage without portals has nothing to show', () => {
    expect(previewablePortals({} as StageData)).toEqual([]);
  });
});

describe('PortalPreviews (the per-stage loader)', () => {
  const HUB = JSON.parse(
    readFileSync(resolve(ROOT, 'fixtures/builder/portal-hub.normal.seed1.json'), 'utf8'),
  ) as StageData;
  const pic = (slug: string) => ({ slug }) as unknown as ImageBitmap;
  const deferred = <T>() => {
    let resolveIt!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolveIt = r;
    });
    return { promise, resolve: resolveIt };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('every link portal gets the postcard at once; fixture targets then get their picture', async () => {
    const shown: [number, unknown][] = [];
    const previews = new PortalPreviews({ fixture: async (e) => pic(e.slug) });
    previews.start(HUB, (id, p) => shown.push([id, p]));
    expect(shown.filter(([, p]) => p === 'postcard').map(([id]) => id)).toEqual([0, 1, 2, 3]);
    expect(previews.states()).toEqual({ 0: 'postcard', 1: 'looking-up', 2: 'looking-up', 3: 'looking-up' });
    await flush();
    expect(previews.states()).toEqual({ 0: 'postcard', 1: 'ready', 2: 'ready', 3: 'ready' });
    expect(
      shown.filter(([, p]) => p !== 'postcard').map(([id, p]) => [id, (p as { slug: string }).slug]),
    ).toEqual([
      [1, 'wikipedia-article'],
      [2, 'govuk-card-grid'],
      [3, 'example-sparse'],
    ]);
  });

  test('a missing or failed picture leaves the postcard, without retrying', async () => {
    let calls = 0;
    const previews = new PortalPreviews({
      fixture: async (e) => {
        calls++;
        if (e.slug === 'govuk-card-grid') throw new Error('decode failed');
        return e.slug === 'example-sparse' ? null : pic(e.slug);
      },
    });
    const shown: [number, unknown][] = [];
    previews.start(HUB, (id, p) => shown.push([id, p]));
    await flush();
    expect(previews.states()).toEqual({ 0: 'postcard', 1: 'ready', 2: 'postcard', 3: 'postcard' });
    expect(calls).toBe(3);
    expect(shown.filter(([, p]) => p !== 'postcard')).toHaveLength(1);
  });

  test('a picture that arrives after the stage changed is dropped', async () => {
    const d = deferred<ImageBitmap | null>();
    const previews = new PortalPreviews({ fixture: () => d.promise });
    const shown: [number, unknown][] = [];
    previews.start(HUB, (id, p) => shown.push([id, p]));
    previews.start({ ...HUB, portals: [] }, (id, p) => shown.push([id, p]));
    d.resolve(pic('late'));
    await flush();
    expect(shown.filter(([, p]) => p !== 'postcard')).toEqual([]);
    expect(previews.states()).toEqual({});
  });

  test('stop() drops pending pictures, and current() gates what is shown', async () => {
    const d = deferred<ImageBitmap | null>();
    const shown: unknown[] = [];
    const a = new PortalPreviews({ fixture: () => d.promise });
    a.start(HUB, (_, p) => shown.push(p));
    a.stop();
    const b = new PortalPreviews({ fixture: async (e) => pic(e.slug) });
    b.start(
      HUB,
      (_, p) => shown.push(p),
      () => false,
    );
    d.resolve(pic('late'));
    await flush();
    expect(shown.every((p) => p === 'postcard')).toBe(true);
    expect(b.states()[1]).toBe('ready');
  });

  test('Pip gates are never touched', () => {
    const shown: number[] = [];
    new PortalPreviews({ fixture: async () => null }).start(
      { portals: [{ id: 7, href: 'wwm-learning:sky-islands/1#4f9fd6' }] } as unknown as StageData,
      (id) => shown.push(id),
    );
    expect(shown).toEqual([]);
  });
});

describe('PortalPreviews with the capture service (M3)', () => {
  const HUB = JSON.parse(
    readFileSync(resolve(ROOT, 'fixtures/builder/portal-hub.normal.seed1.json'), 'utf8'),
  ) as StageData;
  const W3 = 'https://www.w3.org/';
  const STAGE_W3 = 'c3'.repeat(32);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const pic = () => ({ close() {} }) as unknown as ImageBitmap;
  /** Fixture pictures resolve; built-site textures decode to a fake bitmap. */
  const sources = { fixture: async () => pic(), decode: async () => pic() };

  function fakeService(
    o: { online?: boolean; ids?: Record<string, string | null>; failTexture?: boolean } = {},
  ) {
    const calls = { lookup: [] as string[][], texture: [] as string[], online: 0 };
    const service: PreviewService = {
      async online() {
        calls.online++;
        return o.online ?? true;
      },
      async lookup(hrefs) {
        calls.lookup.push(hrefs);
        return hrefs.map((h) => o.ids?.[h] ?? null);
      },
      async texture(id) {
        calls.texture.push(id);
        if (o.failTexture) throw new Error('boom');
        return new Blob(['webp'], { type: 'image/webp' });
      },
    };
    return { service, calls };
  }

  test('a built site shows its texture: one batched lookup, one texture, a blob: URL for the travel window', async () => {
    const { service, calls } = fakeService({ ids: { [W3]: STAGE_W3 } });
    const previews = new PortalPreviews(sources);
    const shown: [number, unknown][] = [];
    previews.start(HUB, (id, p) => shown.push([id, p]), undefined, service);
    expect(previews.states()[0]).toBe('looking-up');
    await flush();
    await flush();
    expect(previews.states()).toEqual({ 0: 'ready', 1: 'ready', 2: 'ready', 3: 'ready' });
    expect(calls.lookup).toEqual([[W3]]);
    expect(calls.texture).toEqual([STAGE_W3]);
    expect(previews.source(0)).toMatch(/^blob:/);
    expect(shown.filter(([id, p]) => id === 0 && p !== 'postcard')).toHaveLength(1);
  });

  test('offline, an unknown site and a failed texture all leave the postcard', async () => {
    for (const [o, lookups] of [
      [{ online: false, ids: { [W3]: STAGE_W3 } }, 0],
      [{ ids: {} }, 1],
      [{ ids: { [W3]: STAGE_W3 }, failTexture: true }, 1],
    ] as const) {
      const { service, calls } = fakeService(o);
      const previews = new PortalPreviews(sources);
      previews.start(HUB, () => {}, undefined, service);
      await flush();
      await flush();
      expect(previews.states()[0]).toBe('postcard');
      expect(previews.source(0)).toBeNull();
      expect(calls.lookup).toHaveLength(lookups);
    }
  });

  test('a retry of the same stage reuses the texture without new requests', async () => {
    const { service, calls } = fakeService({ ids: { [W3]: STAGE_W3 } });
    const previews = new PortalPreviews(sources);
    previews.start(HUB, () => {}, undefined, service);
    await flush();
    await flush();
    previews.start(HUB, () => {}, undefined, service);
    await flush();
    await flush();
    expect(previews.states()[0]).toBe('ready');
    expect(calls.lookup).toHaveLength(1);
    expect(calls.texture).toHaveLength(1);
  });

  test('leaving the stage revokes its blob: URLs, except the one taken by the travel', async () => {
    const revoked: string[] = [];
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (u: string) => {
      revoked.push(u);
      revoke(u);
    };
    try {
      const { service } = fakeService({ ids: { [W3]: STAGE_W3 } });
      const a = new PortalPreviews(sources);
      a.start(HUB, () => {}, undefined, service);
      await flush();
      await flush();
      const url = a.source(0) as string;
      a.stop();
      expect(revoked).toEqual([url]);
      revoked.length = 0;
      const b = new PortalPreviews(sources);
      b.start(HUB, () => {}, undefined, fakeService({ ids: { [W3]: STAGE_W3 } }).service);
      await flush();
      await flush();
      const taken = b.take(0);
      expect(taken).toMatch(/^blob:/);
      b.stop();
      expect(revoked).toEqual([]); // fixture asset URLs and the taken blob are never revoked here
    } finally {
      URL.revokeObjectURL = revoke;
    }
  });

  test('a stage change mid-lookup drops the result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { service } = fakeService({ ids: { [W3]: STAGE_W3 } });
    const slow: PreviewService = { ...service, lookup: async (h, s) => (await gate, service.lookup(h, s)) };
    const previews = new PortalPreviews(sources);
    const shown: [number, unknown][] = [];
    previews.start(HUB, (id, p) => shown.push([id, p]), undefined, slow);
    previews.start({ ...HUB, stageId: 'other', portals: [] }, () => {}, undefined, slow);
    release();
    await flush();
    await flush();
    expect(shown.filter(([id, p]) => id === 0 && p !== 'postcard')).toEqual([]);
  });
});
