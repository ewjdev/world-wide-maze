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
  Leaderboard,
  type LeaderboardProps,
  useLeaderboard,
} from './Leaderboard.tsx';
export { NameEntry, type NameEntryProps } from './NameEntry.tsx';
export { ChallengeBanner, ShareButton, type ShareButtonProps } from './ShareButton.tsx';
export { type Challenge, readChallenge, type ShareOutcome, shareLink, shareText, shareUrl } from './share.ts';
