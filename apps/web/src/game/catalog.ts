/**
 * The curated / offline catalog: the practice stage (handmade-simple, E: "Practice site") and the Phase 02
 * fixture captures, built into stages client-side by @wwm/stage-builder. This doubles as the preservation
 * mode: it plays with no worker at all. Stars are a difficulty rating (E: "Popular sites" had stars), set by
 * hand from the builder stats (N).
 */
export interface CatalogEntry {
  /** Run id: `practice` or `fixture-<slug>`; also the `/play/:stageId` deep-link ref. */
  id: string;
  slug: string;
  title: string;
  url: string;
  host: string;
  stars: number;
  /** Page height in CSS px (slice count comes from it). */
  pageHeight: number;
  thumb: string;
}

export const PRACTICE: CatalogEntry = {
  id: 'practice',
  slug: 'handmade-simple',
  title: 'Practice site',
  url: 'wwm:practice',
  host: 'practice',
  stars: 1,
  pageHeight: 800,
  thumb: '/thumbs/practice.webp',
};

const fx = (slug: string, title: string, url: string, stars: number, pageHeight: number): CatalogEntry => ({
  id: `fixture-${slug}`,
  slug,
  title,
  url,
  host: new URL(url).host.replace(/^www\./, ''),
  stars,
  pageHeight,
  thumb: `/thumbs/${slug}.webp`,
});

export const FIXTURES: CatalogEntry[] = [
  fx('hn-front', 'Hacker News', 'https://news.ycombinator.com/', 3, 1214),
  fx('wikipedia-article', 'Labyrinth – Wikipedia', 'https://en.wikipedia.org/wiki/Labyrinth', 3, 6000),
  fx('govuk-card-grid', 'Welcome to GOV.UK', 'https://www.gov.uk/', 2, 4550),
  // bbc-news-grid is an internal builder fixture only (© BBC photos) and is never offered in the game.
  fx(
    'mdn-dark-docs',
    'Range: getClientRects() – MDN',
    'https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects',
    4,
    3671,
  ),
  fx(
    'image-gallery',
    'Picture of the day – Wikimedia Commons',
    'https://commons.wikimedia.org/wiki/Commons:Picture_of_the_day',
    3,
    6000,
  ),
  fx('example-sparse', 'Example Domain', 'https://example.com/', 1, 800),
];

export const CATALOG: CatalogEntry[] = [PRACTICE, ...FIXTURES];

export function catalogEntry(id: string): CatalogEntry | undefined {
  if (id === 'handmade-simple') return PRACTICE;
  return CATALOG.find((c) => c.id === id);
}

/** The stage the title screen orbits (attract mode) before Phase 09's solver ghost exists. */
export const ATTRACT_ID = 'fixture-hn-front';
