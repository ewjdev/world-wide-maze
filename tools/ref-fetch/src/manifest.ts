// Pinned third-party reference artifacts. They are downloaded into `reference/` (gitignored), never committed.
// Hashes for the first three entries come from research/recovery-evidence.json. The others were pinned
// at first retrieval during Phase 01 (2026-09-25). See docs/reference/archive-index.md.

export interface Artifact {
  /** Stable short id, also used for `--only <id>`. */
  id: string;
  /** File name inside reference/. */
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  /** Whether a failure should fail the whole run. */
  required: boolean;
  note: string;
}

export const ARTIFACTS: readonly Artifact[] = [
  {
    id: 'main-js',
    file: 'original/desktop-main.js',
    url: 'https://web.archive.org/web/20130322175436id_/http://www.chrome.com/maze/pc/scripts/main.js',
    sha256: '85cf4f726c4b7f8ffe6462b0a60910411bbd5a13efa8ef753142ab5aee8bab51',
    bytes: 1062393,
    required: true,
    note: 'Archived 2013 desktop bundle (RequireJS, 109 named defines). Inspect as text only; never execute.',
  },
  {
    id: 'translation-en',
    file: 'original/translation-en.json',
    url: 'https://web.archive.org/web/20130322175440id_/http://www.chrome.com/maze/locales/en/translation.json',
    sha256: 'c3c36a21fa26b3c82391baa916f0232d19826f18a4c73c9a44a9a52c19c58ed1',
    bytes: 9178,
    required: true,
    note: 'English i18next localization, March 22 2013.',
  },
  {
    id: 'translation-ja',
    file: 'original/translation-ja.json',
    url: 'https://web.archive.org/web/20130828010222id_/http://chrome.com/maze/locales/ja/translation.json',
    sha256: '0752baae047ebe52933dd1c97cd965a36d77a70d6c0273e2a2a529fd64c374a9',
    bytes: 12309,
    required: false,
    note: 'Japanese localization, August 28 2013 capture (same 100 keys as en).',
  },
  {
    id: 'physijs-worker',
    file: 'original/physijs_worker.js',
    url: 'https://web.archive.org/web/20130605194946id_/http://chrome.com/maze/common/scripts/libs/physijs_worker.js',
    sha256: '95cb830dbe5c5b2786b772a1ed16c775f9719d4f55c9e1c528362292ed05713b',
    bytes: 22266,
    required: false,
    note: "Saqoosha's Physijs worker fork (MIT upstream). Shows the fixed 1/60 s physics step.",
  },
  {
    id: 'wwmmm-json',
    file: 'wwmmm/http-aid-dcc.json',
    url: 'https://raw.githubusercontent.com/Katamari-Inc/WWMMM/be2bea8f87cdb2a6394e6e8140436a2e12e28d35/_StageRenderer/bin/data/http-aid-dcc.json',
    sha256: 'ba8a6fdf2837a6ffe9431c01dae3fcc8a7699d6fd7f9e25a6f6320a62fb51377',
    bytes: 33748,
    required: true,
    note: 'WWMMM installation stage JSON (no license). Real-world geometry fixture.',
  },
  {
    id: 'wwmmm-png',
    file: 'wwmmm/http-aid-dcc.png',
    url: 'https://raw.githubusercontent.com/Katamari-Inc/WWMMM/be2bea8f87cdb2a6394e6e8140436a2e12e28d35/_StageRenderer/bin/data/http-aid-dcc.png',
    sha256: '0e6e339750f7d449f7a25c84b340a06dbaa293453a38e4f09376185194b0e626',
    bytes: 617272,
    required: true,
    note: 'WWMMM stage texture, 1024x2048 RGBA. The page occupies rows 692..2047 (same layout as the 2013 client texture canvas).',
  },
];
