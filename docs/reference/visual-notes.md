# Visual notes (best-effort)

## What was attempted
| Source | Result |
|---|---|
| Launch trailer, [youtube.com/watch?v=7AvTl9aU5D8](https://www.youtube.com/watch?v=7AvTl9aU5D8), "Chrome World Wide Maze", 42 s | Page metadata retrieved. Its description (ja + en) repeats the pitch ("Transform your favorite websites into 3D mazes! … uses Chrome Tab Sync … compete with players around the world") and credits the music to KAISOKU TOKYO. The only caption track is auto-generated ASR over music, so it was not useful. **No frame review was possible from this environment.** |
| Technical talk, [youtube.com/watch?v=ELSTW5SgsD0](https://www.youtube.com/watch?v=ELSTW5SgsD0), "Inside World Wide Maze – 事例に学ぶHTML5開発 第41回 HTML5とか勉強会", 20:12, speaker @Saqoosha (Katamari Inc) | Metadata only. No caption track. |
| **An in-game screenshot embedded in the WWMMM fixture texture** (`reference/wwmmm/http-aid-dcc.png`, PARTY's own homepage from Sept 2013, which features a WWM hero image) | Usable. It is a small image of actual gameplay. Observations are below. |
| Bundle code | Colours, materials, layout ids and timings are in [bundle-notes.md](bundle-notes.md) §5–§11. |

## Observations from the embedded gameplay screenshot (Evidenced, low resolution)
Location: fixture texture, the hero banner at roughly x 545–900, y 945–1165 (texture px).
- **HUD:** top-left reads "TIME 122" followed by an item icon and "4368" (score). Top-right reads "LIFE" with three circle icons. Bottom-left shows the circular **orientation indicator** with coloured dots and a small "MENU" label. The typography is small, light and grey on a light scene. This matches `templates/game.html` ids `#time-and-score`, `#life1..3`, `#orientation-indicator`, `#game-menu`.
- **Camera:** low chase view close behind the ball, looking along a long bridge towards the horizon. The ball fills about 1/6 of the frame height, so the camera is close (5 WU ≈ 9 ball radii at 35° elevation, per the code).
- **Ball:** chrome/silver sphere with strong reflections, sitting on a dark base (the respawn "cage" or ball shadow).
- **Bridges** are saturated flat **green** decks. **Rails** are thin coloured lines (yellow/blue with a white line). The island top shows page content (a colourful ring logo, the Google-ish colours of the practice site).
- **Environment:** very bright, desaturated, nearly white sky with fog (`#F8F8F8`). The ocean is a pale faceted triangular plane in pastel colours (see the "WWM" hero logo's low-poly terrain on the same banner, which uses the same palette as `COLOR_TRIANGLE`).
- The same banner shows the **phone held in landscape-ish two-thumb grip** in a promo photo overlay. The controller copy says "Lock smartphone to portrait orientation", so treat the photo as marketing, not a spec (**R**).

## Questions for a human watching the trailer and talk
Record answers with timestamps in this file.

**Trailer (42 s)**
1. Timestamp of the page → maze transformation. Does the page stand upright and fold down flat (the code says: frame rotates −90° over 5 s, islands extrude, bridges rise from below)?
2. Camera during play: confirm the chase distance and elevation. Does the horizon visibly roll with the phone tilt (the code tilts `camera.up` by 20–50 % of the tilt)?
3. Ball: materialize effect (the case study mentions a 320-polygon mesh effect, and the code has a "cage" that opens 2.5 s after the drop). What does the cage look like?
4. Items: small item colour and shape (the code uses teal-ish icosahedrons, hue from `0x31A4AE`, noise-varied), large item look (a faceted icosahedron in a shell), and the pickup effect.
5. Ocean: faceted triangle plane vs water? Ripple on ball loss? Clouds?
6. Goal: pole height and look, fireworks, the "GOAL" sign style, and the tile "curtain" transition.
7. HUD during play: TIME/score positions, LIFE icons, and the indicator. Any on-screen POWER/JUMP hints?
8. Phone UI: the POWER, JUMP and MENU button layout and colours, and whether the phone shows a map.
9. Island edge style: side colour (the code uses `common.blue`) and rail height relative to the ball.
10. Does the island texture look pixelated up close (the code switches to `NearestFilter` 10 s into the intro)?

**Talk (20 min, Japanese)**
1. Any statement of how island heights (`level`) were chosen. Random? By DOM depth?
2. How the time limit (fixed 300 s in the build) and scoring were tuned.
3. The phone-side UI and calibration method (is "match dots" relative to the pose at calibration, or an absolute 45° hold?).
4. Stage-builder parameters (dilate/blur sizes, minimum island size, bridge search rules, item spacing).
5. Any mention of per-site vs global rankings.
6. Measured latencies and the server-side "filler packet" iOS workaround.
7. Why tilt rotates gravity (vs applying force), and the POWER-button rationale.
