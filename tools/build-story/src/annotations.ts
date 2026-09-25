/**
 * Annotations: the only hand-written inputs to the timeline. They attach names to measured things (which phase an
 * agent run was, what an owner message was about); they never supply a number. Each is checkable against
 * plans/00-overview.md, the agent's own brief, or the commit history.
 */
import type { RunKind } from './types.ts';

export interface RunLabel {
  phase: string;
  title: string;
  /** The overview's wave for phases; for follow-ups, the wave that was running when they started. */
  wave: number;
  kind: RunKind;
  /** docs/build-log file (without .md) and which "Start / end" line in it (0 = first). */
  log?: { slug: string; window: number };
  /** For runs merged without a "Merge phase XX" subject: the merge commit's subject prefix. */
  mergeSubject?: string;
}

/** Keyed by the description the orchestrator gave each sub-agent when launching it. */
export const RUN_LABELS: Record<string, RunLabel> = {
  'Phase 01 reference spec': {
    phase: '01',
    title: 'Reference and fidelity spec',
    wave: 0,
    kind: 'phase',
    log: { slug: 'phase-01', window: 0 },
  },
  'Phase 02 foundation monorepo': {
    phase: '02',
    title: 'Foundation',
    wave: 0,
    kind: 'phase',
    log: { slug: 'phase-02', window: 0 },
  },
  'Schema v0.2 contract update': {
    phase: '02b',
    title: 'Contracts v0.2',
    wave: 0,
    kind: 'follow-up',
    log: { slug: 'phase-02', window: 1 },
  },
  'Phase 03 stage builder': {
    phase: '03',
    title: 'Stage builder',
    wave: 1,
    kind: 'phase',
    log: { slug: 'phase-03', window: 0 },
  },
  'Phase 04 renderer engine': {
    phase: '04',
    title: 'Renderer',
    wave: 1,
    kind: 'phase',
    log: { slug: 'phase-04', window: 0 },
  },
  'Phase 05 physics sim': {
    phase: '05',
    title: 'Physics',
    wave: 1,
    kind: 'phase',
    log: { slug: 'phase-05', window: 0 },
  },
  'Phase 06 phone controller': {
    phase: '06',
    title: 'Phone controller',
    wave: 1,
    kind: 'phase',
    log: { slug: 'phase-06', window: 0 },
  },
  'Phase 07 capture service': {
    phase: '07',
    title: 'Capture service',
    wave: 1,
    kind: 'phase',
    log: { slug: 'phase-07', window: 0 },
  },
  'Phase 08 game integration': {
    phase: '08',
    title: 'Game integration',
    wave: 2,
    kind: 'phase',
    log: { slug: 'phase-08', window: 0 },
  },
  'Phase 09 solver validation': {
    phase: '09',
    title: 'Solver bot',
    wave: 2,
    kind: 'phase',
    log: { slug: 'phase-09', window: 0 },
  },
  'Engine polish follow-ups': { phase: '04b', title: 'Engine polish', wave: 3, kind: 'follow-up' },
  'Phase 10 showcase & leaderboards': {
    phase: '10',
    title: 'Showcase and leaderboards',
    wave: 3,
    kind: 'phase',
    log: { slug: 'phase-10', window: 0 },
  },
  'Wire ranking/ghost into game': {
    phase: '08b',
    title: 'Leaderboards in the game',
    wave: 3,
    kind: 'follow-up',
    log: { slug: 'phase-08', window: 1 },
  },
  'Builder/physics fixes from solver': {
    phase: '03b/05b',
    title: 'Fixes for the solver’s bugs',
    wave: 3,
    kind: 'follow-up',
  },
  'Phase 12 local launch hardening': {
    phase: '12',
    title: 'Launch hardening',
    wave: 4,
    kind: 'phase',
    log: { slug: 'phase-12', window: 0 },
  },
  'Security & pipeline follow-ups': {
    phase: '12b',
    title: 'Security follow-ups',
    wave: 4,
    kind: 'follow-up',
    log: { slug: 'phase-12', window: 1 },
  },
  'Phase 13 link portals': {
    phase: '13',
    title: 'Link portals',
    wave: 5,
    kind: 'phase',
    log: { slug: 'phase-13', window: 0 },
  },
  'Phase 14 extension and bookmarklet': {
    phase: '14',
    title: 'Extension',
    wave: 5,
    kind: 'phase',
    log: { slug: 'phase-14', window: 0 },
  },
  'Phase 15 AI docent': {
    phase: '15',
    title: 'AI docent',
    wave: 5,
    kind: 'phase',
    log: { slug: 'phase-15', window: 0 },
  },
  'Phase 16 build story': {
    phase: '16',
    title: 'Build story',
    wave: 5,
    kind: 'phase',
    log: { slug: 'phase-16', window: 0 },
  },
  'Fill legal drafts with placeholders': {
    phase: 'A3',
    title: 'Legal drafts',
    wave: 5,
    kind: 'follow-up',
    mergeSubject: 'Merge legal drafts',
  },
  'Phase 17 Cloudflare previews pipeline': {
    phase: '17',
    title: 'Cloudflare deploys and previews',
    wave: 5,
    kind: 'phase',
    log: { slug: 'phase-17', window: 0 },
  },
  'Pre-publication content scrub': {
    phase: 'scrub',
    title: 'Pre-publication scrub',
    wave: 5,
    kind: 'follow-up',
    mergeSubject: 'Merge pre-publication content scrub',
  },
  'Docent model bake-off harness': {
    phase: '15b',
    title: 'Docent model bake-off',
    wave: 5,
    kind: 'follow-up',
  },
  'Refresh build story post-purge': {
    phase: '16b',
    title: 'Build story refresh',
    wave: 5,
    kind: 'follow-up',
    log: { slug: 'phase-16', window: 1 },
  },
};

export const WAVES: Record<number, string> = {
  0: 'Wave 0 · reference and foundation',
  1: 'Wave 1 · components',
  2: 'Wave 2 · integration and solver',
  3: 'Wave 3 · showcase and fixes',
  4: 'Wave 4 · launch hardening',
  5: 'Wave 5 · next-level tribute and launch prep',
};

/**
 * What each owner message was about, keyed by its UTC minute (YYYY-MM-DDTHH:MM). The transcript extract keeps no
 * text, so these short labels are the only record of content, written for this page.
 */
export const OWNER_LABELS: Record<string, { kind: string; label: string }> = {
  '2026-09-25T06:46': { kind: 'brief', label: 'Asks to learn everything about World Wide Maze' },
  '2026-09-25T07:06': { kind: 'brief', label: 'Asks for an overview plan with one file per phase' },
  '2026-09-25T07:18': { kind: 'approval', label: 'Approves the plan; mentions the attached iPhone' },
  '2026-09-25T08:46': { kind: 'verdict', label: 'Signs off the iPhone controller test: “looks good to me”' },
  '2026-09-25T09:10': { kind: 'approval', label: 'Goes to bed; OK to continue without approval' },
  '2026-09-25T14:27': { kind: 'question', label: 'Asks how to test on the phone' },
  '2026-09-25T16:29': { kind: 'bug report', label: 'Reports that repeated dev:phone runs collide' },
  '2026-09-25T16:41': { kind: 'planning', label: 'Asks for the remaining features' },
  '2026-09-25T16:50': { kind: 'approval', label: 'Chooses to launch sooner; approves wave 5' },
  '2026-09-25T17:08': {
    kind: 'approval',
    label: 'Approves the curated list; asks for placeholder legal drafts; offers a Cloudflare account',
  },
  '2026-09-25T17:44': {
    kind: 'approval',
    label: 'Approves the names, a public repo, the wwm.ewj.dev domain and deploy on merge',
  },
  '2026-09-25T18:10': { kind: 'question', label: 'Asks how AI is used, to choose the docent model' },
  '2026-09-25T18:18': { kind: 'approval', label: 'Approves a docent model bake-off; picks the MIT licence' },
};

export interface SegmentDef {
  id: string;
  label: string;
  /** A few words, for tight spaces (the share card). */
  short: string;
  what: string;
  /**
   * The subject (prefix) of the commit that closes the stretch; null = the snapshot. A subject, not a SHA: SHAs
   * change when history is rewritten (it was, before publication), subjects don't.
   */
  endsAt: string | null;
}

/** The stretches of the build, in order. Night 1 is the original overnight claim, kept exactly as first measured. */
export const SEGMENTS: SegmentDef[] = [
  {
    id: 'night-1',
    label: 'Night 1',
    short: 'research to a playable, hardened game',
    what: 'From an empty project folder to the commit that planned wave 5: research, plans, contracts, waves 0–4 and a playable, hardened game.',
    endsAt: 'Schema 0.3.0 (portals, local capture, docent types); phase plans 13-16; wave 5',
  },
  {
    id: 'day-2',
    label: 'Day 2',
    short: 'wave 5 and launch prep',
    what: 'Wave 5 (link portals, the extension, the AI docent, this build story) and launch prep (Cloudflare deploys and previews, legal drafts, the pre-publication scrub, the licence).',
    endsAt: null,
  },
];

export const TIME_ZONE = 'America/Los_Angeles';

/** Paths whose birth time marks work done before the first commit (relative to the owner's checkout). */
export const PRE_GIT_FILES = [
  '.',
  'RESEARCH.md',
  'research/world-wide-maze.md',
  'research/recreation-plan.md',
  'research/recovery-evidence.json',
  'plans',
];

export const UNKNOWNS = [
  'How long the original 2013 team worked on World Wide Maze, and how many people it involved: never published.',
  'How much time the owner spent reading, reviewing or thinking between messages: not recorded anywhere.',
  'Research the owner did before this session, if any: not recorded.',
  'Build-log windows are the agents’ own approximate notes; the agent spans here come from their transcripts.',
];
