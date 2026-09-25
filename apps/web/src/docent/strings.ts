/**
 * Docent panel strings, English first and Japanese second (the app's language rule, src/i18n). The showcase
 * pages don't mount the game's i18next instance, so the panel keeps its own small table, like the phone
 * controller does (src/controller/strings.ts).
 */
import type { Lang } from '../i18n/index.ts';

export interface DocentStrings {
  title: string;
  intro: string;
  howTitle: string;
  how: string[];
  suggestedLabel: string;
  /** `label` is shown; `ask` is sent. The corpus is English, so Japanese suggestions ask in English. */
  suggestions: { label: string; ask: string }[];
  label: string;
  placeholder: string;
  ask: string;
  stop: string;
  startOver: string;
  you: string;
  docent: string;
  thinking: string;
  sources: string;
  sourcesCount: (n: number) => string;
  sourceLabel: (n: number) => string;
  onGitHub: string;
  inRepo: string;
  dontKnowNote: string;
  stopped: string;
  retry: string;
  networkError: string;
  answerReady: (n: number) => string;
  counter: (n: number, max: number) => string;
  seeAlso: string;
  historyPage: string;
  logPage: string;
}

/** The Phase 15 brief's suggested questions. */
export const EN_SUGGESTIONS = [
  'Who made the original?',
  'How did the 2013 maze builder work?',
  'What did AI do in this rebuild?',
  'What’s reconstructed vs evidenced?',
];

export const DOCENT_STRINGS: Record<Lang, DocentStrings> = {
  en: {
    title: 'Ask the docent',
    intro:
      'Questions about the 2013 original, or about how this rebuild was made. The docent answers only from this project’s research notes and build logs, numbers every source it uses, and says so when the sources don’t cover something.',
    howTitle: 'How it answers',
    how: [
      'Your question is matched against the research and the build record.',
      'An AI model writes a short answer from the passages found, and must cite them.',
      'Answers without a citation are not shown.',
    ],
    suggestedLabel: 'Try one of these',
    suggestions: EN_SUGGESTIONS.map((q) => ({ label: q, ask: q })),
    label: 'Your question',
    placeholder: 'Ask about World Wide Maze…',
    ask: 'Ask',
    stop: 'Stop',
    startOver: 'Start over',
    you: 'You asked',
    docent: 'Docent',
    thinking: 'Looking through the sources…',
    sources: 'Sources',
    sourcesCount: (n) => (n === 1 ? '1 source' : `${n} sources`),
    sourceLabel: (n) => `Source ${n}`,
    onGitHub: 'on GitHub',
    inRepo: 'in this project’s repository',
    dontKnowNote:
      'The docent won’t guess beyond its sources. Try rephrasing, or browse the history and the build record.',
    stopped: 'Stopped.',
    retry: 'Try again',
    networkError: 'The docent couldn’t be reached. Check your connection and try again.',
    answerReady: (n) =>
      n ? `Answer ready, with ${n === 1 ? 'one source' : `${n} sources`}.` : 'Answer ready.',
    counter: (n, max) => `${n} / ${max}`,
    seeAlso: 'Meanwhile:',
    historyPage: 'the history',
    logPage: 'the build record',
  },
  ja: {
    title: 'ドーセントに質問する',
    intro:
      '2013年のオリジナルについて、またはこの再現版の作り方について質問できます。ドーセントはこのプロジェクトの調査メモとビルドログだけを根拠に答え、使った資料に番号を付け、資料にないことは「資料には記載がありません」と答えます。',
    howTitle: '答え方',
    how: [
      '質問を調査資料とビルド記録から検索します。',
      'AIモデルが見つかった箇所だけを使って短く答え、必ず出典を示します。',
      '出典のない回答は表示しません。',
    ],
    suggestedLabel: '質問の例',
    suggestions: [
      'オリジナルを作ったのは誰？',
      '2013年の迷路ビルダーはどう動いていた？',
      'この再現でAIは何をした？',
      '「再構成」と「証拠あり」の違いは？',
    ].map((label, i) => ({ label, ask: `${EN_SUGGESTIONS[i]} (日本語で答えてください)` })),
    label: '質問',
    placeholder: 'World Wide Maze について質問…',
    ask: '質問する',
    stop: '止める',
    startOver: '最初から',
    you: 'あなたの質問',
    docent: 'ドーセント',
    thinking: '資料を調べています…',
    sources: '出典',
    sourcesCount: (n) => `出典 ${n} 件`,
    sourceLabel: (n) => `出典 ${n}`,
    onGitHub: '（GitHub）',
    inRepo: '（リポジトリ内）',
    dontKnowNote:
      'ドーセントは資料にないことを推測しません。言い換えるか、歴史のページやビルド記録をご覧ください。',
    stopped: '停止しました。',
    retry: 'もう一度',
    networkError: 'ドーセントに接続できませんでした。接続を確認して、もう一度お試しください。',
    answerReady: (n) => (n ? `回答が届きました。出典 ${n} 件。` : '回答が届きました。'),
    counter: (n, max) => `${n} / ${max}`,
    seeAlso: 'こちらもどうぞ：',
    historyPage: '歴史',
    logPage: 'ビルド記録',
  },
};
