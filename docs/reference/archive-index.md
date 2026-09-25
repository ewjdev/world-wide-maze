# Internet Archive index for `chrome.com/maze/*`

Queried 2026-09-25 via the Wayback CDX API (`collapse=urlkey`, first capture per URL). The first unfiltered query returned 2,000 rows, almost all of them `/maze/NNNNNN` URLs. Those are **six-digit pairing codes** captured from shared links, which is evidence of the Tab Sync / URL pairing flow in the wild. A later query briefly returned "Temporarily Offline" and succeeded on retry.

Only rows with HTTP 200 are listed. "Fetched" means the file is in `ref:fetch`. "Lead" means it is indexed but not downloaded.

## Scripts and data
| Capture | Size (gz) | URL | Status |
|---|---|---|---|
| 2013-03-22 17:54:36 | 261,160 | `/maze/pc/scripts/main.js` | **Fetched** (desktop bundle) |
| 2013-03-22 17:54:40 | 3,405 | `/maze/locales/en/translation.json` | **Fetched** |
| 2013-08-28 01:02:22 | 4,168 | `/maze/locales/ja/translation.json` | **Fetched** (same 100 keys as en) |
| 2013-06-05 19:49:46 | 5,017 | `/maze/common/scripts/libs/physijs_worker.js` | **Fetched**. Saqoosha's Physijs worker fork: `world.stepSimulation(1/60, 0, 1/60)` on every `simulate` call, i.e. fixed 60 Hz steps with no substeps |
| 2013-03-22 02:47:18 | 39,568 | `/maze/common/scripts/libs/require-jquery.js` | Lead (library) |
| 2013-03-22 02:47:22 | 8,585 | `/maze/common/scripts/libs/i18next.amd.withJQuery-1.5.10.js` | Lead (library) |
| 2013-07-18 | 8,794 | `/maze/common/scripts/libs/i18next-1.6.0.min.js` | Lead (a later build upgraded i18next) |
| 2014-01-22 | 16,734 | `/maze/common/scripts/libs/leap.min.js` | Lead. **Leap Motion** support was added in a later build (not in the March 2013 bundle) |
| 2013-03-22 | 1,018 | `/maze/pc/scripts/notsupported.js` | Lead |

**Not indexed:** any mobile/controller bundle (no `/maze/mobile*` or `/maze/sp*` entries), the ammo.js build used by the worker, and later desktop `main.js` builds.

## Styles
`/maze/pc/styles/main.css` (7,028), `/maze/pc/styles/not-supported.css`, `/maze/pc/styles/requirements.css` (2013-07), `/maze/tabsync/styles/main.css`. These are leads for HUD layout measurements. Not fetched (original art direction; read-only reference if needed).

## Models, textures, audio (original art: never commit, and treat as reference only)
- Models: `/maze/pc/models/ball.dae` (77 KB), `logo.dae`, `pc_smartphone.dae`
- Textures: `/maze/pc/textures/ball.png`, `color_palette.jpg` (curtain transition palette), `colors_line.png`, `colors_line_dark.png`, `goal-base.png`, `oneup.png`, `pillar.png`, `you.png`
- UI sprites: `/maze/pc/images/{building,connect,connected,error,footer,game,howto,loading,nondisplay,not-supported,preview,ranking,search,stage-result,title}/…` (the `game/sprite.png` sheet is 13 KB), `game/awyeah.png` (2013-10, a later build)
- Fonts: `/maze/common/fonts/wwm-Medium.ttf` (custom typeface)
- Audio: `/maze/pc/sound/bgm.ogg` (948 KB), `rolling.ogg`, `se.ogg`
- Social: `/maze/common/images/ogimage.jpg`, `favicon.ico`

## Pages (HTML, 200)
`/maze/` (entry HTML with WebGL/Worker/WebSocket feature detection → `pc/not-supported/`), `/maze/connect` (phone-initiated pairing), `/maze/pc/not-supported/`, `/maze/pc/requirements/`, `/maze/tabsync/pc.html` (+ privacy/terms), and many `/maze/?http://<site>` deep links. These are shared stage links such as engadget.com, wired.com, youtube.com, kaisokutokyo.com, fathead.com, creativity-online.com, dynamitemaps.com and evilwindowdog.com. They are a good seed list for a curated "sites people actually played" set (**R**).

## Related repositories (GitHub)
- `Katamari-Inc/WWMMM @ be2bea8`: `_StageRenderer/bin/data/` holds `http-aid-dcc.json` + `.png` (**fetched**), plus `ball.dae/obj`, `goal.obj`, `stage.blend/dae/obj`, and GLSL for bridge/ocean/fireworks/point items/ripple, `ocean.png`, `color_palette.jpg`, `colors_line*.png`. No license, so reference only.
