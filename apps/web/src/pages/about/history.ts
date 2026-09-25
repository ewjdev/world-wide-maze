/**
 * Facts shown on /about. EVERY claim here must be supported by research/world-wide-maze.md or docs/reference/*,
 * and carries its source links. The orchestrator cross-checks this file at gate G3; keep wording close to the
 * research and do not add claims without adding the evidence first.
 */

export interface Source {
  label: string;
  url: string;
}

export const SRC = {
  launch: {
    label: 'Google Japan launch announcement',
    url: 'https://blog.google/intl/ja-jp/products/android-chrome-play/2013_03_chrome-experimen/',
  },
  experiments: {
    label: 'Chrome Experiments entry',
    url: 'https://experiments.withgoogle.com/world-wide-maze',
  },
  engadget: {
    label: 'Engadget, March 21, 2013',
    url: 'https://www.engadget.com/2013-03-21-chrome-world-wide-maze-browser-game.html',
  },
  oneShowSilver: {
    label: 'The One Show: Cross-Channel entry',
    url: 'https://www.oneclub.org/awards/theoneshow/-award/21447/world-wide-maze/',
  },
  oneShowMerit: {
    label: 'The One Show: Branded Games entry',
    url: 'https://www.oneclub.org/awards/theoneshow/-award/21187/world-wide-maze/',
  },
  webbyNominee: {
    label: 'Webby Awards 2014 nominee',
    url: 'https://winners.webbyawards.com/2014/advertising-media-pr/individual/game-or-application/145045/google-chrome-world-wide-maze',
  },
  webbyHonoree: {
    label: 'Webby Awards 2014 honoree',
    url: 'https://winners.webbyawards.com/2014/apps-software/handheld-devices/experimental-innovation/145044/google-chrome-world-wide-maze',
  },
  dandad: {
    label: 'D&AD awards archive',
    url: 'https://www.dandad.org/work/d-ad-awards-archive/world-wide-maze',
  },
  futurek: { label: 'FUTUREK’s project page', url: 'https://www.futurek.com/works/detail/worldwidemaze' },
  caseStudy: {
    label: 'Saqoosha, “Case Study: Inside World Wide Maze” (web.dev)',
    url: 'https://web.dev/case-studies/world-wide-maze',
  },
  song: { label: 'KAISOKU TOKYO, “8” (Bandcamp)', url: 'https://kaisokutokyo.bandcamp.com/track/8' },
  label: { label: 'Label announcement (1fct)', url: 'https://1fct.net/news/n_5714' },
  lions: { label: 'Saqoosha’s blog, June 29, 2013', url: 'https://saqoo.sh/a/2432' },
  oculus: { label: 'Saqoosha’s blog: “The Ball”', url: 'https://saqoo.sh/a/2437' },
  diary: { label: 'Moving Model production diary', url: 'https://mowwmmm.tumblr.com/' },
  wwmmm: { label: 'Katamari-Inc/WWMMM on GitHub', url: 'https://github.com/Katamari-Inc/WWMMM' },
  cloud: {
    label: 'Google Cloud Platform blog, November 7, 2013',
    url: 'https://cloudplatform.googleblog.com/2013/11/build-amazing-games-on-google-cloud-platform-with-nodejs-and-websocket.html',
  },
  lostMedia: {
    label: 'r/lostmedia discussion, May 2023',
    url: 'https://www.reddit.com/r/lostmedia/comments/13e0vkv/',
  },
  bundle: {
    label: 'Archived desktop bundle (Internet Archive)',
    url: 'https://web.archive.org/web/20130322175436id_/http://www.chrome.com/maze/pc/scripts/main.js',
  },
  locale: {
    label: 'Archived English localization (Internet Archive)',
    url: 'https://web.archive.org/web/20130322175440id_/http://www.chrome.com/maze/locales/en/translation.json',
  },
  trailer: { label: 'Launch trailer (YouTube)', url: 'https://www.youtube.com/watch?v=7AvTl9aU5D8' },
  talk: { label: 'Japanese technical talk (YouTube)', url: 'https://www.youtube.com/watch?v=ELSTW5SgsD0' },
} satisfies Record<string, Source>;

export interface Credit {
  name: string;
  where?: string;
  role: string;
  sources: Source[];
}

/** research/world-wide-maze.md "Who deserves credit". */
export const CREDITS: Credit[] = [
  {
    name: 'Google Japan',
    role: 'Client and commissioning organization.',
    sources: [SRC.oneShowSilver, SRC.webbyNominee],
  },
  { name: 'PARTY', where: 'Tokyo', role: 'Agency.', sources: [SRC.oneShowSilver, SRC.webbyNominee] },
  {
    name: 'AID-DCC',
    where: 'Tokyo',
    role: 'Production company.',
    sources: [SRC.oneShowSilver, SRC.webbyNominee],
  },
  {
    name: 'Katamari',
    where: 'Tokyo',
    role: 'Production company.',
    sources: [SRC.oneShowSilver, SRC.webbyNominee],
  },
  {
    name: 'FUTUREK',
    where: 'Tokyo',
    role: 'Production company. Its own case study identifies its work as backend development.',
    sources: [SRC.oneShowSilver, SRC.futurek],
  },
  {
    name: 'Saqoosha',
    role: 'Wrote the detailed first-person engineering case study, and related posts about the installations.',
    sources: [SRC.caseStudy, SRC.oculus],
  },
];

export const SONG = {
  title: '8',
  artist: 'KAISOKU TOKYO / 快速東京',
  released: 'March 21, 2013',
  credits: [
    ['Lyrics', 'Tetsumaru Fukuda'],
    ['Music', 'KAISOKU TOKYO'],
    ['Production', 'Kentaro Nakao'],
    ['Recording and mixing', 'Yuji Kamijo'],
    ['Drum tech', 'Kazuharu Sara'],
  ] as [string, string][],
  sources: [SRC.song],
};

export interface TimelineEvent {
  date: string;
  /** ISO-ish sortable key. */
  when: string;
  text: string;
  sources: Source[];
  /** Secondary testimony, a caveat, or this project. */
  kind?: 'secondary' | 'tribute';
}

/** research/world-wide-maze.md "Timeline and recognition" (+ the recovery dates from "What was recovered"). */
export const TIMELINE: TimelineEvent[] = [
  {
    when: '2013-03-21',
    date: 'March 21, 2013',
    text: 'Public launch as a Chrome Experiment, in Google Japan’s announcement. The promotional song “8” by KAISOKU TOKYO is released the same day.',
    sources: [SRC.launch, SRC.experiments, SRC.engadget, SRC.song],
  },
  {
    when: '2013-03-22',
    date: 'March 22, 2013',
    text: 'The Internet Archive captures the desktop game bundle and its English text. These captures are the main evidence this tribute is built from.',
    sources: [SRC.bundle, SRC.locale],
  },
  {
    when: '2013-06',
    date: 'June 2013',
    text: 'Saqoosha’s June 29 post reports a Mobile Lions Gold award.',
    sources: [SRC.lions],
  },
  {
    when: '2013-09',
    date: 'September 2013',
    text: 'Saqoosha describes “The Ball”, an Oculus Rift adaptation shown at PARTY’s ggg exhibition. The post also mentions a web update for Chrome’s fifth birthday.',
    sources: [SRC.oculus],
  },
  {
    when: '2013-11',
    date: 'November 2013',
    text: 'The World Wide Maze Moving Model installation is documented at dotFes. Google publishes an account of the game’s cloud architecture.',
    sources: [SRC.diary, SRC.wwmmm, SRC.cloud],
  },
  {
    when: '2014',
    date: '2014',
    text: 'The One Show: Silver Pencil for Cross-Channel Integration and Merit for Branded Games. Webby Awards: nominee, and honoree for Experimental & Innovation. D&AD: Wood Pencil.',
    sources: [SRC.oneShowSilver, SRC.oneShowMerit, SRC.webbyNominee, SRC.webbyHonoree, SRC.dandad],
  },
  {
    when: '2023-05',
    date: 'May 2023',
    text: 'A lost-media discussion reports an exchange with Saqoosha about the closed backend. This is secondary testimony, not an authenticated interview, and its shutdown year is unverified.',
    sources: [SRC.lostMedia],
    kind: 'secondary',
  },
  {
    when: '2026-09',
    date: 'September 2026',
    text: 'For this tribute, the archived bundle and localization are retrieved and studied as text (never run), and the installation’s stage data is inspected. The rebuild starts here.',
    sources: [],
    kind: 'tribute',
  },
];

export interface TechRow {
  part: string;
  was: string;
  wasSources: Source[];
  now: string;
}

/** Then: research + Saqoosha's case study. Now: this repo's package READMEs. */
export const TECH: TechRow[] = [
  {
    part: 'Capturing the page',
    was: 'PhantomJS, a headless WebKit browser, took a screenshot and recorded where the div and img tags were.',
    wasSources: [SRC.caseStudy],
    now: 'Headless Chromium (Playwright, Cloudflare Browser Rendering) takes a screenshot and records the rectangles of text, images and other elements.',
  },
  {
    part: 'Building the maze',
    was: 'A C++ program, stage_builder, using OpenCV and Boost, running on a Google Compute Engine server in the US.',
    wasSources: [SRC.caseStudy],
    now: 'A TypeScript library that runs the same kind of steps, deterministic for a given seed, in a Cloudflare Worker and in the browser.',
  },
  {
    part: 'Drawing the world',
    was: 'three.js r53, with poly2tri for triangulating islands.',
    wasSources: [SRC.caseStudy],
    now: 'three.js r186 with its WebGPU renderer and a WebGL 2 fallback.',
  },
  {
    part: 'Physics',
    was: 'Ammo.js (Bullet compiled to JavaScript) through Physijs, in a Web Worker.',
    wasSources: [SRC.caseStudy],
    now: 'Rapier 3D compiled to WebAssembly, in a Web Worker. A deterministic build, so a recorded run replays the same way in the browser and on the server.',
  },
  {
    part: 'Phone to computer',
    was: 'Tilt data travelled over WebSocket through Socket.IO 0.9.11 and a Node.js relay. Players paired with a six-digit code, Tab Sync, a QR code or an emailed link.',
    wasSources: [SRC.caseStudy, SRC.locale],
    now: 'A WebSocket relay on Cloudflare Durable Objects with a six-digit code and a QR code. Keyboard and gamepad too.',
  },
  {
    part: 'Servers',
    was: 'App Engine for web requests and orchestration, Compute Engine for relays, databases and stage generation.',
    wasSources: [SRC.cloud],
    now: 'Cloudflare Workers, R2 for stages and textures, D1 for runs and scores, KV for caching.',
  },
];

/** research "Remaining gaps": what nobody (including us) can currently confirm. */
export const GAPS = [
  'complete individual credits',
  'the original budget and schedule',
  'verified usage statistics',
  'the exact shutdown date and reason',
  'the original server code',
  'the mobile controller’s code and most of the original art and audio',
  'the complete network protocol',
  'precise timer and life rules in every build',
  'permission to reuse the original branding, art, audio or unlicensed code',
];

export const ORIGINAL_ASSETS_NOTE =
  'No original art, audio, logos or code from 2013 appear in this rebuild. The archived files were read as text to learn the rules and numbers, and are not redistributed.';
