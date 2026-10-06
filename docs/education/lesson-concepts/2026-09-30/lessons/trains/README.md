# Track Rescue — Trains

Independent concept pack for adult review, ages 4–6. Target duration: 2–4 minutes, unvalidated.

## Teaching rationale

Choose or identify connected track by checking that the rails join from the train to the station. The visible cause is continuous track, so feedback should follow the rail rather than celebrate an arbitrary choice. The child predicts and checks rail connections; this is not a navigation maze. Only one idea is being taught: the railway must stay joined all the way to the destination.

**Child takeaway:** The train needs joined track all the way.

**Story:** Pip has a package on a toy train, but its railway has a missing piece. Help repair the track and choose a route that reaches the station.

**Pip introduction:** “I'm Pip! My toy train needs to get to the station. Can you help me join its track?”

## Visuals

- `concept.png`: built-in ImageGen story illustration, visually inspected. It contains the correct Pip identity, a waiting toy locomotive/carriage, a visible track gap, two loose track shapes, and a station; no text or UI.
- `image-prompt.txt`: complete generation prompt.
- `round-1.svg` through `round-5.svg`: exact 800×440 instructional diagrams with distinct title/description IDs and unassisted scenes, rendered and visually inspected with macOS Quick Look. The SVGs are the authority for rail connectivity.

## Five rounds

### 1. A straight repair

**Spoken question:** “Which piece joins the track: the straight piece or the curved piece?”

**Choices:** a — Straight piece; b — Curved piece. **Answer:** a.

**Scene:** A train waits before a horizontal gap in the rails. A station is at the far end. A straight piece and a curved piece are shown in separate cards below.

**Feedback:** “The straight piece joins both ends. Now there is track all the way to the station.”

**Hints, in order:**

1. Look at the two ends of the gap.

2. Imagine sliding each piece between the ends. Does it touch both?

3. Both ends point across. The straight piece connects them.


**Visual explanation:** After a requested hint, move a ghost copy of each piece into the gap. Only the straight piece aligns both rail ends. Then trace the completed centerline from train to station.

**What this reveals:** An easy start checks whether the child can match a single piece to two visible rail ends.

### 2. A bend to the station

**Spoken question:** “This track needs to turn. Which piece joins the ends?”

**Choices:** a — Straight piece; b — Curved piece. **Answer:** b.

**Scene:** The train track runs across and ends before a station track pointing upward. A straight piece is on the left card and a curved piece on the right card.

**Feedback:** “The curved piece turns the track and joins both ends. The train can follow the bend to the station.”

**Hints, in order:**

1. The train needs to go across, then up.

2. Follow the direction of each rail end with your finger.

3. The curve starts across and turns upward. Its two ends join the waiting rails.


**Visual explanation:** After a requested hint, place a full-size curved ghost piece with centerline (450,205) to (550,105). Trace across then upward. Show the straight piece failing to meet the upward end.

**What this reveals:** A changed example checks that the child attends to the direction of both ends rather than always choosing straight.

### 3. Connected beats short

**Spoken question:** “Which route can take the train all the way to the station: the upper route or the lower route?”

**Choices:** a — Upper route; b — Lower route. **Answer:** b.

**Scene:** Two separate panels show a train and station. The upper route is a short straight route. The lower route is longer and bends down and back up.

**Feedback:** “The lower route is joined all the way. The upper route has a gap, so its train must stop there.”

**Hints, in order:**

1. Check each route all the way from its train.

2. Trace the upper route, then the lower route. Does your finger meet a gap?

3. The short route is broken. The longer route stays joined, so that train reaches its station.


**Visual explanation:** After a requested hint, animate the same train at the same speed along each route. Stop the upper train before x=340; let the lower train follow the uninterrupted centerline to x=700. Do not show preselected colors.

**What this reveals:** A misconception check reveals whether the child chooses a shorter or straighter route despite a visible break.

### 4. Find the hidden stop

**Spoken question:** “Where is the break: the left circle or the right circle?”

**Choices:** a — Left circle; b — Right circle. **Answer:** a.

**Scene:** Two equal dashed circles mark places along a single rail route between a train and station. One circle is nearer the train; the other is nearer the station.

**Feedback:** “The left circle has the gap. A piece of track needs to go there before the train can reach the station.”

**Hints, in order:**

1. Start at the train and look along the rails.

2. Stop tracing when the rails stop.

3. The rails stop inside the left circle. The right circle already has joined rails.


**Visual explanation:** After a requested hint, use a slow tracing dot from (80,190) to (300,190), ending before the gap. Show an enlarged view of each circle using the same scale.

**What this reveals:** Transfer: the child diagnoses a new route instead of choosing a supplied repair shape. Spoken left/right may be supported with gestures.

### 5. Two-piece rescue · optional stretch

**Spoken question:** “Which pair joins this gap: two curves, two straights, or a straight and a curve?”

**Choices:** a — Two curves; b — Two straights; c — Straight + curve. **Answer:** c.

**Scene:** A train rail points across toward a separated station rail pointing downward. Three cards show two curved pieces, two straight pieces, and a straight piece paired with a curved piece.

**Feedback:** “The straight piece reaches across. The curved piece turns down and joins the station track. Together they fill the gap.”

**Hints, in order:**

1. The train needs to go across, then turn down.

2. Try a pair in your mind. Is there a piece to reach across and one to make the turn?

3. Put the straight piece first. Then the curve turns down to meet the station track.


**Visual explanation:** After a requested hint, demonstrate the straight centerline (300,145) to (420,145), then a radius-100 quarter curve centered (420,245), from (420,145) to (520,245). Both joins must be tangent-continuous.

**What this reveals:** An optional stretch combines two previously shown shapes in one prediction. Skip freely when the child is ready to finish.

## Precise geometry and answer checks

- Round 1: gap centerline endpoints `(320,180)` and `(440,180)`. A 120-pixel straight joins both; a quarter curve does not.
- Round 2: gap endpoints `(450,205)` and `(550,105)`. A radius-100 quarter circle centered `(450,105)`, angle 90° → 0°, is tangent to the horizontal entering rail and vertical exiting rail.
- Round 3: upper straight has a 60-pixel gap from `(340,125)` to `(400,125)`. Lower path has exact shared endpoints `(220,290)`, `(260,330)`, `(300,370)`, `(550,370)`, `(590,330)`, `(630,290)` and then `(700,290)`, with four radius-40 tangent-continuous quarter arcs. No switches or intersections.
- Round 4: only the left inspection circle contains the gap `(300,190)` → `(370,190)`; the right circle at `(565,190)` contains continuous rails.
- Round 5: missing straight `(300,145)` → `(420,145)` plus a radius-100 curve centered `(420,245)`, angle −90° → 0°, ends exactly at `(520,245)` and turns downward toward the station. Supplied piece dimensions are fixed; no arbitrary bending or resizing.

## Support and misconception

**Entry:** Offer two large pictured choices, speak each label, and let the child point. A grown-up can trace each route without requiring the child to know left and right.

**Stretch:** Use the optional fifth round, then invite the child to explain or show how the straight and curved pieces connect.

**Misconception:** A train can reach the station just because the route is shorter, points toward it, or looks mostly complete. The route must remain connected.

## Finale and offline activity

The repaired toy train follows the rails into the station. Pip unloads the package and gives a happy wave; no score or speed bonus is needed.

With a grown-up, lay strips of paper on the floor as a toy railway. Leave one visible gap. Ask the child to join it, then move a toy along the whole path. Make a bend and try again. A finger can stand in for a train.

## Three decisions for review

1. Are single-piece repairs followed by route comparison the right difficulty progression, or should the broken-route comparison come earlier?

2. Should round four use two spoken position choices, or should a future version let the child tap the break anywhere along the track?

3. Does the two-piece fifth round feel like a useful optional stretch, or should the finale arrive after four rounds for most children?


## Limits and next visual needs

- Review-only content and visuals; no game integration, voice generation, or child-testing claim. The 2–4 minute duration is a design target.

- The generated concept image introduces the story. The exact top-down SVG rail geometry governs the questions and answers.

- The lesson uses toy railway continuity and spatial reasoning; it does not teach how real locomotives are powered, railway switching, signaling, or safety.

- Choice-card pieces are scaled display symbols. A future placement animation must replace them with the exact full-size repair geometry specified in each visual hint.

- All rails in round three are separate routes with no intersections; the lower route is continuously joined. Round four circles have equal visual styling.

- The final stretch assumes two standard pieces: a 120-pixel straight and a radius-100 quarter curve. No hidden rotation task or multi-select is required.

- Real toys may have connector shapes and permitted orientations that differ; playtesting should check whether children interpret the overhead train and station silhouettes.


## Checked source

[NAEYC — Developing Your Preschooler’s Spatial Thinking](https://www.naeyc.org/node/3881), checked September 30, 2026. Supports the use of diagram/path/puzzle activities and spoken spatial words, not claims that this review concept is validated.
