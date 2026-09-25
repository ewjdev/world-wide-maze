/**
 * Phase 13 UI strings (link portals, web journeys), en + ja, all N. Registered into the app's i18next instance
 * at runtime (`addResourceBundle`), so the phase's strings live with its UI; key parity is tested.
 * Button glyphs (__ENTER__, __JUMP__ …) are rendered as key caps by `<Glyphs>`.
 */
import type { i18n } from 'i18next';
import { useTranslation } from 'react-i18next';

export const journeyEn = {
  prompt: {
    title: 'Travel to {{label}}?',
    carry: 'Your {{score}} points and {{balls}} spare balls come with you.',
    carryNone: 'Your score and spare balls come with you.',
    forfeit: 'This stage ends here: no time bonus.',
    travel: 'Travel',
    stay: 'Stay here',
    keysPc: '__ENTER__ travel · __ESC__ stay',
    keysPhone: '__JUMP__ travel · __MENU__ stay',
    offlineTitle: 'Needs the online service',
    offlineBody:
      'This link leads to {{host}}. Building a new maze from it needs the capture service, which can’t be reached right now.',
    keepPlaying: 'Keep playing',
    keysOffline: '__ESC__ or __MENU__ to keep playing',
  },
  travel: {
    rolling: 'Rolling to {{host}}',
    building: 'Rolling to {{host}}',
    body: 'Following the link. The next site is being captured and turned into its own maze.',
  },
  trail: {
    label: 'Your web journey',
    more: '+{{count}} earlier',
    here: 'You are here',
    via: {
      portal: 'through a link',
      select: 'from site select',
    },
  },
  share: {
    heading: 'Your web journey',
    summary_one: '{{count}} site, one run',
    summary_other: '{{count}} sites, one run',
    link: 'Share my web journey',
    copied: 'Link copied',
    text: 'I rolled a marble across {{count}} websites in World Wide Maze: {{trail}}',
    cardAlt: 'Link preview: this web journey as a chain of island mazes', // Phase 18
  },
  page: {
    title: 'A web journey',
    titleBy: '{{name}}’s web journey',
    lede: 'Every stop is a website turned into a 3D maze. Each one was reached by rolling a marble into a link on the page before.',
    points: '{{score}} points',
    sites_one: '{{count}} site',
    sites_other: '{{count}} sites',
    start: 'Start where it started',
    play: 'Play World Wide Maze',
    playStop: 'Play this stop',
    noRef: 'Built live from the link',
    invalid: 'This journey link is broken or incomplete.',
    about: 'About the 2013 original',
  },
};

export const journeyJa: typeof journeyEn = {
  prompt: {
    title: '{{label}} へ移動しますか？',
    carry: 'スコア {{score}} 点と残りボール {{balls}} 個を持っていけます。',
    carryNone: 'スコアと残りボールを持っていけます。',
    forfeit: 'このステージはここで終了します（タイムボーナスなし）。',
    travel: '移動する',
    stay: 'ここに残る',
    keysPc: '__ENTER__ 移動 · __ESC__ 残る',
    keysPhone: '__JUMP__ 移動 · __MENU__ 残る',
    offlineTitle: 'オンラインサービスが必要です',
    offlineBody:
      'このリンクの行き先は {{host}} です。迷路を作るにはキャプチャサービスが必要ですが、現在接続できません。',
    keepPlaying: 'プレイを続ける',
    keysOffline: '__ESC__ か __MENU__ でプレイを続ける',
  },
  travel: {
    rolling: '{{host}} へ転がっていきます',
    building: '{{host}} へ転がっていきます',
    body: 'リンクをたどっています。次のサイトをキャプチャして、新しい迷路にしています。',
  },
  trail: {
    label: 'あなたのウェブの旅',
    more: 'ほか {{count}} サイト',
    here: '現在地',
    via: {
      portal: 'リンクから',
      select: 'サイト選択から',
    },
  },
  share: {
    heading: 'あなたのウェブの旅',
    summary_one: '{{count}} サイト、ひとつのラン',
    summary_other: '{{count}} サイト、ひとつのラン',
    link: 'ウェブの旅をシェア',
    copied: 'リンクをコピーしました',
    text: 'World Wide Maze でボールを転がして {{count}} つのサイトを旅しました：{{trail}}',
    cardAlt: 'リンクのプレビュー：この旅を島の迷路のつながりで表したカード',
  },
  page: {
    title: 'ウェブの旅',
    titleBy: '{{name}} のウェブの旅',
    lede: 'どの立ち寄り先も、3D 迷路になったウェブサイトです。前のページのリンクにボールを転がして、次のサイトへたどり着きました。',
    points: '{{score}} 点',
    sites_one: '{{count}} サイト',
    sites_other: '{{count}} サイト',
    start: '最初のサイトから始める',
    play: 'World Wide Maze をプレイ',
    playStop: 'このサイトをプレイ',
    noRef: 'リンクからその場で作成',
    invalid: 'この旅のリンクは壊れているか、不完全です。',
    about: '2013 年のオリジナルについて',
  },
};

const registered = new WeakSet<i18n>();

/** Adds the `journey.*` strings to an i18next instance (once). */
export function registerJourneyStrings(inst: i18n): void {
  if (registered.has(inst)) return;
  registered.add(inst);
  inst.addResourceBundle('en', 'translation', { journey: journeyEn }, true, false);
  inst.addResourceBundle('ja', 'translation', { journey: journeyJa }, true, false);
}

/** `t` for the Phase 13 strings (registers them on first use). */
export function useJourneyT() {
  const r = useTranslation();
  registerJourneyStrings(r.i18n);
  return r;
}
