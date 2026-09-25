/**
 * Where /making/:stageId gets its material.
 * - A capture fixture slug (`hn-front`, `wikipedia-article` …): the full pipeline, rebuilt live in a Web Worker so
 *   every intermediate layer (masks, candidate bridges) can be shown. `?slice=` picks the slice of a long page.
 * - `handmade-simple`: the hand-authored test stage. No capture, so only the finished-geometry steps.
 * - A 64-hex stage id: fetched from the Worker API. Also finished geometry only.
 */
import { type CaptureBundle, parseCapture, parseStage, type StageData } from '@wwm/schema';

const CAPTURES = import.meta.glob<{ default: unknown }>('../../../../../fixtures/captures/*/capture.json');
const SHOTS = import.meta.glob<string>('../../../../../fixtures/captures/*/screenshot.png', {
  query: '?url',
  import: 'default',
});

export interface FixtureInfo {
  slug: string;
  label: string;
}

const LABELS: Record<string, string> = {
  'govuk-card-grid': 'GOV.UK home page',
  'hn-front': 'Hacker News front page',
  'wikipedia-article': 'Wikipedia: Labyrinth',
  'mdn-dark-docs': 'MDN docs, dark theme',
  'image-gallery': 'Wikimedia Commons: Picture of the day',
  'example-sparse': 'example.com',
};

export const FIXTURES: FixtureInfo[] = Object.keys(CAPTURES)
  .map((p) => p.split('/').at(-2) ?? '')
  .filter((slug) => slug)
  .sort((a, b) => Object.keys(LABELS).indexOf(a) - Object.keys(LABELS).indexOf(b))
  .map((slug) => ({ slug, label: LABELS[slug] ?? slug }));

export const DEFAULT_SOURCE = 'govuk-card-grid';

export type Source =
  | { kind: 'capture'; slug: string; capture: CaptureBundle; screenshotUrl: string }
  | { kind: 'stage'; id: string; stage: StageData; textureUrl: string; replayUrl?: string };

const HEX64 = /^[0-9a-f]{64}$/;

export async function loadSource(id: string, fetchImpl: typeof fetch = fetch): Promise<Source> {
  const cap = Object.entries(CAPTURES).find(([p]) => p.endsWith(`/${id}/capture.json`));
  if (cap) {
    const [path, load] = cap;
    const shot = SHOTS[path.replace('capture.json', 'screenshot.png')];
    if (!shot) throw new Error(`no screenshot for ${id}`);
    return {
      kind: 'capture',
      slug: id,
      capture: parseCapture((await load()).default),
      screenshotUrl: await shot(),
    };
  }
  if (id === 'handmade-simple') {
    const [json, png, replay] = await Promise.all([
      import('../../../../../fixtures/stages/handmade-simple.json'),
      import('../../../../../fixtures/stages/handmade-simple.png?url'),
      import('../../../../../fixtures/replays/handmade-simple.keyboard.json?url'),
    ]);
    return {
      kind: 'stage',
      id,
      stage: parseStage(json.default),
      textureUrl: png.default,
      replayUrl: replay.default,
    };
  }
  if (HEX64.test(id)) {
    const res = await fetchImpl(`/api/stages/${id}`);
    if (!res.ok)
      throw new Error(
        res.status === 404 ? 'That stage doesn’t exist (or has expired).' : `HTTP ${res.status}`,
      );
    const stage = parseStage(await res.json());
    return {
      kind: 'stage',
      id,
      stage,
      textureUrl: `/api/stages/${id}/${stage.texture.path.split('/').at(-1) ?? 'texture'}`,
    };
  }
  throw new Error('Unknown stage. Pick one of the pages below.');
}

export async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
}
