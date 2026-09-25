/**
 * Ranking module (Phase 10): the leaderboard client and UI pieces Phase 08's Result and Ranking screens mount.
 *
 *   const client = createRankingClient();                 // or createMemoryRankingClient() in tests
 *   <NameEntry score={total} onSubmit={(name) => client.submitRun({name, totalScore, stages})} onSkip={…} />
 *   const board = useLeaderboard(client, {kind: 'run'});  // E: the global board of session totals
 *   <Leaderboard title="Ranking" state={board} you={name} />
 *   <ShareButton stageId={id} title={stage.source.title} score={score} name={name} />
 *   const c = readChallenge(location.search); c && <ChallengeBanner challenge={c} />
 *   const track = await recordGhostTrack(stage, ghost.inputs); const g = createGhostBall(engine, track);
 *   // every frame: g.update(secondsSinceStart)
 */
export {
  createMemoryRankingClient,
  createRankingClient,
  type GhostRun,
  type HttpRankingOptions,
  isValidName,
  NAME_MAX,
  NAME_PATTERN,
  normalizeName,
  type RankingClient,
  type RunSubmission,
  type StageSubmission,
  type SubmitError,
  type SubmitResult,
  type VersionedReplay,
} from './client.ts';
export {
  createGhostBall,
  type GhostBall,
  type GhostStyle,
  type GhostTrack,
  recordGhostTrack,
  sampleTrack,
} from './ghost.ts';
export {
  type BoardRef,
  type BoardState,
  formatTime,
  LEADERBOARD_LABELS,
  Leaderboard,
  type LeaderboardLabels,
  type LeaderboardProps,
  useLeaderboard,
} from './Leaderboard.tsx';
export { NAME_ENTRY_LABELS, NameEntry, type NameEntryLabels, type NameEntryProps } from './NameEntry.tsx';
export {
  CHALLENGE_LABELS,
  ChallengeBanner,
  type ChallengeLabels,
  SHARE_LABELS,
  ShareButton,
  type ShareButtonProps,
  type ShareLabels,
} from './ShareButton.tsx';
export { type Challenge, readChallenge, type ShareOutcome, shareLink, shareText, shareUrl } from './share.ts';
