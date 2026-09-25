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
  'Phase 13 link portals': { phase: '13', title: 'Link portals', wave: 5, kind: 'phase' },
  'Phase 14 extension and bookmarklet': { phase: '14', title: 'Extension', wave: 5, kind: 'phase' },
  'Phase 15 AI docent': { phase: '15', title: 'AI docent', wave: 5, kind: 'phase' },
  'Phase 16 build story': { phase: '16', title: 'Build story', wave: 5, kind: 'phase' },
};

export const WAVES: Record<number, string> = {
  0: 'Wave 0 · reference and foundation',
  1: 'Wave 1 · components',
  2: 'Wave 2 · integration and solver',
  3: 'Wave 3 · showcase and fixes',
  4: 'Wave 4 · launch hardening',
  5: 'Wave 5 · next-level tribute',
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
};

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
