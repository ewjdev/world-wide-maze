/**
 * Controller and pairing strings, English first and Japanese second. They live here until Phase 08 lands
 * `apps/web/src/i18n`; the keys are shaped so they can move over unchanged.
 * E = the 2013 localization string (docs/reference/ux-flow.md), N = new in the rebuild.
 */
export type Lang = 'en' | 'ja';

const en = {
  title: 'World Wide Maze controller',
  connecting: 'Connecting…', // N
  reconnecting: 'Reconnecting…', // N
  roomCode: 'Code',
  notFound: 'That code isn’t active. Enter the six-digit code shown on your computer.', // E: connect.pcnumber (adapted)
  enterCode: 'Enter code',
  go: 'Connect',
  replaced: 'This controller was opened somewhere else. Close this tab, or tap to take control again.', // N
  takeOver: 'Use this phone',
  waitingHost: 'Waiting for your computer… Keep this page open.', // N
  hostLeft: 'PC and mobile phone disconnected. Waiting for the computer to reconnect…', // E: `disconnected` (adapted: no reload needed)
  lockPortrait: 'Lock smartphone to portrait orientation', // E: connect.devicelock
  enableTitle: 'Tilt your phone to roll the ball', // N
  enableTilt: 'Enable tilt', // N
  enableHint: 'Your phone will ask for motion access. Tap Allow.', // N
  denied:
    'Motion access was denied. To try again, close Safari completely, reopen this link and tap Allow. Or play with the keyboard on your computer.', // N
  noSensor: 'This device isn’t sending tilt data. Play with the keyboard on your computer instead.', // N
  keyboardFallback:
    'If you have difficulties controlling with the mobile phone, you can also play with the arrow keys and space bar on your computer.', // E: tutorial.mobile.step7 (adapted)
  retry: 'Try again',
  calibrateTitle: 'Tilting the phone, match the dots', // E: tutorial.mobile.step1 (adapted)
  calibrateHint: 'Hold your phone comfortably, tilted toward you, and keep it still.', // N
  useThisPosition: 'Use this position', // N
  calibrationFailed: 'Couldn’t read a steady position.', // N
  power: 'POWER',
  jump: 'JUMP',
  menu: 'MENU',
  powerHint: 'Press and hold POWER and tilt phone to control the ball', // E: tutorial.mobile.step3
  tooTilted: 'Too tilted!', // E: game.tootilted
  recalibrate: 'Recalibrate',
  score: 'SCORE',
  time: 'TIME',
  balls: 'BALLS',
  // Host pairing panel
  connectTitle: 'Connect to World Wide Maze', // E: connect.title
  scanQr: 'Scan the QR code with your phone’s camera', // E: connect.readqr (adapted)
  orOpen: 'or open this link on your phone', // E: connect.access.pc (adapted)
  copy: 'Copy link',
  copied: 'Copied',
  connected: 'Connected!', // E: connected
  waitingPhone: 'Waiting for your phone…', // N
  playKeyboard: 'No smartphone? Play with PC only', // E: connect.play-pc
  creatingRoom: 'Creating a room…', // N
  roomError: 'Couldn’t create a room. Check your connection and try again.', // N
};

type Strings = typeof en;

const ja: Strings = {
  title: 'World Wide Maze コントローラー',
  connecting: '接続中…',
  reconnecting: '再接続中…',
  roomCode: 'コード',
  notFound: 'このコードは使われていません。PCに表示されている6桁のコードを入力してください。',
  enterCode: 'コードを入力',
  go: '接続',
  replaced:
    'このコントローラーは別の場所で開かれました。このタブを閉じるか、タップして操作を戻してください。',
  takeOver: 'このスマホを使う',
  waitingHost: 'PCを待っています…このページを開いたままにしてください。',
  hostLeft: 'PCとスマートフォンの接続が切れました。PCの再接続を待っています…',
  lockPortrait: 'スマートフォンの画面を縦向きにロックしてください',
  enableTitle: 'スマホを傾けてボールを転がそう',
  enableTilt: '傾きを有効にする',
  enableHint: 'モーションへのアクセスを求められたら「許可」をタップしてください。',
  denied:
    'モーションへのアクセスが拒否されました。Safariを完全に終了してからこのリンクを開き直し、「許可」をタップしてください。PCのキーボードでも遊べます。',
  noSensor: 'この端末から傾きデータが届きません。PCのキーボードで遊んでください。',
  keyboardFallback: 'スマートフォンでの操作が難しい場合は、PCの矢印キーとスペースキーでも遊べます。',
  retry: 'もう一度',
  calibrateTitle: 'スマホを傾けて、ドットを合わせてください',
  calibrateHint: 'スマホを手前に傾けた楽な姿勢で持ち、静止してください。',
  useThisPosition: 'この姿勢にする',
  calibrationFailed: '安定した姿勢を読み取れませんでした。',
  power: 'POWER',
  jump: 'JUMP',
  menu: 'MENU',
  powerHint: 'POWERを押しながらスマホを傾けて、ボールを操作しよう',
  tooTilted: '傾けすぎ！',
  recalibrate: '再調整',
  score: 'SCORE',
  time: 'TIME',
  balls: 'BALLS',
  connectTitle: 'World Wide Maze に接続',
  scanQr: 'スマートフォンのカメラでQRコードを読み取ってください',
  orOpen: 'またはスマートフォンでこのリンクを開いてください',
  copy: 'リンクをコピー',
  copied: 'コピーしました',
  connected: '接続しました！',
  waitingPhone: 'スマートフォンを待っています…',
  playKeyboard: 'スマートフォンがない場合はPCだけで遊ぶ',
  creatingRoom: 'ルームを作成中…',
  roomError: 'ルームを作成できませんでした。接続を確認してもう一度お試しください。',
};

export const STRINGS: Record<Lang, Strings> = { en, ja };

export function pickLang(languages: readonly string[] | undefined): Lang {
  return languages?.[0]?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function strings(lang?: Lang): Strings {
  const l = lang ?? pickLang(typeof navigator === 'undefined' ? undefined : navigator.languages);
  return STRINGS[l];
}
