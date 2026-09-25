/** Popup strings, English first and Japanese second (same rule as the game: browser language). All N. */
const en = {
  brand: 'World Wide Maze',
  action: 'Maze this page',
  steps: {
    prepare: 'Getting the page ready',
    extract: 'Reading its boxes and text',
    frames: 'Photographing it',
    encode: 'Packing the picture',
    opening: 'Opening the game',
    handing: 'Handing it over',
  },
  frameOf: (k: number, n: number) => `${k} of ${n}`,
  done: 'In the game tab now.',
  private: 'Built in your browser. Nothing is uploaded unless you press Share in the game.',
  restrictedTitle: 'This page can’t be captured',
  restricted:
    'Browsers keep their own pages and extension stores off limits. Open any website and click again.',
  errorTitle: 'That didn’t work',
  retry: 'Try again',
  settings: 'Game address',
  settingsHint: 'Where the game runs. The extension talks to this address and nothing else.',
  save: 'Save',
  saved: 'Saved',
  badOrigin: 'Use an https:// address (http:// only for localhost).',
  denied: 'Not saved: the browser didn’t allow access to that address.',
  errors: {
    restricted: 'Browsers don’t let extensions capture this page.',
    empty: 'The page is empty or too small to make a maze.',
    script: 'This page can’t be read by extensions.',
    screenshot: 'The screenshot failed. Keep this tab in front while it captures.',
    'too-large': 'The page is too large to capture.',
    invalid: 'The capture didn’t pass the checks.',
    permission: 'The extension isn’t allowed to reach the game address.',
    open: 'Couldn’t open the game.',
    handoff: 'The game tab didn’t accept the page.',
    busy: 'A capture is already running.',
  } as Record<string, string>,
};

type Strings = typeof en;

const ja: Strings = {
  brand: 'World Wide Maze',
  action: 'このページを迷路に',
  steps: {
    prepare: 'ページを準備しています',
    extract: '箱とテキストを読み取っています',
    frames: '撮影しています',
    encode: '画像をまとめています',
    opening: 'ゲームを開いています',
    handing: 'ページを渡しています',
  },
  frameOf: (k, n) => `${k} / ${n}`,
  done: 'ゲームのタブに移りました。',
  private: 'ブラウザの中で作ります。ゲームで「共有」を押さない限り、何もアップロードしません。',
  restrictedTitle: 'このページはキャプチャできません',
  restricted:
    'ブラウザ自身のページや拡張機能ストアは対象外です。ほかのウェブサイトを開いて、もう一度クリックしてください。',
  errorTitle: 'うまくいきませんでした',
  retry: 'もう一度',
  settings: 'ゲームのアドレス',
  settingsHint: 'ゲームが動いている場所です。拡張機能はこのアドレスとだけ通信します。',
  save: '保存',
  saved: '保存しました',
  badOrigin: 'https:// のアドレスを入力してください（http:// は localhost のみ）。',
  denied: '保存できませんでした。ブラウザがそのアドレスへのアクセスを許可しませんでした。',
  errors: {
    restricted: 'このページは拡張機能からキャプチャできません。',
    empty: 'ページが空か小さすぎて、迷路を作れません。',
    script: 'このページは拡張機能から読み取れません。',
    screenshot: 'スクリーンショットに失敗しました。キャプチャ中はこのタブを前面にしておいてください。',
    'too-large': 'ページが大きすぎてキャプチャできません。',
    invalid: 'キャプチャがチェックを通りませんでした。',
    permission: 'ゲームのアドレスへのアクセスが許可されていません。',
    open: 'ゲームを開けませんでした。',
    handoff: 'ゲームのタブがページを受け取りませんでした。',
    busy: 'すでにキャプチャ中です。',
  },
};

export function popupStrings(lang = typeof navigator === 'undefined' ? 'en' : navigator.language): Strings {
  return lang.toLowerCase().startsWith('ja') ? ja : en;
}
export const POPUP_STRINGS = { en, ja };
