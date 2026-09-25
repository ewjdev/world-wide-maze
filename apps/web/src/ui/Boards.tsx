/**
 * Phase 10's ranking components in the game's language (08b): the i18n tables for their labels, a board bound to
 * a `BoardSource` (server or this device), and the rank format per language.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { BoardSource } from '../game/leaderboard.ts';
import { ordinal } from '../game/rules.ts';
import {
  type BoardRef,
  Leaderboard,
  type LeaderboardLabels,
  useLeaderboard,
} from '../ranking/Leaderboard.tsx';
import type { NameEntryLabels } from '../ranking/NameEntry.tsx';
import type { ChallengeLabels, ShareLabels } from '../ranking/ShareButton.tsx';
import { useGame } from './GameApp.tsx';

/** 1st / 2nd … in English, 1位 / 2位 … in Japanese. */
export function useRankFormat(): (n: number) => string {
  const { i18n } = useTranslation();
  return (n) => (i18n.language === 'ja' ? `${n}位` : ordinal(n));
}

export function useBoardLabels(): Partial<LeaderboardLabels> {
  const { t } = useTranslation();
  return {
    loading: t('boards.loading'),
    errorTitle: t('boards.errorTitle'),
    errorBody: t('boards.errorBody'),
    retry: t('common.retry'),
    rank: t('ranking.rankCol'),
    name: t('ranking.nameCol'),
    score: t('ranking.scoreCol'),
    time: t('boards.time'),
    you: t('boards.you'),
  };
}

export function useNameEntryLabels(): Partial<NameEntryLabels> {
  const { t } = useTranslation();
  return {
    lede: () => t('ranking.lede'),
    name: t('ranking.nameLabel'),
    placeholder: t('ranking.namePlaceholder'),
    hint: t('ranking.hint'),
    submit: t('ranking.submit'),
    sending: t('ranking.sending'),
    skip: t('ranking.skip'),
    errors: {
      name: t('ranking.errors.name'),
      profanity: t('ranking.errors.profanity'),
      implausible: t('ranking.errors.implausible'),
      'rate-limited': t('ranking.errors.rate-limited'),
      'not-found': t('ranking.errors.not-found'),
      network: t('ranking.errors.network'),
      server: t('ranking.errors.server'),
    },
  };
}

export function useShareLabels(): Partial<ShareLabels> {
  const { t } = useTranslation();
  return {
    challenge: t('result.challengeShare'),
    share: t('result.share'),
    feedback: {
      shared: t('result.shared'),
      copied: t('result.shared'),
      cancelled: '',
      failed: t('result.shareFailed'),
    },
  };
}

export function useChallengeLabels(): Partial<ChallengeLabels> {
  const { t } = useTranslation();
  return {
    challenged: () => {
      const [before = '', after = ''] = t('challenge.challenged', { name: '\u0000' }).split('\u0000');
      return { before, after };
    },
    aFriend: t('challenge.aFriend'),
    goal: t('challenge.goal'),
  };
}

export interface GameBoardProps {
  /** null while the game is still asking the server whether it has this stage. */
  source: BoardSource | null;
  board: BoardRef;
  title: string;
  subtitle?: string;
  you?: string | null;
  showTime?: boolean;
  limit?: number;
  emptyText: string;
  /** Changing it reloads the board (after a submission). */
  version?: number;
  id?: string;
}

/** A Phase 10 `<Leaderboard>` reading the server or the device board. */
export function GameBoard({ source, version = 0, ...p }: GameBoardProps) {
  const g = useGame();
  const labels = useBoardLabels();
  const fmt = useRankFormat();
  const state = useLeaderboard(g.boards.client(source ?? 'device'), p.board);
  const { reload } = state;
  useEffect(() => {
    if (version > 0) reload();
  }, [version, reload]);
  return (
    <Leaderboard
      {...p}
      tone="game"
      headingLevel={3}
      state={source === null ? { status: 'loading' } : state}
      onRetry={reload}
      labels={labels}
      formatRank={fmt}
    />
  );
}
