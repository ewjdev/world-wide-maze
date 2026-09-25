# Fidelity spec: World Wide Maze (2013) → revival

**Labels:** **E** = Evidenced (source given). **R** = Reconstructed (inferred, with reasoning). **N** = New (our addition or deliberate change).

**Sources:** `main.js` = the 2013 desktop bundle (module name, `@byte offset`; see [bundle-notes.md](bundle-notes.md)). `i18n` = translation-en/ja.json ([ux-flow.md](ux-flow.md)). `WWMMM` = the installation stage fixture ([stage-format.md](stage-format.md)). `CS` = Saqoosha's web.dev case study. `worker` = physijs_worker.js.

**Unit conversion:** 2013 world unit (WU) = 10 px of a 1024 px stage. 2013 ball radius 0.54 WU. With the contract `BALL_RADIUS_M = 0.5`, **1 WU = 0.926 m**. 2013 physics ran at a **fixed 60 Hz** (worker: `stepSimulation(1/60,0,1/60)`), and per-tick factors are converted to per-second (and to 120 Hz for `SIM_HZ`). Contract questions are tracked in [contract-deltas.md](contract-deltas.md) (CD-n).

## 1. Controls
| Feature | 2013 behavior / value | Label · source | Rebuild default |
|---|---|---|---|
| Tilt model | Tilt **rotates the gravity vector** (Euler ZXY from the phone angles), expressed in the camera's yaw frame. No push force | E · `game/world` orientation `update` @1029379 | Same. Sim needs the camera heading (CD-4) |
| Phone max tilt | Pitch ±45° (`deviceMaxAngleZ`/`gravityMaxAngleZ` 45), roll ±20° (`…Y` 20) | E · presets.json @737795 | pitch 0.785 rad, roll 0.349 rad |
| Neutral pose | Pitch neutral at gamma = −45° (phone tilted towards the player); `(gamma+45)/45` | E · `setCurrent` @1028738 | Calibrate the rest pose at "match dots" (the calibrated zero replaces the fixed −45°) — R: the phone bundle is lost; the PC side assumes −45° |
| Tilt smoothing | Slerp 0.09 per 60 Hz tick → τ ≈ 0.18 s | E · `deviceSensitivity` | α = 0.0461 per 120 Hz tick (same τ). Keep the filter on the host (contract §6) |
| POWER | Tilt acts **only while POWER is held**. Press → ball glow on, damping "active". Release → target tilt 0 (gravity eases back to vertical), angular damping 0.99 (brakes) | E · `enableOrientation`/`disableOrientation` @1045450 area; i18n `tutorial.mobile.step3` | Same (`InputSample.power`) |
| JUMP | Impulse → Δv = 18 WU/s (16.7 m/s) up. Only if the ball touched anything in the last **100 ms**. POWER not required. Disabled before tutorial step 4 | E · `ball.jump` @899366, `world.jump` | Same |
| MENU / M | Opens the map/pause | E · keycontrol `case 77`, i18n `step5` | Same. Esc also (N) |
| Keyboard | Arrows = target tilt ±25° per axis, ramped 2.7°/tick (162°/s). **Any arrow held = POWER on**, off 100 ms after release. Space = jump, M = map | E · `app/keycontrol` @735633, presets | Same. Add WASD (N) |
| Gamepad | none | — | Left stick = tilt (magnitude > deadzone = POWER), A = jump, Start = map (N) |
| Easter egg | Konami code → takoyaki ball | E · `ball` @899521 | Optional tribute (N) |

## 2. Physics (defaults for Phase 05; tuning lives in `@wwm/physics`)
| Parameter | 2013 value | Label · source | Rebuild default (SI) |
|---|---|---|---|
| Fixed step | 1/60 s, no substeps | E · worker | `SIM_HZ = 120` with per-second constants below (or 60 for strict parity) |
| Gravity | 50 WU/s² (≈4.7 g in ball-relative terms). Doubles to 100 over 1 s while falling | E · `world.gravity`, FALLING tween | 46.3 m/s² (92.6 while falling) |
| Ball | Sphere r 0.54 WU, **mass 1**, never sleeps | E · `ball` @893798/@892477 | r 0.5 m, 1 kg |
| Ball friction / restitution | 0.95 / 0.35 | E · presets | same |
| Island & bridge surface | friction 0.95, restitution 0.7 | E · presets | same |
| Rails | friction 0.5, restitution 0.7 | E · presets | same |
| Contact combine | Bullet multiplies friction and restitution → ball–floor μ 0.9025, e 0.245. Ball–rail μ 0.475, e 0.245 | E (Bullet default) · R (not overridden in the fork) | Rapier `CoefficientCombineRule.Multiply` for both |
| Linear damping | 0.7 active and inactive (Bullet: v·(1−0.7)^dt → 1.204 /s) | E · presets | Rapier `linearDamping ≈ 1.20` |
| Angular damping | 0.7 active (1.204 /s). **0.99 inactive** (4.61 /s) | E · presets | 1.20 while POWER, 4.61 otherwise |
| Rough feel check | Jump apex ≈ 2.5 WU (≈4.7 ball radii, with damping). Max downhill accel at 45° ≈ 25 WU/s² for a rolling sphere (5/7 g sin θ) | R (derived) | Use as test expectations with a tolerance |
| Item sensors | Ghost sphere r 1 WU, centred 0.54 WU above the surface | E · `stage` @~955000 | r 0.926 m |
| Goal sensor | Ghost cylinder r 1 WU, h 2 WU | E · `goal` | r 0.926 m, h 1.85 m |

## 3. Camera
| Feature | 2013 | Label · source | Rebuild default |
|---|---|---|---|
| Follow | Chase camera on a **leash**: a dummy point trails the ball 2.1 WU horizontally, and the camera sits behind along ball→dummy at **distance 5 WU, elevation 35°**. Lerp 0.11/tick (τ ≈ 0.14 s). y ≥ 0. No manual camera control | E · `followcamera.follow` @910744, presets (`cameraAngle 35`, `cameraBeta 21`, `cameraGamma .11`) | distance 4.63 m, elevation 35°, leash 1.94 m, τ 0.14 s |
| Lens | FOV 70°, near 0.1 WU, far 1500 WU | E · `init3D` | FOV 70°, near 0.09 m |
| Tilt feedback | `camera.up` and the background lean with 20–50 % of the tilt | E · orientation `update` | Same, off under `prefers-reduced-motion` (N) |
| Respawn framing | Behind the respawn point, facing the goal | E · `resetToStart` | same |
| Map view | Orbit the whole stage at height 50 WU, radius 1.7 × fit-width, 0.2 rad/s. "YOU" marker spins over the ball | E · `rotateAround`, `ball.showImHere` | Same, plus drag-to-rotate (N) |
| Intro | About 20 s: page upright → folds flat (5 s), islands extrude (3 s), bridges rise (3 s), items appear. Camera fly-over start→goal. Ball drops in a cage (3 s) | E · `stage.startIntro`, `followcamera.opening`, `world` OPENING `wait(15e3)` | Same sequence, **skippable**, target ≤ 8 s after the first play (N) |

## 4. Rules: timer, lives, falls, restart
| Feature | 2013 | Label · source | Rebuild default |
|---|---|---|---|
| Time limit | **Fixed 300 s** per stage, no formula | E · `game/world` Timer @1027009 | `timeLimitSec = 300`. Difficulty presets may vary it (N) |
| Timer start | At the first POWER press (first game) or on entering GAME (later) | E · `enableOrientation` step 3 | same |
| Timer pauses | Map/pause, falling, fly-away, window blur (auto-pause) | E | Also on controller disconnect (N) |
| Last 30 s | Caution SE and "timeup" BGM | E · `last30` | same |
| Timer on respawn | **Reset to 300 s** on every restart (after a fall or time-up) | E · RESTARTING `timer.reset()` | same (faithful). Flag for playtest |
| Lives | `numBallLeft = 3` spares. Fall or time-up: −1. **Game over when < 0** (4 attempts). HUD shows 3 icons (spares) | E · `app/app` init, FALLING/TIMESUP, `gameinfo.setBallCount` | same |
| Fall trigger | Ball world height < 0 (≥10 WU below the lowest island in the fixture) → FALLING: input off, gravity ×2, falling BGM. At y < −80 WU the ball is lost (ripple), then 3 s later restart or game over | E · `onUpdate_GAME/FALLING` @1046260 | Trigger 9 m below the lowest island top; lost 3 s later (CD-10) |
| Time up | −1 ball, "TIME IS UP" (or "GAME OVER") sign 3 s, then restart | E · TIMESUP @1037189 | same |
| Restart point | Nearest restart point of the **last-touched island** to the last contact position (fallback: stage start). Ball dropped in with the cage | E · RESTARTING @1037706 | same |
| Game over | Stage score = items only. Go to ranking. Spares reset to 3 | E | same |

## 5. Scoring
| Feature | 2013 | Label · source | Rebuild default |
|---|---|---|---|
| Small item | +1 (credited 300 ms after pickup) | E · `SMALL_SCORE`, collision handler | same |
| Large item | +100 | E · `LARGE_SCORE` | same |
| Time bonus | 5 × remaining whole seconds, at the goal | E · `TIME_SCORE`, FLY_AWAY | same |
| Stage score | time bonus + 100 × large + small | E · FLY_AWAY | same |
| Session total | Accumulates over consecutive stages until finish or game over | E · `sharedobject totalScore`, `stageresult` | same (run = session) |
| One-up | Each crossing of a multiple of **3000** in the session total → +1 spare if spares < 3. Also checked during the result count-up | E · `addScore` @1043673, `stageresult.setTimeRemains` | same |
| Ranking | Global top 10 of session totals, name `[a-z0-9_]`, skip = not submitted | E · `app/page/ranking`, gateway | Per-stage boards **and** a run board (CD-8, N) |

## 6. Items, bridges, ramps, elevators, rails (see stage-format.md for distributions)
| Feature | 2013 | Label · source | Rebuild default |
|---|---|---|---|
| Small items | Many (501 in the fixture). Merged into one GPU mesh, teal icosahedra hovering 0.6 WU and animated by a shader. Placed on inset rings about 0.9 D and 2.3 D from edges, spaced ≈1.5 D | E · `smallitemgroup`, WWMMM stats | Density target 8–16 per 10k 2013-px² (≈1 per 10 D²) |
| Large items | ≤ 6 (CS). 4 in the fixture, at distance-transform maxima. Rotating faceted icosahedra that explode on pickup | E · CS, `largeenergy`, WWMMM | ≤ 6 |
| Bridges | Straight, cardinal directions only (0/90/180/−90°), deck width 1.6–3.6 D, a thin side rail each side | E · WWMMM, `stage` bridge builder | Cardinal default. Width ≥ contract minimum |
| Ramps | Any height change with slope ≤ **10° (0.176)** | E · WWMMM (max slope exactly 0.176) | CD-2 |
| Elevators | Bridge `type 1` across short gaps (≤10 px) for 40–80 px rises. Switch-triggered at either end. Travel 1 s + 0.15 s/WU. 2 s cooldown. Ball velocity zeroed during the ride | E · `elevator` @921689, WWMMM | CD-3 |
| Maze topology | Spanning tree (islands = bridges + 1): a perfect maze from randomized DFS | E · WWMMM (38/37), CS | same (loops optional per difficulty, N) |
| Start / goal | Start top-left, goal bottom-right (distance-transform maxima) | E · CS, WWMMM (start `[44,74]`, goal `[596,1305]`) | same |
| Rails | Along island outlines (≈90 % coverage), open at bridge mouths. A thin ribbon 0.5–0.6 WU above the surface | E · WWMMM, `stage` rail builder | Collider 0–0.56 m tall (R: simpler and safer than a floating ribbon) |
| Island slab | 0.5 WU thick, flat colour sides, page texture on top (and bottom) | E · `stage` | 0.46 m |
| Heights | Continuous, 100–250 px (≈9–23 D) in the fixture | E · WWMMM | CD-2. How heights were chosen is unknown (**R**: likely random per island or tree depth) |

## 7. Map
| Feature | 2013 | Label · source | Rebuild default |
|---|---|---|---|
| Access | MENU (phone), M (keyboard), the on-screen MENU button, window blur | E | + Esc, gamepad Start (N) |
| Behavior | Full stop (physics and timer paused). Orbiting overview with a "YOU" marker | E · PAUSE | same |
| Options | Search another site · quit to title (confirm "Do you really want to leave this stage?") · back | E · `gameinfo.showPause`, i18n `game.confirm` | Retry stage (N) + same |
| Phone map | The PC sent position (10 Hz) and stage data to the phone | E (data) / R (phone UI) | Optional (CD-9) |

## 8. Pairing, connection, calibration
| Feature | 2013 | Label · source | Rebuild default |
|---|---|---|---|
| Code | 6 digits ("secret") issued by the server. URL `/maze/NNNNNN` auto-pairs (Tab Sync) | E · `app/app`, i18n `connect.*`, CDX | 6 digits, `/c/<code>` (contract §6) |
| Methods | Tab Sync, QR, typed URL `g.co/maze` + code, email link. Pairing can start from the phone (`/maze/connect`). PC-only play | E · i18n, templates | QR + URL/code + PC-only. Tab Sync dropped (N) |
| Transport | Socket.IO 0.9 relay, key/value "shared object" sync (orientation, power, jump, app/world state) | E · `common/sharedobject`, `app/app` | Binary WS input + JSON (contract §6) (N) |
| Connected | "Connected!" 4 s then stage select | E | same, shorter (N) |
| Disconnect | Error page "PC and mobile phone disconnected. Reload browser and connect again." Reload only | E · i18n `disconnected`, `app/page/error` | Auto-pause, reconnect with the same code, resume (N) |
| Calibration | First game only: "Tilting the phone, match dots on bottom left of screen". Success = indicator within 3 of 90 px of centre (≈2°). **15 s timeout → keyboard mode** with a hint | E · `orientationindicator.startZeroCheck` @1008056, i18n `tutorial.mobile.step1/7` | Same flow. The zero is recorded from the held pose (R) |
| Too tilted | "Too tilted!" when the indicator is > 45/90 (≈ half range), 500 ms hysteresis | E · `setTooTiltedVisible` | same |
| Portrait lock | Advised ("Lock smartphone to portrait orientation") | E · i18n `connect.devicelock` | Screen Orientation lock when available, else advise (N) |
| Permissions | n/a in 2013 | — | iOS motion permission tap, denied → fallback (N) |

## 9. Stage selection, building, conversion failure
| Feature | 2013 | Label · source | Rebuild default |
|---|---|---|---|
| Choose a site | Web search (Google CSE, safe=high), "Practice site" (google.com), "Popular sites" with difficulty stars | E · `app/page/stageselect` | Paste URL + curated list with difficulty (N) |
| Stage size | Fixed 1024 × 1358 px of the page | E · `common/config` | CD-1 |
| Build time | Building screen ≥ 5 s. **Timeout 30 s** | E · `app/app` @1050401 | Progress via SSE, timeout per Phase 07 |
| Conversion failure | Silently builds a stage from the "not available" page | E · `ERROR_STAGE_URL` | Explicit error code + curated fallback. An optional tribute "not-available" maze (N) |
| Shared link | `/maze/?http://site` → builds that site, shows a preview (Play / Visit) | E · `app/app` | `/play/:stageId` share links (N) |

## 10. Result and ranking flow
| Feature | 2013 | Label · source | Rebuild default |
|---|---|---|---|
| Goal sequence | Ball pulled into the goal, flies up 2 s. Fireworks = remaining seconds mod 10. "GOAL" sign after a tile curtain | E · `onUpdate_FLY_AWAY` | same |
| Stage result | Title/URL, count-up of seconds × 5 (≤3 s), large × 100, small × 1, stage score, total, "1UP" pop. Share. **Next stage** / **Finish** | E · `stageresult`, template | same + per-stage leaderboard (N) |
| Ranking | Rank in the global top 10 of totals. Name entry (OK/skip). New game / back to top. Share "I just became Nth place" | E · `ranking`, i18n | Run board (CD-8) |

## 11. Presentation (visual targets; art is a modern tribute)
| Feature | 2013 | Label · source | Rebuild default |
|---|---|---|---|
| Palette | Bright, near-white fog `#F8F8F8`. Pastel faceted "ocean" (`COLOR_TRIANGLE`) with wire colours (`COLOR_WIRE`). Green bridges, red elevators, yellow rails, blue island sides, white line overlays | E · `common/config`, `stage`, `materiallib` | Same colour roles, new assets (N) |
| Ocean | Not water: a faceted triangle plane 3000 WU wide at y = −200 WU, with dots, ripples, clouds and stars. Rotates with the tilt | E · `background`, presets `groundY` | same concept |
| Ball | Chrome Phong shell (reflective env map, updated every 3rd frame) + glowing core that brightens with POWER | E · `ball`, `world.renderFrame` | PBR chrome + emissive core tied to POWER |
| Glow | Selective bloom (ball core, items) at ½, ¼ and ⅛ resolution | E · `renderer`, CS | same |
| Island texture | Page screenshot, anisotropy 4. **Switches to nearest-neighbour filtering 10 s into the intro** (a deliberate pixel look) | E · `stage._build`, `startIntro` | Offer both, default linear (R: accessibility and readability) |
| HUD | TIME + score top-left, LIFE (3 icons) top-right, orientation indicator + MENU bottom-left, centred instruction text, sign sprites (TIME IS UP / GOAL / GAME OVER) | E · `game.html`, embedded screenshot (visual-notes) | same layout, colour-independent cues (N) |
| Perf ladder | <45 fps: env map off · <40: 0.7 render scale · <40: FXAA off · <30: glow off | E · `renderer` @863421 | Same ladder + DPR clamp (N) |
| Audio | BGM: opening/game/timeup/result/over. About 15 SEs incl. rolling loop pitched by speed, impact volume ∝ vertical speed² | E · `sound/soundeffect` | New audio with the same cue list (N) |

## 12. Open questions (need footage, a human, or the mobile bundle)
1. The exact phone UI and whether it drew a map (R).
2. How island heights were chosen by the builder.
3. Whether the time limit or other rules changed in later builds (the index shows later builds with Leap Motion support, 2014).
4. How reset-timer-on-respawn plays in practice. It is evidenced but generous, so playtest it.
