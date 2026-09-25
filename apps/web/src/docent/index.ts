/**
 * Phase 15 AI docent, web side. Mount `<DocentPanel/>` inside a `ShowcaseFrame` (it uses the showcase tokens):
 *   <DocentPanel />                    full section (heading beside the desk), as on /about
 *   <DocentPanel variant="compact" />  stacked, as on /log
 */
export { DocentHttpError, parseFrames, streamDocent } from './client.ts';
export { citationHref, DocentPanel, type DocentPanelProps } from './DocentPanel.tsx';
export { DOCENT_STRINGS, EN_SUGGESTIONS } from './strings.ts';
export { type Turn, useDocent } from './useDocent.ts';
