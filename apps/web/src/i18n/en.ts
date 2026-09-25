/**
 * English UI strings. Comments: E = the 2013 localization string (docs/reference/ux-flow.md), quoted or
 * lightly adapted; N = new in the rebuild. Button glyphs (__POWER__ etc.) are rendered by the UI.
 */
export const en = {
  app: {
    name: 'World Wide Maze',
    tribute: 'A tribute to the 2013 Chrome Experiment by Google Japan and PARTY. Not affiliated with Google.', // N
  },
  common: {
    back: 'Back',
    skip: 'Skip',
    next: 'Next',
    yes: 'Yes',
    no: 'No',
    ok: 'OK',
    close: 'Close',
    retry: 'Try again',
    settings: 'Settings',
    soundOn: 'Sound on',
    soundOff: 'Sound off',
    language: 'Language',
    keyboard: 'Keyboard',
    phone: 'Phone',
    stars: '{{count}} of 5 stars difficulty',
  },
  title: {
    caption: 'Turn your favorite website into a 3D maze. Play with your PC and your phone.', // E: title.caption
    start: 'Start',
    about: 'About the original',
  },
  howto: {
    heading: 'How to play', // N
    step1: 'Connect your phone to your PC', // E: howto.step1 (adapted: any browser)
    step2: 'Choose a site to play', // E
    step3: 'The site transforms into a 3D maze', // E
    step4: 'Use your phone to control the ball and find the goal', // E
    go: 'Let’s go',
  },
  connect: {
    title: 'Connect to World Wide Maze', // E: connect.title
    code: 'Code',
    scan: 'Scan the QR code with your phone’s camera', // E: connect.readqr (adapted)
    orOpen: 'or open this link on your phone', // E: connect.access.pc (adapted)
    copy: 'Copy link',
    copied: 'Copied',
    devicelock: 'Lock your phone to portrait orientation', // E: connect.devicelock
    playPc: 'No smartphone? Play with PC only', // E: connect.play-pc
    waiting: 'Waiting for your phone…', // N
    connected: 'Connected!', // E: connected
    creating: 'Opening a room…', // N
    offline: 'The pairing service can’t be reached right now. You can still play with the keyboard.', // N
  },
  calibrate: {
    title: 'Tilting the phone, match the dots', // E: tutorial.mobile.step1 (adapted)
    hint: 'Hold the phone tilted toward you, the way you’d read it, and keep it still.', // N
    timeout:
      'If you have difficulties controlling with the phone, you can also play with the arrow keys and the space bar.', // E: tutorial.mobile.step7
    useKeyboard: 'Play with the keyboard',
    seconds: '{{count}} s',
  },
  select: {
    title: 'Choose a site to transform into a 3D maze.', // E: search.title (adapted: paste a URL)
    placeholder: 'Paste any web address', // N
    build: 'Transform',
    tip: 'Please note that some sites can’t be transformed.', // E: search.tip
    practice: 'Practice site', // E: search.tutorial
    practiceTitle: 'Four islands, a ramp and an elevator', // N
    popular: 'Popular sites', // E: search.recommended
    saved: 'Saved captures, playable offline', // N
    stages_one: '{{count}} stage',
    stages_other: '{{count}} stages',
    invalidUrl: 'That doesn’t look like a web address. Try something like wikipedia.org.', // N
  },
  building: {
    title: 'Transforming…', // E: building.pc
    body: 'Control the ball and head towards the goal to complete each stage. Gain points by collecting items along the way. Get to the goal with time to spare for bonus points.', // E: building.pc (adapted)
    step: {
      queued: 'Waiting for a browser',
      capturing: 'Visiting the page',
      extracting: 'Reading the layout',
      building: 'Raising islands',
      validating: 'Checking the route',
      storing: 'Saving the maze',
      texture: 'Printing the page onto the islands',
      world: 'Building the world',
    },
    cancel: 'Cancel',
  },
  error: {
    title: 'Some sites can’t be transformed.', // E: search.tip (adapted)
    CAPTURE_BLOCKED: 'That site didn’t let us in. It may block automated visitors.',
    CAPTURE_TIMEOUT: 'That site took too long to load.',
    URL_FORBIDDEN: 'That address can’t be visited. Use a public http or https page.',
    BUILD_FAILED: 'We couldn’t turn that page into islands.',
    UNPLAYABLE: 'That page became a maze nobody can finish.',
    RATE_LIMITED: 'Too many mazes built from here for now. Try again later, or play a saved one.',
    NETWORK: 'The maze service can’t be reached. Saved sites still work offline.',
    NOT_FOUND: 'That stage doesn’t exist, or it has expired.',
    alternatives: 'Play one of these instead',
    another: 'Try another address',
    toTitle: 'Back to title',
  },
  intro: {
    skip: 'Press any key to skip', // N
  },
  hud: {
    time: 'TIME',
    score: 'SCORE',
    life: 'LIFE',
    menu: 'MENU',
    large: 'Large items',
    tooTilted: 'Too tilted!', // E: game.tootilted
    rtt: '{{ms}} ms',
    phoneLink: 'Phone link latency',
  },
  tutorial: {
    mobile: {
      step2: 'This is your starting position.', // E
      step3: 'Press and hold __POWER__ and tilt your phone to control the ball', // E
      step4: 'Press __JUMP__ on your phone to jump', // E
      step5: 'Press __MENU__ at the top of your phone to view the map', // E
      step6: 'Now head for the goal!', // E
    },
    pc: {
      step2: 'This is your starting position.', // E (mobile step2, shared)
      step3: 'Control the ball with the arrow keys __ARROW_KEY__', // E
      step4: 'Hit the space bar __SPACE_KEY__ to jump', // E
      step5: 'Press __M_KEY__ to view the map', // E
      step6: 'Now head for the goal!', // E
    },
  },
  map: {
    title: 'Map',
    back: 'Back to the game',
    retry: 'Retry this stage', // N
    search: 'Play another site',
    quit: 'Quit to title',
    confirm: 'Do you really want to leave this stage?', // E: game.confirm
    you: 'YOU',
  },
  result: {
    cleared: 'Stage clear', // N
    stageOf: 'Stage {{index}} of {{count}}',
    timeLeft: 'Time left',
    seconds: '{{count}} s',
    large: 'Large items',
    small: 'Small items',
    stageScore: 'Stage score',
    total: 'Total score',
    oneUp: '1UP',
    next: 'Next stage',
    another: 'Play another site',
    finish: 'Finish',
    share: 'Share',
    shared: 'Link copied',
    shareText: 'I just conquered a 3D maze of “{{title}}” on World Wide Maze!', // E: tweet.stage
  },
  ranking: {
    title: 'Ranking',
    yourRank: 'Your rank',
    pending: '??', // E
    points: 'Total points',
    placeholder: 'Enter name here to join ranking', // E: ranking
    submit: 'Submit',
    skip: 'Skip',
    submitted: 'You’re on the board.',
    newGame: 'New game',
    top: 'Back to top',
    share: 'Share',
    shareText:
      'I just became {{rank}} place on World Wide Maze! Create a 3D maze of your favorite site and play!', // E: tweet.rank (adapted)
    empty: 'No scores yet. Be the first.',
    local: 'Scores are kept on this device until online rankings open.', // N (Phase 10)
    rankCol: 'Rank',
    nameCol: 'Name',
    scoreCol: 'Points',
  },
  disconnect: {
    title: 'Reconnect your phone', // N
    body: 'Your phone went quiet. Unlock it or reopen the link, and the game picks up exactly where you left off.', // N (E: `disconnected`, reworded: no reload)
    keyboard: 'Continue with the keyboard',
    resumed: 'Reconnected',
  },
  settings: {
    sensitivity: 'Tilt sensitivity',
    pixel: 'Pixel look',
    pixelHint: 'Crisp, blocky page texture, like 2013',
  },
  unsupported: {
    title: 'This browser can’t run the maze.',
    body: 'World Wide Maze needs 3D graphics (WebGPU or WebGL 2) and Web Workers. Try a current version of Chrome, Edge, Firefox or Safari.',
  },
};

export type Resources = typeof en;
