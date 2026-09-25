/**
 * The shape of `content/build-story/timeline.json`. Every number in it is computed by `buildTimeline()` from one of
 * the sources below; nothing is typed in by hand. Labels (phase names, what an owner message was about) are
 * annotations and are marked as such.
 */

/** Where a value comes from. `ref` is a command, a file path or a commit, precise enough to re-check it. */
export interface SourceRef {
  kind: 'git' | 'build-log' | 'session' | 'file-birth' | 'vitest' | 'annotation';
  ref: string;
}

export interface Span {
  /** ISO 8601, UTC. */
  start: string;
  end: string;
  min: number;
}

export interface Commit {
  sha: string;
  parents: string[];
  /** ISO 8601 with the author's offset, as git prints it. */
  at: string;
  subject: string;
}

/** Content-free extract of the orchestrating Claude Code session (content/build-story/sources/session.json). */
export interface SessionExtract {
  sessionId: string;
  /** Messages the owner typed (not tool results, not agent notifications). Only time and word count are kept. */
  ownerMessages: { at: string; words: number }[];
  /** Orchestrator turns: from the moment a prompt or notification is dequeued to the end-of-turn hook. */
  turns: { start: string; end: string }[];
  /** Sub-agent runs, from their own transcripts (first to last event). */
  agents: {
    id: string;
    description: string;
    /** 1 = launched by the orchestrator, 2 = a helper launched by a phase agent. */
    depth: number;
    parentId: string | null;
    start: string;
    end: string;
    /** When the orchestrator was notified that the run finished (depth 1 only); null while running. */
    notifiedAt: string | null;
  }[];
  /** Background monitor events the orchestrator received (e.g. the iPhone relay during the device test). */
  monitorEvents: { at: string; summary: string }[];
}

/** File birth times for work that happened before the first commit (content/build-story/sources/files.json). */
export interface FileBirths {
  root: string;
  method: string;
  files: { path: string; born: string }[];
}

export interface TestCounts {
  commit: string;
  command: string;
  passed: number;
  skipped: number;
  failed: number;
  files: number;
  byProject: { project: string; passed: number; skipped: number }[];
}

export interface PackageLines {
  dir: string;
  files: number;
  sourceLines: number;
  testLines: number;
}

export type RunKind = 'phase' | 'follow-up' | 'helper';

export interface Run {
  /** Phase id as the plans name it ("03", "03b/05b", "12b"); helpers carry their parent's id. */
  phase: string;
  /** Annotation: a short human title. */
  title: string;
  wave: number;
  kind: RunKind;
  agentId: string;
  /** Exact, from the agent's own transcript. `running` if it hadn't finished at `asOf`. */
  span: Span;
  running: boolean;
  /** The window the agent wrote in its build log ("~08:05Z → ~08:45Z"), when it wrote one. */
  logWindow: (Span & { approx: boolean; text: string }) | null;
  log: string | null;
  failedAttempts: number | null;
  /** The merge of this run's branch into main, if there is one. */
  merge: { sha: string; at: string; subject: string } | null;
  /** Drawing hint: the first free lane when runs are packed by start time (so overlaps sit side by side). */
  lane: number;
}

export interface Timeline {
  schema: 1;
  /** The snapshot: everything is measured up to HEAD's commit time. */
  asOf: { sha: string; at: string; subject: string };
  timeZone: string;
  start: { at: string; what: string; source: SourceRef };
  wallClock: Span;
  /** Time with at least one agent or the orchestrator working (union of all intervals). */
  active: { min: number; spans: Span[]; source: SourceRef };
  /** Stretches of at least `idleThresholdMin` with nothing running. */
  idle: { min: number; thresholdMin: number; spans: Span[] };
  agents: {
    runs: number;
    phaseRuns: number;
    followUpRuns: number;
    helperRuns: number;
    /** Sum of every sub-agent run's duration (agent-hours, as minutes). */
    agentMin: number;
    orchestratorMin: number;
    maxConcurrent: number;
    maxConcurrentAt: string;
    /** Agent minutes ÷ wall-clock minutes while any agent ran. */
    meanConcurrency: number;
    model: string | null;
    source: SourceRef;
  };
  runs: Run[];
  orchestratorTurns: Span[];
  owner: {
    messages: number;
    words: number;
    /** Longest stretch between two owner messages (inside the snapshot). */
    longestAway: Span;
    /** Agent minutes that ran during that stretch. */
    agentMinWhileAway: number;
    touchpoints: { at: string; kind: string; label: string; words: number | null; source: SourceRef }[];
  };
  gates: { id: string; at: string; sha: string; subject: string }[];
  contractVersions: { version: string; at: string; sha: string }[];
  preGit: { path: string; born: string; source: SourceRef }[];
  git: {
    commits: number;
    merges: number;
    phaseMerges: number;
    firstCommit: { sha: string; at: string; subject: string };
    source: SourceRef;
  };
  tests: TestCounts & { source: SourceRef };
  lines: {
    total: { source: number; test: number; files: number };
    byPackage: PackageLines[];
    source: SourceRef;
  };
  buildLogs: { files: number; failedAttempts: number; humanInterventions: number; source: SourceRef };
  /** What this timeline can't tell you. Shown on the page as is. */
  unknowns: string[];
  /** Values that are labelled estimates rather than measurements. */
  estimates: { what: string; value: string; basis: string }[];
}
