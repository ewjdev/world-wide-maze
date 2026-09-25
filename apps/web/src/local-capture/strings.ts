/**
 * Phase 14 strings for `/play/local` and `/mazify`, English first and Japanese second. They stay in this
 * folder (like the controller's table) so the parallel Wave 5 phases don't collide in `src/i18n`. The keys
 * can move there unchanged. All new (N): 2013 had no local capture.
 */
import { detectLang, type Lang } from '../i18n/index.ts';

const en = {
  // receiver
  waitingTitle: 'Waiting for your page',
  waitingBody: 'Keep this tab open. The page you captured is on its way from your browser.',
  waitingSlow: 'Nothing has arrived yet.',
  waitingHelp:
    'Open a page and click “Maze this page” in the World Wide Maze extension, or use the bookmarklet. This tab only accepts a capture from the tab that opened it.',
  getTools: 'Get the extension or bookmarklet',
  backToGame: 'Back to the game',
  checking: 'Reading your capture…',
  rejectedTitle: 'That capture couldn’t be used',
  rejectedBody: 'Try capturing the page again. If it keeps failing, the page may be too large or unusual.',
  tryAnother: 'Choose a saved site instead',
  chipLocal: 'Local capture',
  chipSketch: 'Sketch mode',
  privateNote: 'Built in your browser. Nothing has been uploaded.',
  sketchNote: 'Bookmarklet capture: boxes and text only, no screenshot.',
  share: 'Share',
  shareHint: 'Uploads this capture to make a link anyone can play.',
  sharing: 'Uploading…',
  shared: 'Shared. Anyone with this link can play it.',
  copy: 'Copy link',
  copied: 'Copied',
  open: 'Open',
  shareFailed: 'Sharing didn’t work',
  shareRateLimited: 'Too many new mazes right now. Try again later. Your maze still plays here.',
  shareForbidden: 'This site has opted out of World Wide Maze, so it can’t be shared.',
  shareGeneric: 'The server couldn’t build a shareable maze from this capture.',
  retry: 'Try again',
  // install page
  mazifyTitle: 'Maze the page you’re on',
  mazifyLead:
    'Turn any page you can see into a maze, including pages behind a login. The capture and the maze are made in your browser. Nothing is uploaded unless you press Share.',
  extTitle: 'Browser extension',
  extTag: 'Best',
  extBody:
    'One click captures the whole page as you see it, screenshot included. Chrome, Edge and other Chromium browsers.',
  extSteps: [
    'Download the extension folder, or build it with pnpm --filter @wwm/extension build.',
    'Open chrome://extensions and switch on Developer mode.',
    'Click “Load unpacked” and pick the folder.',
    'Pin World Wide Maze and click it on any page.',
  ],
  extNote:
    'It asks for the active tab only when you click it, and can talk to this game’s address and nothing else.',
  bmTitle: 'Bookmarklet',
  bmTag: 'Sketch mode',
  bmBody:
    'Works in any browser, no install. It reads the page’s boxes and text but can’t take a screenshot, so the maze is drawn as a sketch.',
  bmDrag: 'Maze this page',
  bmHowTo: 'Drag this button to your bookmarks bar. Then click it on any page.',
  bmClicked: 'Drag it to the bookmarks bar instead of clicking it here.',
  bmPopups: 'The bookmarklet opens the game in a new tab, so allow pop-ups if your browser asks.',
  privacyTitle: 'What happens to the page',
  privacy: [
    'The extension or bookmarklet reads the page in your browser and hands it to this game tab.',
    'The maze is built on your computer. The page never goes to our server.',
    'Share uploads that one capture to make a link. Shared mazes are unlisted.',
  ],
  mazifyBack: 'Back to the game',
};

type Strings = typeof en;

const ja: Strings = {
  waitingTitle: 'ページを受け取っています',
  waitingBody: 'このタブは開いたままにしてください。キャプチャしたページをブラウザから受け取っています。',
  waitingSlow: 'まだ何も届いていません。',
  waitingHelp:
    'ページを開いて、World Wide Maze 拡張機能の「このページを迷路に」をクリックするか、ブックマークレットを使ってください。このタブは、開いたタブからのキャプチャだけを受け付けます。',
  getTools: '拡張機能とブックマークレット',
  backToGame: 'ゲームに戻る',
  checking: 'キャプチャを確認しています…',
  rejectedTitle: 'このキャプチャは使えませんでした',
  rejectedBody:
    'もう一度キャプチャしてください。何度も失敗する場合は、ページが大きすぎるか特殊な構成かもしれません。',
  tryAnother: '保存済みのサイトを選ぶ',
  chipLocal: 'ローカルキャプチャ',
  chipSketch: 'スケッチモード',
  privateNote: 'ブラウザの中で作りました。何もアップロードしていません。',
  sketchNote: 'ブックマークレットのキャプチャ：スクリーンショットなし、箱とテキストだけ。',
  share: '共有',
  shareHint: 'このキャプチャをアップロードして、誰でも遊べるリンクを作ります。',
  sharing: 'アップロード中…',
  shared: '共有しました。このリンクを知っている人は誰でも遊べます。',
  copy: 'リンクをコピー',
  copied: 'コピーしました',
  open: '開く',
  shareFailed: '共有できませんでした',
  shareRateLimited: '新しい迷路が混み合っています。あとでもう一度お試しください。この迷路はここで遊べます。',
  shareForbidden: 'このサイトは World Wide Maze の対象外なので、共有できません。',
  shareGeneric: 'このキャプチャからは共有用の迷路を作れませんでした。',
  retry: 'もう一度',
  mazifyTitle: 'いま見ているページを迷路に',
  mazifyLead:
    'ログインが必要なページも含めて、見えているページをそのまま迷路にできます。キャプチャも迷路づくりもブラウザの中で行います。「共有」を押さない限り、何もアップロードされません。',
  extTitle: 'ブラウザ拡張機能',
  extTag: 'おすすめ',
  extBody:
    'ワンクリックで、見えているとおりのページ全体をスクリーンショットごとキャプチャします。Chrome、Edge などの Chromium 系ブラウザ用。',
  extSteps: [
    '拡張機能のフォルダをダウンロードするか、pnpm --filter @wwm/extension build でビルドします。',
    'chrome://extensions を開き、デベロッパーモードをオンにします。',
    '「パッケージ化されていない拡張機能を読み込む」でフォルダを選びます。',
    'World Wide Maze を固定して、好きなページでクリックします。',
  ],
  extNote: 'クリックしたときだけ表示中のタブにアクセスし、このゲームのアドレス以外とは通信しません。',
  bmTitle: 'ブックマークレット',
  bmTag: 'スケッチモード',
  bmBody:
    'どのブラウザでも、インストールなしで使えます。ページの箱とテキストは読めますが、スクリーンショットは撮れないので、迷路はスケッチとして描かれます。',
  bmDrag: 'このページを迷路に',
  bmHowTo: 'このボタンをブックマークバーにドラッグして、好きなページでクリックしてください。',
  bmClicked: 'ここではクリックせず、ブックマークバーにドラッグしてください。',
  bmPopups: 'ゲームは新しいタブで開きます。ポップアップの許可を求められたら許可してください。',
  privacyTitle: 'ページの扱い',
  privacy: [
    '拡張機能やブックマークレットがブラウザの中でページを読み取り、このゲームのタブに渡します。',
    '迷路はあなたのコンピューターの中で作られます。ページがサーバーに送られることはありません。',
    '「共有」を押すと、そのキャプチャだけをアップロードしてリンクを作ります。共有した迷路は一覧に載りません。',
  ],
  mazifyBack: 'ゲームに戻る',
};

export type LocalStrings = Strings;

export function localStrings(lang: Lang = detectLang()): LocalStrings {
  return lang === 'ja' ? ja : en;
}

export const LOCAL_STRINGS = { en, ja } as const;
