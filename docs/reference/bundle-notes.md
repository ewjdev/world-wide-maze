# Bundle archaeology: 2013 desktop `main.js`

Source: `reference/original/desktop-main.js` (fetch with `pnpm ref:fetch`). Wayback capture 2013-03-22 17:54:36 UTC, 1,062,393 bytes, sha256 `85cf4f72…ab51`. It was inspected **as text only**: split on `define("…"` boundaries and reformatted with js-beautify for reading. It was never executed.

**How to cite:** the bundle is effectively one long line, so this file cites **byte offsets** into `desktop-main.js` (`@offset`) instead of line numbers. Excerpts are short and reformatted. The code is minified CoffeeScript output, so identifiers are single letters. Comments in `// …` are ours.

Unit convention in the bundle: `WORLD_SCALE = 0.1`, so **1 world unit (WU) = 10 page px** of the 1024 px-wide stage. The ball radius is 0.54 WU (5.4 px). To convert to our contract (`BALL_RADIUS_M = 0.5`), scale by **0.926 m per WU**.

---

## 1. Module list (109 named `define`s)

Offsets are the start of each `define(`.

| Group | Modules (offset) |
|---|---|
| config/infra | `common/config` @8005, `common/sharedobject` @53297, `common/tracker` @54116, `app/session` @55669, `app/gateway` @69057, `app/preloader` @595459, `app/app` @1049327, `pc/scripts/main` @1061403 |
| pages (template + controller) | `preload`, `footer`, `nondisplay`, `preview`, `title`, `howto`, `connect`, `inputnumber`, `connected`, `stageselect`, `waitforbuild` (template `building.html`), `stageresult`, `ranking`, `error`, each as `libs/text!templates/<x>.html` + `app/page/<x>` (@628102–@710421) |
| game core | `game/updater` @710558, `game/world` @1025668, `game/renderer` @858018, `game/performanceadjuster` @844384, `game/followcamera` @904697 |
| game objects | `game/object/ball` @890130, `cage` @912179, `elevator` @914574, `goal` @922726, `largeenergy` @930908, `stage` @937419, `smallenergy2` @881712, `smallitemgroup` @886203, `clouds` @963981 (+ `clouds.json`), `background` @989988, `fireworks` @999315 |
| materials | `shaderlib` @740020, `materiallib` @744122, `dotmaterial`, `seamaterial`, `ripplematerial`, `islandfacematerial`, `bridgecolormaterial` |
| HUD sprites | `game/sprite/orientationindicator` @1005239, `gameinfo` @1010243, `timesupsign`, `goalsign`, `gameoversign`; template `game.html` @1003229 |
| input/tuning | `app/keycontrol` @735633, `libs/text!app/presets.json` @737652, `app/parametergui` @795931 (dat.GUI) |
| title "how to" 3D | `app/howto/{ConsoleUtils,ExplodeTransformer,ModelLogo,ModelAppliance,howto,cameraconstrainstage}` @812229–@839310 |
| audio | `sound/soundeffect` @877720 (Howler), `libs/howler` |
| libraries | socket.io 0.9.11, CryptoJS AES, PreloadJS 0.3.0, SoundJS 0.4.0, Namespace, poly2tri, three.js (r53-era) + ColladaLoader + FirstPersonControls + postprocessing passes (Copy/FXAA/H+V blur/Mask/Render/Shader/Save/Texture), i18next 1.5.10, requirejs text plugin, jquery.transit, jquery.qrcode, js-signals, Physijs (`libs/physi`), dat.GUI, TweenJS 0.3.0, TweenLite + EasePack, Stately.js (FSM), Stats, jquery throttle-debounce |

The RequireJS config (tail of `app/app`, ~@1061000) maps `app → pc/scripts`, `game → pc/scripts/game`, `libs → common/scripts/libs`. Physics runs in `/maze/common/scripts/libs/physijs_worker.js` (set at the top of `game/world`).

## 2. `common/config` (@8000)

```js
(function(){var e;e=.1,define("common/config",{URL_BASE:"/maze/",WORLD_SCALE:e,
 STAGE_WIDTH:1024*e,STAGE_HEIGHT:1358*e, COLOR_TRIANGLE:[…8 pastel hex…], COLOR_WIRE:[…8 hex…],
 NUM_BALLS:3,SMALL_SCORE:1,LARGE_SCORE:100,TIME_SCORE:5,ONEUP_SCORE:3e3,
 ERROR_STAGE_URL:location.origin+"/maze/pc/not-available/"})
```

- **The stage has a fixed size of 1024 × 1358 page px** (102.4 × 135.8 WU). It is not the full page length.
- `ERROR_STAGE_URL` means that a failed conversion **builds a maze out of the "not available" page** instead of showing an error screen (see §9).

## 3. Tuning presets (`presets.json` @737652, `app/parametergui` @795931)

`parametergui` has hard-coded defaults, and `presets.json` "Default" has the same values. On `init`, `params.revert()` re-applies the preset through each dat.GUI controller's `setValue → onChange`. So **these values are the ones that take effect**, including values that differ from the constructor defaults in `followcamera`/`keycontrol`.

```js
gravity:50, jumpPower:180, infiniteJump:!1, deviceSensitivity:.09,
deviceMaxAngleY:20, deviceMaxAngleZ:45, keyboardSensitivity:2.7, keyboardMaxAngle:25,
gravityMaxAngleY:20, gravityMaxAngleZ:45, cameraDistance:50, cameraAngle:35, cameraFOV:70,
cameraBeta:21, cameraGamma:.11, ballActiveLinearDamping:.7, ballActiveAngularDamping:.7,
ballInactiveLinearDamping:.7, ballInactiveAngularDamping:.99, ballFriction:.95,
ballRestitution:.35, floorFriction:.95, floorRestitution:.7, guardrailFriction:.5,
guardrailRestitution:.7, … groundY:-200, fogNear:400, fogFar:1e3, lightIntensity:1.2 …
```
(@796360, abridged)

Alternative presets A–D exist only as dat.GUI options: jump 150–250 and max angles 20–45. Players never saw them (the GUI is hidden, and Alt+H toggles it). They show the range the team explored.

## 4. Ball (`game/object/ball` @890130)

- Geometry `SphereGeometry(RADIUS)` with `RADIUS = 5.4 * WORLD_SCALE` = **0.54 WU** (@893798). The visual is a Collada model (`pc/models/ball.dae`, scale 0.0025) with a glowing "core" material and silver Phong shell (`shininess 250`, `reflectivity .98`, env map).
- Physics body: `Physijs.SphereMesh.call(this, f, p, 1)` → **mass 1** (@892477). The material is `Physijs.createMaterial(…, ballFriction .95, ballRestitution .35)`. `activation_state = 4` (never sleeps).
- Jump (@899366):
  ```js
  h.prototype.jump=function(){return this.applyCentralImpulse(new THREE.Vector3(0,this.params.jumpPower*e.WORLD_SCALE,0))}
  ```
  → an impulse of 18 WU·kg/s, so **Δv = 18 WU/s** upward.
- `activate()` / `deactivate()` tween the core glow (0.5 s up, 1 s down). These are the visual cue for POWER held vs released.
- Rolling sound pitch follows the ball's displacement every 3rd tick, and is silent when there are no contacts.
- One-up effect: the ball tints green (`0x40A193`) over 0.2 s, holds 0.3 s, then returns over 2 s. A "1UP" billboard shows, and the SE volume is ducked.
- Easter egg (@899521): the Konami code `↑↑↓↓←→←→BA` swaps the ball for a takoyaki model.

## 5. World: tilt model, states, rules (`game/world` @1025668)

### 5.1 Tilt is a rotation of gravity, not a push force
The orientation controller (@1028738) converts phone angles to a target quaternion and **rotates the gravity vector**. It then yaw-aligns the result to the camera, so "forward" is always away from the camera:

```js
t/=this.deviceMaxAngle.y, t=Math.max(-1,Math.min(1,t))*this.gravityMaxAngle.y,
r=(r+45)/this.deviceMaxAngle.z, r=Math.max(-1,Math.min(1,r))*this.gravityMaxAngle.z,
n.set(r*D,e*D,t*D), this.deviceOrientation.setFromEuler(n,"ZXY")   // D = π/180
```
```js
this.currentOrientation.slerpSelf(this.deviceOrientation,this.world.params.deviceSensitivity) …
n.set(0,-this.world.gravity,0), r.sub(ball.position,camera.position),
r.set(0,-Math.atan2(r.z,r.x)-Math.PI/2,0), e.setFromEuler(r), e.multiplySelf(this.currentOrientation),
e.multiplyVector3(n), this.world.scene.setGravity(n)
```
(@1029379, abridged)

- Inputs are (alpha, beta, gamma) in degrees from the phone. **Pitch neutral is gamma = −45°**, meaning the phone is held tilted towards the player. The code clamps ±`deviceMaxAngle` and maps to ±`gravityMaxAngle`. With the preset, **pitch (about X) is up to 45° and roll (about Z) up to 20°**. The keyboard uses 25° on both axes.
- Smoothing: slerp towards the target by `deviceSensitivity = 0.09` **per physics tick (60 Hz)**, which gives a time constant of about 0.18 s.
- A second, softer quaternion (0.2 × pitch, 0.3 × yaw, 0.5 × roll) tilts `camera.up` and the background. The horizon visibly leans with the tilt.
- `enableOrientation()` (POWER down) sets `orientation.enabled = true`, activates the ball glow, and sets **active damping** (linear 0.7, angular 0.7). `disableOrientation()` (POWER up) resets the target to identity, so gravity eases back to vertical. It also sets **inactive damping** (linear 0.7, **angular 0.99**), which brakes the roll hard. **Tilt only acts while POWER is held.**
- `world.gravity = 50` WU/s² (@1032088). During FALLING, gravity is tweened to `params.gravity × 2` = 100 over 1 s.

### 5.2 Game state machine (Stately, @~1033000)
```
NOTHING → TITLE → OPENING → (STAGE_PREVIEW) → GAME
GAME: goal→FLY_AWAY, pause→PAUSE, fall→FALLING, timesup→TIMESUP, last30→LAST30(event)
PAUSE: resume→GAME, search→NOTHING (back to site search), quit→TITLE
FALLING / TIMESUP: restart→RESTARTING | over→GAME_OVER
RESTARTING: complete→GAME        FLY_AWAY: done→RESULT
RESULT: start→OPENING | top→TITLE        GAME_OVER: top→TITLE
```
Losing window focus (`blur`) triggers `pause`.

### 5.3 Timer (@1027009)
```js
return e=300,t.prototype.start=function(){if(this.timeRemainsInt>0)return f.on.render.add(this.update)} …
t.prototype.reset=function(){return this.timeRemains=e,this.timeRemainsInt=e,this.info.setTime(e)}
```
- **The time limit is a fixed 300 s** for every stage. There is no per-stage formula.
- The timer is driven by the **render** clock. It is stopped in PAUSE, FALLING and FLY_AWAY. At 30 s it dispatches `last30` (caution SE and "timeup" BGM). At 0 it dispatches `timesup`.
- **`timer.reset()` runs in OPENING and in RESTARTING.** Every respawn after a fall or time-up gets a fresh 300 s.

### 5.4 Falls, time-up, restart, lives (@1046260, @1037189, @1037706)
```js
onUpdate_GAME=function(){return this.ball.position.y<0&&this.states.fall(),this.camera.follow(this.ball.position)}
onUpdate_FALLING: this.ball.position.y<-80 && (… numBallLeft-1 …, setTimeout(()=> numBallLeft<0 ? over() : restart(), 3e3))
```
- **Fall trigger:** ball world `y < 0`, i.e. below height 0. The lowest island in the fixture is at 10 WU, so the ball has already dropped well clear of the course. The ball is lost at `y < −80` WU, where a droplet ripple shows on the ocean. The ball count is decremented, and after **3 s** the game restarts or ends.
- **Time-up:** −1 ball, curtain, then the "TIME IS UP" sign (or "GAME OVER" if `numBallLeft < 0`) for 3 s, then restart or over.
- **Restart point:** the island-collision handler stores `lastIslandId` and `lastIslandPos` on every contact with an `island/<id>` body. RESTARTING picks **the restart point of the last-touched island nearest to where the ball last touched it**. If no island was touched, it uses the stage start. The ball is dropped in with the cage animation.
  ```js
  this.ball.lastIslandId>=0&&(o=1e8,this.data.islands[this.ball.lastIslandId].restartPoints.forEach(function(e){
    t=H.sub(h.ball.lastIslandPos,e).lengthSq(); if(t<o) return u.copy(e),o=t }))
  ```
- **Lives:** `numBallLeft` starts at `NUM_BALLS = 3` (session start, `app/app` @~1058900). Game over happens only when it drops **below 0**, so a player gets the ball in play plus 3 spares, i.e. **4 attempts**. The HUD shows 3 life icons for the spares (`gameinfo.setBallCount`). After game over, the RESULT/RANKING entry resets it to 3.
- The ball count and total score **persist across stages** within a session (stage result → "next stage").

### 5.5 Scoring and one-up (@1043673, @1038068)
```js
B.prototype.addScore=function(t){ s=e.data.totalScore, i=Math.floor(s/n.ONEUP_SCORE), r=Math.floor((s+t)/n.ONEUP_SCORE),
  i<r && e.data.numBallLeft<3 && (this.ball.showOneUp(), numBallLeft+1 …), s+=t … }
case"FLY_AWAY": … a=this.timer.timeRemainsInt*n.TIME_SCORE, stageScore = a + numLargeItems*LARGE_SCORE + numSmallItems*SMALL_SCORE,
  totalScore = totalScore + a
```
- Small item: +1 (added 300 ms after pickup). Large item: +100 immediately. Both go to the **session total**.
- Goal: time bonus = **5 × remaining whole seconds**, added to the total. `stageScore = time bonus + 100 × large + 1 × small`.
- **One-up:** each time the session total crosses a multiple of 3000, +1 ball if the reserve is below 3. The reserve cap is 3. The same check runs during the result screen's time-bonus count-up (`app/page/stageresult`).
- GAME_OVER: `stageScore` = item points only (no time bonus).

### 5.6 Jump rule (@1045450)
```js
B.prototype.jump=function(){if(!x||!M&&!this.params.infiniteJump||this.instructionStep<4)return;return this.ball.jump(),T.playSE("jump")}
```
`x` means "play enabled". `M` means the ball touched something within the last **100 ms**: contacts are tracked every physics tick, with a 100 ms grace period after leaving the ground. Jump is also locked until tutorial step 4. **Jump does not require POWER.**

### 5.7 Goal / fly-away (@1038068, `onUpdate_FLY_AWAY`)
When the ball enters the goal ghost cylinder, the game plays `get_goal` and enters FLY_AWAY. Orientation and timer are disabled. The ball is steered into the goal centre with force `80 × (goal − pos − 0.04 v)` until it is close and slow. It then rises 1500 WU over 2 s (quintIn) while the camera looks at it. **Fireworks count = round(timeRemains) mod 10**, launched at random screen positions 300–800 ms apart. Then: goal jingle, curtain, "GOAL" sign 1.6 s, curtain open, and RESULT 1 s later.

### 5.8 Pause = map (@1036830)
PAUSE stops the timer, disables orientation, saves the ball state and **stops stepping physics**. The camera orbits the whole stage (see §6). A spinning "YOU" billboard marks the ball. The overlay offers: search another site, quit (with the confirm "Do you really want to leave this stage?"), and back. On resume the ball state is restored.

### 5.9 Opening sequence
OPENING: HUD reset, then camera `opening()` for 2 s, then `stage.startIntro()`, then **15 s later** `startBall()` (@1035959). `startBall` puts the ball 10 WU above the spawn inside a cage, tweens it down over 3 s (cubicOut), opens the cage at 2.5 s, then starts the camera follow and enters GAME. The first time, GAME begins with the tutorial (§8). The intro is long, about 20 s from build to control.

`stage.startIntro()`: the page texture starts upright as a flat "frame" and rotates to horizontal over 5 s (after 1 s). Island tops, bottoms and sides extrude over 3 s (from 3 s). Bridges rise from −50 WU over 3 s (from 5 s). Rails, items and the goal fade or scale in over 3 s (from 5 s). The frame sinks and fades. **After 10 s the island texture switches to `NearestFilter`**, a deliberately pixelated look.

## 6. Camera (`game/followcamera` @904697)

The constructor defaults are `distance = 50*WS` (5 WU), angle 23°, beta 30, gamma 0.2. The preset overrides these with **distance 5 WU, angle 35°, beta 21, gamma 0.11, FOV 70°**. Near is 0.1 WU and far is 1500 WU.

```js
u.prototype.follow=function(t){o.sub(this.dummy,t),o.y=0;if(o.lengthSq())return o.setLength(this.beta*e.WORLD_SCALE),
 this.dummy.add(t,o),o.setLength(Math.cos(this.angle)*this.distance),o.y=Math.sin(this.angle)*this.distance,
 this.world.multiplyVector3(o),o.addSelf(t),o.y<0&&(o.y=0),this.position.lerpSelf(o,this.gamma),
 this.target.lerpSelf(t,this.gamma),this.lookAt(this.target)}
```
(@910744)
- A **leash**: a dummy point trails the ball at a fixed horizontal 2.1 WU. The camera sits behind the ball along the ball→dummy direction, at 5 WU distance and 35° elevation. The heading turns as the ball moves, like a chase camera without manual control. The offset is rotated by the tilt quaternion (`camera.world`). Camera y is clamped ≥ 0. Position and target lerp by 0.11 **per physics tick** (τ ≈ 0.14 s).
- `resetToStart(p, goal)` places the camera behind the respawn point, facing the goal.
- Map (`rotateAround`): height 50 WU, radius = (fit stage width in view) × 1.7, orbit speed 0.2 rad/s around the stage centre.
- Opening (`opening`, ~20 s): fit the whole page head-on, dolly in and out, swing to face start→goal, then settle behind the start.

## 7. Elevator (`game/object/elevator` @914574)

- An elevator is a **bridge record with `type: 1`**, not a separate data type.
- It has a lower and an upper platform, each `max(distance, 15)` px long by `width` wide. Rails are 0.5–0.6 WU above each platform. Pillars are drawn.
- It is **switch-triggered**, not periodic. Invisible sensor boxes sit at the ends. When the ball touches one, the ball's velocity is zeroed and its position is tweened vertically to the other level (+0.55 WU). The occupied platform moves with it, and the other one swaps via the midpoint.
  ```js
  u=1e3+(this.y1-this.y0)*150  // ms; y in WU → e.g. a 60 px (6 WU) rise takes 1.9 s
  ```
  (@921689). It has a **2 s cooldown** after arrival (`moving` flag) and uses cubicInOut easing.

## 8. Input mapping and tutorial

Keyboard (`app/keycontrol` @735633):
```js
case 32:this.world.jump();break;case 38:this.y-=this.maxAngle;break;case 40:this.y+=this.maxAngle;break;
case 37:this.x-=this.maxAngle;break;case 39:this.x+=this.maxAngle;break;case 77:this.world.setPause(!0)
```
- Arrow keys set the target tilt to ±25°. The actual tilt ramps towards it by `sensitivity` degrees per tick. The preset uses 2.7°/tick (162°/s, 25° in about 0.15 s), and the class default is 1.5.
- **Any arrow held = POWER on**: `enableOrientation()`. When all arrows are released, `disableOrientation()` runs after 100 ms.
- Space = jump. M = pause/map. Keys are ignored unless focus is on `<body>`.

Phone (`app/app` @1058416, via the shared-object sync over Socket.IO):
```js
case"orientation": if(!r.pcOnly) return s.world.orientation.setCurrent(t.alpha,t.beta,t.gamma);
case"power": return t ? s.world.enableOrientation() : s.world.disableOrientation();
case"jump": if(t) return s.world.jump();
```
The phone also mirrors `appState`/`worldState` transitions (e.g. MENU → pause), the search query, the search submit/select, and nickname entry. The PC pushes `position {x, y, direction}` at 10 Hz and `stageData`, score, balls and similar values to the phone. This suggests **the phone showed its own map and UI**. The mobile bundle was not recovered.

Tutorial steps (`game/world` + `gameinfo.showInst`):
1. Calibration ("match dots"). A zero-check starts with a **15 s timeout** (`orientationindicator.startZeroCheck`, @1008056). Success means the indicator is within 3 px of centre, i.e. the phone is at the neutral pose. The game plays "connected" and moves to step 2.
2. "This is your starting position" (3 s), then step 3.
3. "Hold POWER and tilt". The first POWER press starts the timer. Steps 4, 5 and 6 follow at 3 s intervals: JUMP, MENU/map, "head for the goal".
7. Timeout: the game switches to **keyboard mode** (`pcOnly = true`) and shows the arrow/space hint.

PC-only play skips straight to step 3 with keyboard texts. The "Too tilted!" warning shows when the indicator offset is above 45 (of 90), with a 500 ms hysteresis.

## 9. App flow (`app/app` @1049327)

App FSM: `LOADING → (TITLE | STAGE_PREVIEW | INPUT_NUMBER | NON_DISPLAY)`, then `TITLE → HOWTO (first time) → CONNECT → CONNECTED (4 s) → STAGE_SELECT → BUILDING → GAME → STAGE_RESULT → (next: STAGE_SELECT | finish: RANKING)`. It also has `GAME → over → RANKING`, `GAME → search → STAGE_SELECT`, `GAME → quit → TITLE`, `RANKING → newgame | title`, and `* → ERROR`.

- Deep link `/maze/?http://site`: builds that site first and shows STAGE_PREVIEW (an orbiting preview with Play/Visit). Play goes to CONNECT.
- `/maze/NNNNNN` path: a six-digit code in the URL auto-pairs. This is the Tab Sync trick. `/maze/connect` is the "enter the code shown on your phone" page (pairing started from the phone).
- Build (`C` class, @1050401): POST `/stage` (AES-wrapped payload), then wait for the socket event `stage was built`. **Timeout is 30 s**, after which it builds `ERROR_STAGE_URL`. A failed build also builds `ERROR_STAGE_URL`. The building screen shows for at least 5 s.
- Disconnect (`disconnect pair` or socket `disconnect`) goes to the ERROR page "PC and mobile phone disconnected. Reload browser and connect again." Its only action is **reload**. There is no reconnection.
- Stage select: Google Custom Search (`safe: high`), a "Practice site" (`http://www.google.com/`), and "Popular sites" from `/maze/get_recommends`. Each recommendation has a `level` shown as stars, i.e. a difficulty rating.

## 10. Server API seen from the client (`app/gateway` @69057)

`GET /maze/get_recommends`, `POST /get_token {secret}`, `POST /stage {data: AES(json{secret, token, url, callback_host, callback_port})}`, `POST /get_ranking_from_score {score}`, `POST /get_ranking` (**no stage parameter**, top 10), `POST /add_ranking {data: AES(json{secret, token, nickname, score, url: ""})}`. The socket events are `want secret`, `have secret`, `connection established`, `disconnect pair`, `stage was built`, `data update`/`data sync`, and `message`.

**The ranking is a single global board of session total scores**, not per-site. `add_ranking` sends `url: ""`. Nicknames are sanitised to `[a-z0-9_]`, and other characters become `-`. Skip records "NO_NAME" locally and submits nothing.

## 11. Renderer and audio (brief)

- Renderer: selective glow, rendering glow-only objects at ½, ¼ and ⅛ resolution with H+V blur, blended with the FXAA'd diffuse pass. Tile "curtain" transitions use a colour palette texture (tile = max(w,h)/20). Fog is `#F8F8F8` from 400 to 1000 WU. The cube-camera env map is 64 px and updated every 3rd frame (`D%3===0`, @1048940).
- Performance adjuster (@863421): uses a 400-sample average after 100 ignored ticks, evaluated after 200 samples or 20 s. It disables reflection below 45 fps, sets 0.7 render scale below 40, turns FXAA off below 40, and turns glow off below 30.
- Ocean/background: not water. It is a 3000 × 3000 WU faceted triangle plane (`COLOR_TRIANGLE` pastels, `COLOR_WIRE` line colours) at `groundY = −200` WU with dots, ripples, clouds and stars. The whole background rotates with the tilt.
- Colours: bridges `common.green`, elevators `common.red`, rails `common.yellow`, island sides `common.blue`, all with a white-line overlay.
- BGM sprites: opening, game, timeup (last 30 s), result, over. SE: small_item, rollover, click, jump, point, get_goal, goup, caution, connected, fall, firework, goal, hit_ground (volume ∝ vertical impact²), hit_guardrail (throttled to 500 ms), oneup, plus a rolling loop.
