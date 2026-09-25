/**
 * Renders one sample of every share card into docs/build-log/assets/share-cards/ (Phase 18), plus a 552 px
 * preview strip (LinkedIn's unfurl width) for legibility review. Uses fixture stages and capture screenshots only.
 *   pnpm --filter @wwm/worker cards:samples
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { StageData } from '@wwm/schema';
import type { CardData, StageInfo } from '../src/cards/data.ts';
import { fixtureArt, renderNode } from './cards-node.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = `${root}docs/build-log/assets/share-cards/`;
mkdirSync(out, { recursive: true });

const golden = (slug: string) =>
  JSON.parse(readFileSync(`${root}fixtures/builder/${slug}.normal.seed1.json`, 'utf8')) as StageData;
const shot = (slug: string) =>
  new Uint8Array(readFileSync(`${root}fixtures/captures/${slug}/screenshot.png`));

function info(stage: StageData, title: string, host: string, extra: Partial<StageInfo> = {}): StageInfo {
  return {
    stageId: stage.stageId,
    title,
    host,
    slice: { index: stage.source.slice.index, count: stage.source.slice.count },
    difficulty: stage.difficulty,
    stars: null,
    art: { kind: 'islands', texture: 'capture' },
    ...extra,
  };
}

const samples: { file: string; data: CardData; slug?: string }[] = [];
const hn = golden('hn-front');
const gov = golden('govuk-card-grid');
const py = golden('eval-python-home');
const wiki = golden('wikipedia-article');

samples.push({
  file: 'stage-invite',
  slug: 'hn-front',
  data: { kind: 'stage', stage: info(hn, 'Hacker News', 'news.ycombinator.com', { stars: 3 }) },
});
samples.push({
  file: 'stage-invite-long-title',
  slug: 'govuk-card-grid',
  data: {
    kind: 'stage',
    stage: info(
      gov,
      'Welcome to GOV.UK: the best place to find government services and information',
      'gov.uk',
    ),
  },
});
samples.push({
  file: 'score-verified',
  slug: 'eval-python-home',
  data: {
    kind: 'score',
    scoreId: 'sample1',
    stage: info(py, 'Welcome to Python.org', 'python.org'),
    name: 'cocktail_hancock',
    score: 1484,
    rank: 3,
    verified: true,
    detail: { small: 9, large: 2, timeBonus: 1275 },
    timeMs: 45_300,
  },
});
samples.push({
  file: 'score-unverified',
  slug: 'wikipedia-article',
  data: {
    kind: 'score',
    scoreId: 'sample2',
    stage: info(wiki, 'Maze - Wikipedia', 'en.wikipedia.org', {}),
    name: 'a_very_long_player_name_here_x32',
    score: 12_450,
    rank: 128,
    verified: false,
    detail: null,
    timeMs: 187_000,
  },
});
samples.push({
  file: 'run-rank',
  data: {
    kind: 'run',
    scoreId: 'sample3',
    name: 'saqoosha_fan',
    total: 12_450,
    rank: 3,
    sites: 4,
    stages: 7,
    hosts: ['news.ycombinator.com', 'grantland.com', 'en.wikipedia.org', 'python.org'],
  },
});
samples.push({
  file: 'journey',
  data: {
    kind: 'journey',
    hosts: ['news.ycombinator.com', 'grantland.com', 'en.wikipedia.org', 'archive.org', 'python.org'],
    more: 2, // 7 stops: the first four, then the last
    total: 8_732,
    name: 'roller',
  },
});
samples.push({ file: 'site-default', slug: 'handmade', data: { kind: 'site' } });
// A curated stage with an R2 hero shot (the Phase 10 engine render) inside the card.
samples.push({
  file: 'stage-invite-hero',
  slug: 'hero',
  data: {
    kind: 'stage',
    stage: info(gov, 'GOV.UK', 'gov.uk', { stars: 2, art: { kind: 'hero', etag: 'sample' } }),
  },
});
// A title the card fonts can't draw (Japanese): the host becomes the headline.
samples.push({
  file: 'stage-invite-ja',
  slug: 'eval-ja-wikipedia-meiro',
  data: { kind: 'stage', stage: info(golden('eval-ja-wikipedia-meiro'), '', 'ja.wikipedia.org') },
});
samples.push({
  file: 'run-one-site',
  data: {
    kind: 'run',
    scoreId: 'sample4',
    name: 'ann',
    total: 1_484,
    rank: 12,
    sites: 1,
    stages: 1,
    hosts: ['news.ycombinator.com'],
  },
});

for (const s of samples) {
  let art = {};
  if (s.slug === 'hero') {
    const hero = readFileSync(`${root}docs/build-log/assets/phase-10/cards/govuk-card-grid.png`);
    art = { hero: `data:image/png;base64,${hero.toString('base64')}` };
  } else if (s.slug === 'handmade') {
    const stage = JSON.parse(
      readFileSync(`${root}fixtures/stages/handmade-simple.json`, 'utf8'),
    ) as StageData;
    art = await fixtureArt(
      { ...stage, source: { ...stage.source, slice: { ...stage.source.slice, y: 0, height: 1600 } } },
      new Uint8Array(readFileSync(`${root}fixtures/stages/handmade-simple.png`)),
    );
  } else if (s.slug) {
    const stage = s.data.kind === 'stage' || s.data.kind === 'score' ? s.slug : s.slug;
    art = await fixtureArt(golden(stage), shot(stage));
  }
  const r = await renderNode(s.data, art);
  writeFileSync(`${out}${s.file}.png`, r.png);
  if (process.env.CARDS_SVG) writeFileSync(`/tmp/${s.file}.svg`, r.svg);
  // LinkedIn's unfurl width, for the legibility review (not committed)
  if (process.env.CARDS_PREVIEW)
    writeFileSync(`/tmp/${s.file}-552.png`, (await renderNode(s.data, art, undefined, 552)).png);
  console.log(
    `${s.file}.png  ${r.width}×${r.height}  ${(r.png.byteLength / 1024).toFixed(0)} KiB  ${r.ms.toFixed(0)} ms`,
  );
}
