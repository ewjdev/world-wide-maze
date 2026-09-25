/** 日本語 UI strings. E = the 2013 translation-ja.json string (quoted or adapted), N = new. */
import type { Resources } from './en.ts';

export const ja: Resources = {
  app: {
    name: 'World Wide Maze',
    tribute:
      'Google Japan と PARTY による 2013 年の Chrome Experiment へのトリビュートです。Google とは関係ありません。',
  },
  common: {
    back: '戻る',
    skip: 'スキップ',
    next: '次へ',
    yes: 'はい',
    no: 'いいえ',
    ok: 'OK',
    close: '閉じる',
    retry: 'もう一度',
    settings: '設定',
    soundOn: 'サウンド オン',
    soundOff: 'サウンド オフ',
    language: '言語',
    keyboard: 'キーボード',
    phone: 'スマートフォン',
    stars: '難易度 5 段階中 {{count}}',
  },
  title: {
    caption: 'お好きなサイトを立体迷路に！ PC とスマホで遊ぶ、ボール転がしゲーム。', // E
    start: 'スタート',
    about: 'オリジナルについて',
  },
  howto: {
    heading: '遊び方',
    step1: 'スマートフォンと PC を接続。', // E (adapted)
    step2: '立体迷路にして遊びたいサイトを選択。', // E
    step3: '選択したサイトが立体迷路に変形。', // E
    step4: 'スマートフォンでボールを操作して、ゴールを目指そう。', // E
    go: 'はじめる',
  },
  connect: {
    title: 'World Wide Maze に接続', // E
    code: 'コード',
    scan: 'QR コードをスマートフォンで読み込んでください。', // E
    orOpen: 'またはスマートフォンでこのリンクを開いてください',
    copy: 'リンクをコピー',
    copied: 'コピーしました',
    devicelock: '※スマートフォンの画面回転をロックすると、より快適に遊べます。', // E
    playPc: 'スマートフォンをお持ちでない場合は、このまま PC のみで遊ぶ', // E
    waiting: 'スマートフォンを待っています…',
    connected: '接続しました！', // E (short)
    creating: 'ルームを準備中…',
    offline: 'いまは接続サービスに届きません。キーボードで遊ぶことはできます。',
  },
  calibrate: {
    title: '画面左下のドットが重なるようにスマートフォンを傾けてください。', // E
    hint: 'スマートフォンを手前に傾けて持ち、静止してください。',
    timeout: '操作が難しい場合はキーボードの矢印キーとスペースキーでもプレイできます。', // E
    useKeyboard: 'キーボードで遊ぶ',
    seconds: '{{count}} 秒',
  },
  select: {
    title: '立体迷路にして遊びたいサイトを選ぼう', // E (adapted)
    placeholder: 'URL を貼り付けてください',
    build: '変形する',
    tip: '※ 立体迷路にできないサイトも存在します。', // E
    practice: '初めての方におすすめ', // E
    practiceTitle: '4 つの島とスロープとエレベーター',
    popular: 'よく遊ばれているサイト', // E
    saved: '保存済みのサイト（オフラインで遊べます）',
    stages_one: '{{count}} ステージ',
    stages_other: '{{count}} ステージ',
    invalidUrl: 'URL の形式ではないようです。wikipedia.org のように入力してください。',
  },
  building: {
    title: '立体迷路に変形中', // E
    body: 'ボールを操作して、ゴールを目指しましょう。ゴールしたタイムと、集めたアイテムの数に応じてポイントをゲットできます。', // E
    step: {
      queued: 'ブラウザを待っています',
      capturing: 'ページを訪問中',
      extracting: 'レイアウトを読み取り中',
      building: '島を持ち上げています',
      validating: 'ルートを確認中',
      storing: '迷路を保存中',
      texture: 'ページを島に印刷中',
      world: '世界を組み立て中',
    },
    cancel: 'キャンセル',
  },
  error: {
    title: '立体迷路にできないサイトも存在します。', // E
    CAPTURE_BLOCKED: 'このサイトには入れませんでした。自動アクセスを拒否している可能性があります。',
    CAPTURE_TIMEOUT: 'サイトの読み込みに時間がかかりすぎました。',
    URL_FORBIDDEN:
      'このアドレスにはアクセスできません。公開されている http / https のページを指定してください。',
    BUILD_FAILED: 'このページを島に変形できませんでした。',
    UNPLAYABLE: 'ゴールできない迷路になってしまいました。',
    RATE_LIMITED: 'しばらく作成できません。時間をおいて試すか、保存済みのサイトで遊んでください。',
    NETWORK: '迷路サービスに接続できません。保存済みのサイトはオフラインでも遊べます。',
    NOT_FOUND: 'このステージは存在しないか、期限切れです。',
    alternatives: 'こちらで遊んでみませんか',
    another: '別のアドレスを試す',
    toTitle: 'タイトルへ',
  },
  intro: { skip: 'いずれかのキーでスキップ' },
  hud: {
    time: 'TIME',
    score: 'SCORE',
    life: 'LIFE',
    menu: 'MENU',
    large: '大きいアイテム',
    tooTilted: '傾けすぎ！', // E
    rtt: '{{ms}} ms',
    phoneLink: 'スマートフォンとの通信遅延',
  },
  tutorial: {
    mobile: {
      step2: 'これが基本ポジションになります。', // E
      step3: '__POWER__ ボタンを押しながらスマートフォンを傾けてボールを操作してみましょう。', // E
      step4: '__JUMP__ を押してジャンプしてみましょう。', // E
      step5: 'スマートフォン画面上部の __MENU__ を押すと、全体マップを見る事ができます。', // E
      step6: 'さぁ、ゴールを目指して、立体迷路を駆け抜けよう！', // E
    },
    pc: {
      step2: 'これが基本ポジションになります。', // E
      step3: '矢印キー __ARROW_KEY__ でボールを操作してみましょう。', // E
      step4: 'スペースキー __SPACE_KEY__ でジャンプしてみましょう。', // E
      step5: '__M_KEY__ キーで全体マップを見る事ができます。', // E (adapted)
      step6: 'さぁ、ゴールを目指して、立体迷路を駆け抜けよう！', // E
    },
  },
  map: {
    title: 'マップ',
    back: 'ゲームに戻る',
    retry: 'このステージをやり直す',
    search: '別のサイトで遊ぶ',
    quit: 'タイトルに戻る',
    confirm: 'このステージを終了します。よろしいですか？', // E
    you: 'YOU',
  },
  result: {
    cleared: 'ステージクリア',
    stageOf: 'ステージ {{index}} / {{count}}',
    timeLeft: '残り時間',
    seconds: '{{count}} 秒',
    large: '大きいアイテム',
    small: '小さいアイテム',
    stageScore: 'ステージスコア',
    total: 'トータルスコア',
    oneUp: '1UP',
    next: '次のステージへ',
    another: '別のサイトで遊ぶ',
    finish: '終了する',
    share: 'シェア',
    shared: 'リンクをコピーしました',
    shareText: 'World Wide Maze で “{{title}}” の立体迷路をクリア！', // E
  },
  ranking: {
    title: 'ランキング',
    yourRank: 'あなたの順位',
    pending: '??',
    points: 'トータルポイント',
    placeholder: '名前を入力してランキングに登録しましょう', // E
    submit: '登録',
    skip: 'スキップ',
    submitted: 'ランキングに登録しました。',
    newGame: 'ニューゲーム',
    top: 'トップへ',
    share: 'シェア',
    shareText: 'World Wide Mazeで、ランキング {{rank}} 位に！好きなサイトを立体迷路にして遊ぼう！', // E (adapted)
    empty: 'まだスコアがありません。一番乗りしよう。',
    local: 'オンラインランキングが始まるまで、スコアはこの端末に保存されます。',
    rankCol: '順位',
    nameCol: '名前',
    scoreCol: 'ポイント',
  },
  disconnect: {
    title: 'スマートフォンを再接続してください',
    body: 'スマートフォンからの信号が途切れました。ロックを解除するかリンクを開き直すと、中断したところから再開します。',
    keyboard: 'キーボードで続ける',
    resumed: '再接続しました',
  },
  settings: {
    sensitivity: '傾きの感度',
    pixel: 'ピクセル表示',
    pixelHint: '2013 年版のような、くっきりとしたドット表示',
  },
  unsupported: {
    title: 'このブラウザでは迷路を動かせません。',
    body: 'World Wide Maze には 3D グラフィックス（WebGPU または WebGL 2）と Web Worker が必要です。最新の Chrome、Edge、Firefox、Safari をお試しください。',
  },
};
