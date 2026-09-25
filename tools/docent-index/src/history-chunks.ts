/**
 * The `/about` history data (apps/web/src/pages/about/history.ts, Phase 10) as corpus chunks. Only what that file
 * states is written out, with its source labels and URLs, so the docent can cite the same evidence the page shows.
 */
import {
  CREDITS,
  GAPS,
  ORIGINAL_ASSETS_NOTE,
  SONG,
  type Source,
  SRC,
  TECH,
  TIMELINE,
} from '../../../apps/web/src/pages/about/history.ts';
import { approxTokens, MAX_TOKENS, splitText } from './chunk.ts';
import type { CorpusChunk } from './types.ts';

export const HISTORY_PATH = 'apps/web/src/pages/about/history.ts';
const DOC = 'About page history data';

const src = (list: Source[]) => (list.length ? ` (sources: ${list.map((s) => s.label).join('; ')})` : '');

function sectionChunks(anchor: string, heading: string, text: string): CorpusChunk[] {
  const pieces = approxTokens(text) > MAX_TOKENS ? splitText(text) : [text];
  return pieces.map((t, i) => ({
    id: `${HISTORY_PATH}#${anchor}${i ? `~${i + 1}` : ''}`,
    title: `${DOC} › ${heading}${i ? ' (continued)' : ''}`,
    path: HISTORY_PATH,
    anchor,
    url: `/about#${anchor}`,
    kind: 'history' as const,
    text: t,
  }));
}

export function historyChunks(): CorpusChunk[] {
  const credits = [
    'Who made the original World Wide Maze (2013), as recorded in award entries (narrower roles only where the people themselves describe them):',
    ...CREDITS.map((c) => `- ${c.name}${c.where ? ` (${c.where})` : ''}: ${c.role}${src(c.sources)}`),
    'This is not a complete list of the individual designers, engineers, producers and sound contributors.',
    '',
    `Promotional song: "${SONG.title}" by ${SONG.artist}, released ${SONG.released}. It was the launch's promotional music, not the in-game soundtrack. Credits: ${SONG.credits.map(([k, v]) => `${k}: ${v}`).join('; ')}${src([...SONG.sources, SRC.label])}.`,
  ].join('\n');

  const timeline = [
    'Timeline of World Wide Maze. Only events with a source; dates are as precise as the source allows.',
    ...TIMELINE.map(
      (e) =>
        `- ${e.date}: ${e.text}${e.kind === 'secondary' ? ' [secondary testimony]' : ''}${e.kind === 'tribute' ? ' [this tribute project]' : ''}${src(e.sources)}`,
    ),
  ].join('\n');

  const tech = [
    'How it worked, then (2013) and now (this rebuild).',
    ...TECH.map((t) => `- ${t.part}. 2013: ${t.was}${src(t.wasSources)} This rebuild: ${t.now}`),
  ].join('\n');

  const gaps = [
    'What this is, and isn’t: this is a tribute, not a restoration. The original servers, the phone controller’s code and the art and sound were not recovered.',
    ORIGINAL_ASSETS_NOTE,
    'Things nobody outside the original team can confirm from public sources yet:',
    ...GAPS.map((g) => `- ${g}`),
  ].join('\n');

  const sources = [
    'Sources used on the About page (label: URL). Saqoosha’s case study is the most complete first-person account of how the game worked.',
    ...Object.values(SRC).map((s) => `- ${s.label}: ${s.url}`),
  ].join('\n');

  return [
    ...sectionChunks('credits', 'Who made it', credits),
    ...sectionChunks('timeline', 'Timeline', timeline),
    ...sectionChunks('tech', 'How it worked, then and now', tech),
    ...sectionChunks('isnt', 'What this is, and isn’t', gaps),
    ...sectionChunks('sources', 'Sources', sources),
  ];
}
