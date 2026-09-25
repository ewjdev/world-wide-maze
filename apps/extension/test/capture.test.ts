/**
 * Extension capture logic with a mocked `chrome.*` (no browser): the scroll-stitch sequence, DPR handling, the
 * fixed-element rule, page restore on failure, the job's handoff, and the manifest's permissions.
 */
import { readFileSync } from 'node:fs';
import { extractPage } from '@wwm/capture-script';
import { CAPTURE_DPR, type CaptureBundle, computeCaptureId, parseCapture } from '@wwm/schema';
import { describe, expect, test, vi } from 'vitest';
import { icon, manifest } from '../scripts/build.ts';
import {
  type CaptureDeps,
  CaptureError,
  captureTab,
  FRAME_INTERVAL_MS,
  type Frame,
  framePlan,
  MAX_IMAGE_PIXELS,
} from '../src/capture.ts';
import type { ChromeApi, Tab } from '../src/chrome.ts';
import { DEV_ORIGIN, originPattern, parseOrigin, receiverUrl } from '../src/config.ts';
import { JobRunner, type JobState, toBase64 } from '../src/job.ts';
import { pageDeliver, pageHideFixed, pagePrepare, pageRestore, pageScrollTo } from '../src/page-fns.ts';
import { POPUP_STRINGS } from '../src/strings.ts';
import { capturable } from '../src/url.ts';

const HN = JSON.parse(
  readFileSync(new URL('../../../fixtures/captures/hn-front/capture.json', import.meta.url), 'utf8'),
) as CaptureBundle;

interface PageModel {
  width: number;
  height: number;
  viewH: number;
  dpr: number;
  url?: string;
}

/** A fake tab + chrome.* that records every call in order. */
function fakeChrome(p: PageModel, opts: { failShotAt?: number } = {}) {
  const log: string[] = [];
  const draws: number[][] = [];
  let scrollY = 0;
  let shots = 0;
  const sleeps: number[] = [];
  const metrics = {
    url: p.url ?? 'https://news.example/?utm_source=x#top',
    title: 'News',
    innerWidth: p.width,
    innerHeight: p.viewH,
    clientWidth: p.width - 15,
    scrollX: 0,
    scrollY: 321,
    scrollHeight: p.height,
    devicePixelRatio: p.dpr,
  };
  const extracted = {
    ...HN,
    page: { width: p.width, height: p.height },
    viewport: { width: p.width, height: p.viewH },
  };
  const api = {
    scripting: {
      executeScript: vi.fn(async (inj: { func: unknown; args?: unknown[] }) => {
        const f = inj.func;
        const arg = inj.args?.[0];
        const answer = (entry: string, result: unknown) => {
          log.push(entry);
          return [{ result }];
        };
        if (f === pagePrepare) return answer('prepare', metrics);
        if (f === extractPage) return answer('extract', extracted);
        if (f === pageScrollTo) {
          scrollY = Math.min(arg as number, p.height - p.viewH);
          return answer(`scroll ${scrollY}`, scrollY);
        }
        if (f === pageHideFixed) return answer('hide', 3);
        if (f === pageRestore) return answer(`restore ${JSON.stringify(arg)}`, true);
        throw new Error(`unexpected func ${String(f)}`);
      }),
    },
    tabs: {
      captureVisibleTab: vi.fn(async () => {
        shots++;
        if (opts.failShotAt === shots) throw new Error('quota');
        log.push(`shot@${scrollY}`);
        return `data:image/png;base64,frame${scrollY}`;
      }),
    },
  } as unknown as CaptureDeps['api'];
  const deps: CaptureDeps = {
    api,
    decode: async () => ({ width: p.width * p.dpr, height: p.viewH * p.dpr }) satisfies Frame,
    surface: (w, h) => {
      log.push(`surface ${w}x${h}`);
      return {
        drawImage: (_i, ...a) => void draws.push(a),
        encode: async () => ({ mime: 'image/webp', bytes: new Uint8Array([1, 2, 3]).buffer }),
      };
    },
    sleep: async (ms) => void sleeps.push(ms),
    now: () => new Date('2026-09-25T12:00:00.000Z'),
  };
  const tab: Tab = { id: 7, windowId: 1, url: metrics.url };
  return { deps, tab, log, draws, sleeps };
}

describe('framePlan', () => {
  test.each([
    [500, 800, [0]],
    [800, 800, [0]],
    [2000, 800, [0, 800, 1200]],
    [2400, 800, [0, 800, 1600]],
    [6000, 900, [0, 900, 1800, 2700, 3600, 4500, 5100]],
  ])('page %i, viewport %i → %j', (h, v, want) => {
    expect(framePlan(h, v)).toEqual(want);
  });
});

describe('captureTab (mocked chrome.*)', () => {
  test('prepare → extract → frame 0 → hide fixed → remaining frames → restore; DPR 2 image; valid bundle', async () => {
    const f = fakeChrome({ width: 1280, height: 2000, viewH: 800, dpr: 2 });
    const steps: string[] = [];
    const out = await captureTab(f.deps, f.tab, (p) =>
      steps.push(p.frame !== undefined ? `${p.step}${p.frame}` : p.step),
    );
    expect(f.log).toEqual([
      'prepare',
      'extract',
      'scroll 0',
      'shot@0',
      'surface 2560x4000',
      'hide', // after the first frame only: a fixed header appears once, at the top
      'scroll 800',
      'shot@800',
      'scroll 1200',
      'shot@1200',
      'restore {"x":0,"y":321}',
    ]);
    // each frame drawn at its page position × scale, cropped to the page height
    expect(f.draws).toEqual([
      [0, 0, 2560, 1600, 0, 0, 2560, 1600],
      [0, 0, 2560, 1600, 0, 1600, 2560, 1600],
      [0, 0, 2560, 1600, 0, 2400, 2560, 1600],
    ]);
    // captureVisibleTab is limited to 2 calls per second
    expect(f.sleeps.every((ms) => ms > 0 && ms <= FRAME_INTERVAL_MS)).toBe(true);
    expect(steps).toEqual(['prepare', 'extract', 'frames0', 'frames1', 'frames2', 'frames3', 'encode']);

    const b = parseCapture(out.bundle);
    expect(b.url).toBe('https://news.example/');
    expect(b.captureId).toBe(await computeCaptureId('https://news.example/', '2026-09-25T12:00:00.000Z'));
    expect(b.screenshot).toEqual({
      path: 'screenshot.webp',
      width: 2560,
      height: 4000,
      format: 'webp',
      scale: 2,
    });
    expect(b.page).toEqual({ width: 1280, height: 2000 });
    expect(out).toMatchObject({ frames: 3, hiddenFixed: 3, image: { mime: 'image/webp' } });
  });

  test('a 3× display is captured at CAPTURE_DPR, a 1× display at 1×', async () => {
    const hi = await captureTab(fakeChrome({ width: 1000, height: 900, viewH: 900, dpr: 3 }).deps, {
      id: 1,
      windowId: 1,
      url: 'https://a.example/',
    });
    expect(hi.bundle.screenshot.scale).toBe(CAPTURE_DPR);
    const lo = await captureTab(fakeChrome({ width: 1000, height: 900, viewH: 900, dpr: 1 }).deps, {
      id: 1,
      windowId: 1,
      url: 'https://a.example/',
    });
    expect(lo.bundle.screenshot).toMatchObject({ scale: 1, width: 1000, height: 900 });
  });

  test('a wide, tall page stays inside the pixel budget', async () => {
    const f = fakeChrome({ width: 3000, height: 6000, viewH: 1000, dpr: 2 });
    const out = await captureTab(f.deps, f.tab);
    const s = out.bundle.screenshot;
    expect(s.width * s.height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS * 1.01);
    expect(s.scale).toBeLessThan(2);
  });

  test('the page is restored even when a screenshot fails', async () => {
    const f = fakeChrome({ width: 1280, height: 2000, viewH: 800, dpr: 2 }, { failShotAt: 2 });
    const err = await captureTab(f.deps, f.tab).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CaptureError);
    expect((err as CaptureError).code).toBe('screenshot');
    expect(f.log.at(-1)).toBe('restore {"x":0,"y":321}');
  });

  test.each([
    'chrome://extensions',
    'https://chromewebstore.google.com/detail/x',
    'file:///tmp/a.html',
    undefined,
  ])('refuses %s without touching the page', async (url) => {
    const f = fakeChrome({ width: 1280, height: 900, viewH: 800, dpr: 1 });
    const err = await captureTab(f.deps, { ...f.tab, url }).catch((e: unknown) => e);
    expect((err as CaptureError).code).toBe('restricted');
    expect(f.log).toEqual([]);
    expect(capturable(url)).toBe(false);
  });

  test('a page the extension may not script is a clear error', async () => {
    const f = fakeChrome({ width: 1280, height: 900, viewH: 800, dpr: 1 });
    (f.deps.api.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Cannot access contents of the page'),
    );
    const err = await captureTab(f.deps, f.tab).catch((e: unknown) => e);
    expect((err as CaptureError).code).toBe('script');
  });
});

describe('JobRunner (capture → open game → hand off)', () => {
  function jobApi(opts: { permitted?: boolean; answer?: { ok: boolean; reason: string } }) {
    const f = fakeChrome({ width: 1280, height: 900, viewH: 800, dpr: 2 });
    const listeners: ((id: number, info: { status?: string }) => void)[] = [];
    const created: string[] = [];
    const delivered: unknown[] = [];
    const base = f.deps.api.scripting.executeScript as ReturnType<typeof vi.fn>;
    const api = {
      tabs: {
        ...f.deps.api.tabs,
        get: async (id: number) => (id === 7 ? f.tab : { id, windowId: 1, status: 'loading' }),
        create: async (p: { url: string }) => {
          created.push(p.url);
          setTimeout(() => {
            for (const l of listeners) l(99, { status: 'complete' });
          }, 5);
          return { id: 99, windowId: 1 };
        },
        onUpdated: {
          addListener: (fn: (id: number, info: { status?: string }) => void) => listeners.push(fn),
          removeListener: () => {},
        },
      },
      scripting: {
        executeScript: vi.fn(async (inj: { func: unknown; target: { tabId: number }; args?: unknown[] }) => {
          if (inj.func === pageDeliver) {
            delivered.push(inj.args?.[0]);
            return [{ result: opts.answer ?? { ok: true, reason: '' } }];
          }
          return (base as unknown as (i: unknown) => Promise<unknown>)(inj);
        }),
      },
      permissions: { contains: async () => opts.permitted ?? true, request: async () => true },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    } as unknown as Pick<ChromeApi, 'tabs' | 'scripting' | 'permissions' | 'action'>;
    const runner = new JobRunner(api, () => ({ ...f.deps, api }));
    return { runner, created, delivered };
  }

  test('success: the game opens at /play/local and receives the bundle + image', async () => {
    const { runner, created, delivered } = jobApi({});
    const seen: JobState['phase'][] = [];
    runner.subscribe((s) => seen.push(s.phase));
    const end = await runner.start({ tabId: 7, origin: DEV_ORIGIN });
    expect(end.phase).toBe('done');
    expect(created).toEqual([receiverUrl(DEV_ORIGIN)]);
    const d = delivered[0] as { origin: string; mime: string; imageBase64: string; bundle: CaptureBundle };
    expect(d.origin).toBe(DEV_ORIGIN);
    expect(d.mime).toBe('image/webp');
    expect(d.imageBase64).toBe(toBase64(new Uint8Array([1, 2, 3]).buffer));
    expect(parseCapture(d.bundle).url).toBe('https://news.example/');
    expect(seen).toEqual(expect.arrayContaining(['idle', 'capturing', 'opening', 'handing', 'done']));
  });

  test('no permission for the game address: stops before capturing', async () => {
    const { runner, created } = jobApi({ permitted: false });
    const end = await runner.start({ tabId: 7, origin: 'https://other.example' });
    expect(end).toMatchObject({ phase: 'error', code: 'permission' });
    expect(created).toEqual([]);
  });

  test('the receiver rejects: the error names the reason', async () => {
    const { runner } = jobApi({ answer: { ok: false, reason: 'too many elements' } });
    const end = await runner.start({ tabId: 7, origin: DEV_ORIGIN });
    expect(end).toMatchObject({ phase: 'error', code: 'handoff' });
    expect(end.phase === 'error' && end.message).toContain('too many elements');
  });
});

describe('config and manifest', () => {
  test.each([
    ['http://localhost:5173', 'http://localhost:5173'],
    ['maze.example', 'https://maze.example'],
    ['https://maze.example/play/x', 'https://maze.example'],
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['http://maze.example', null],
    ['https://user:pw@maze.example', null],
    ['javascript:alert(1)', null],
    ['', null],
  ])('parseOrigin(%s) → %s', (input, want) => {
    expect(parseOrigin(input)).toBe(want);
  });

  test('permissions are activeTab + scripting; host access is the game origin only', () => {
    const dev = manifest(DEV_ORIGIN, 'chrome');
    expect(dev.permissions).toEqual(['activeTab', 'scripting']);
    expect(dev.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
    const prod = manifest('https://maze.example', 'chrome');
    expect(prod.host_permissions).toEqual([originPattern('https://maze.example')]);
    expect(prod.manifest_version).toBe(3);
    expect(prod.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(manifest('https://maze.example', 'firefox').background).toEqual({
      scripts: ['background.js'],
      type: 'module',
    });
  });

  test('icons are real PNGs of the right size', () => {
    const png = icon(48);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(48);
  });

  test('popup strings: en and ja have the same keys', () => {
    expect(Object.keys(POPUP_STRINGS.ja).sort()).toEqual(Object.keys(POPUP_STRINGS.en).sort());
    expect(Object.keys(POPUP_STRINGS.ja.errors).sort()).toEqual(Object.keys(POPUP_STRINGS.en.errors).sort());
  });
});
