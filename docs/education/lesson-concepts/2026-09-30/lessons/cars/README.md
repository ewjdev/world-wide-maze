# Pip’s Rolling Garage

Review concept for ages 4–6. **One learning goal:** choose wheels with a round outer edge for a smoother ride on a smooth ramp, even when size, decoration or vehicle changes. Estimated guided play: 2–4 minutes; the fifth round is optional.

The story gives the choice a purpose: Pip needs a smooth parcel delivery. A short observation of wheel movement should precede the first prediction. The child hears the question, taps a whole wheel card, sees the chosen parts attached, and watches what happens. These are proposed interactions; this pack contains static visuals and exact spoken content for adult review.

## Visual assets

- [Concept illustration](concept.png): generated with the built-in image tool; [complete prompt](image-prompt.txt). Inspected for Pip, a gentle ramp, a wheeled delivery toy, a garage, distinct round/square spares, and absence of text. The image is story art, not an exact mechanical model.
- [Round 1](round-1.svg), [Round 2](round-2.svg), [Round 3](round-3.svg), [Round 4](round-4.svg), [Round 5](round-5.svg): deterministic 800×440 diagrams. Left/right card order matches the choices below; no answer markers or hint traces appear in the unassisted scenes.
- [lesson.json](lesson.json): exact content contract, answer identifiers, hint progression, illustration alt text and future visual-hint suggestions.

## Teaching sequence

**Introduction:** “My parcel needs a ride! Let’s choose some wheels for our smooth ramp.”

### 1. Repair the car
**Spoken question:** “Which wheels would give my car a smoother ride on this smooth ramp?”

**Choices, left to right:** Square wheels; Round wheels. **Accepted:** Round wheels. One tap is enough, including round three.

**Feedback:** “These wheels have a round edge. They can turn smoothly on our smooth ramp.”

**Hints:** “Look at the outside edge of each wheel.” → “Let’s turn one wheel from each set slowly on our smooth ramp.” → “The square’s corners lift the car up and down. The round edge gives the car a smoother ride.”

**Demonstration:** After requesting a hint, show slow rotations over the same straight surface. Track each center with an identical small marker: the square center rises and falls; the circle center stays level. Do not pre-mark the correct card.

**Purpose:** Connects round wheel geometry to a concrete job, rather than asking only for a shape name.

### 2. Look past the picture
**Spoken question:** “Which wheels have a round outside edge, even with a star picture inside?”

**Choices, left to right:** Wheels with star pictures; Plain square wheels. **Accepted:** Wheels with star pictures. One tap is enough, including round three.

**Feedback:** “The star is a picture inside. The outside edge is still round, so these wheels can turn smoothly here.”

**Hints:** “The picture is inside. Follow the outside edge.” → “Let’s trace around each wheel, without tracing its picture.” → “The star picture does not change the wheel’s round outside edge.”

**Demonstration:** Trace only the wheel’s outside edge, then hide and reveal the star decoration while the circular silhouette stays unchanged.

**Purpose:** Changes appearance while preserving the useful property. Avoids teaching children to choose only plain or familiar wheels.

### 3. Small and big
**Spoken question:** “Which set has wheels with no corners? More than one set can work.”

**Choices, left to right:** Small round wheels; Square wheels; Big round wheels. **Accepted:** Small round wheels or Big round wheels. One tap is enough, including round three.

**Feedback:** “Yes, those wheels have a round edge. Small and big wheels can both be round.”

**Hints:** “Look for an outside edge with no corners.” → “Let’s trace the small wheels and then the big wheels.” → “Both round sets have no corners. You can choose either one.”

**Demonstration:** On request, trace both circular silhouettes with the same line style. Accept either single choice and allow the other round set to be tried after the answer.

**Purpose:** Checks whether size distracts from roundness. Does not compare speeds, distances, or claim all sizes work equally well on every car.

### 4. A new parcel wagon
**Spoken question:** “This wagon needs a smoother ride on the same ramp. Which wheels would you choose?”

**Choices, left to right:** Square wheels; Round wheels. **Accepted:** Round wheels. One tap is enough, including round three.

**Feedback:** “The wagon can use round wheels too. Their round edge helps give a smoother ride on our smooth ramp.”

**Hints:** “The vehicle changed. Look at the wheels’ outside edges.” → “Let’s turn the wheels slowly under the wagon, just as we did under the car.” → “Round wheels have no corners lifting this wagon up and down on our smooth ramp.”

**Demonstration:** Repeat the slow wheel comparison with the wagon body and the same surface, release position, parcel, and scale. Avoid winner animations based on speed or distance.

**Purpose:** Transfers the idea to a different vehicle while holding the ramp and parcel task constant.

### 5. Closer look — optional stretch
**Spoken question:** “These wheels look almost alike. Which set has a round edge with no corners?”

**Choices, left to right:** Round-edge wheels; Many-cornered wheels. **Accepted:** Round-edge wheels. One tap is enough, including round three.

**Feedback:** “This edge curves all the way around. The other wheels have little corners. The round edge gives a smoother ride on our smooth ramp.”

**Hints:** “Look slowly around the outside edge.” → “Let’s trace each edge. One keeps curving; one has short straight pieces.” → “Choose the edge that curves all the way around without corners.”

**Demonstration:** Zoom or trace equal-size outer edges. Then demonstrate their slow rotations on the same straight surface with an identical center marker. Keep the many-sided wheel's rise-and-fall subtle and geometrically honest.

**Purpose:** An optional close comparison reveals whether the child recognizes continuous roundness rather than any roughly wheel-like silhouette.

## Rationale and limits

The useful property is the outer edge, rather than color, picture, size or vehicle familiarity. Round one gives an easy causal choice; round two changes decoration; round three reveals whether the child mistakes size for roundness; round four transfers to a wagon; round five presents a closer silhouette comparison. A ready child can trace or describe a choice; a beginner can watch the wheel comparison again.

Do not describe square wheels as unable to move. On a straight smooth surface, their center rises and falls as they turn; a round wheel’s center stays at a constant distance from that surface. Specially shaped tracks can make square wheels roll smoothly. The lesson deliberately refers to **our smooth ramp**.

Round three accepts either round set because it asks about shape. It does not claim equal speed, equal distance, interchangeable fit, or that bigger wheels are always better. Before any future motion simulation, establish matched body, parcel, axle friction, wheel material, ramp and release conditions. The SVG missing-wheel cars are parts-selection schematics. Physical fit and ground clearance still need design.

**Finale:** The chosen round wheels are attached to the toy car. Pip releases it from the same marked spot on the gentle ramp, and the parcel reaches the garage. The child can replay the wheel turn or try another set without a score penalty.

**With a grown-up:** With a grown-up, slowly turn a large round cardboard disk and a same-width square cardboard piece along a smooth tabletop. Keep fingers at the center and notice how that center moves. Then release an existing toy car from the same low book-ramp spot twice. Observe rather than race; the adult cuts the cardboard and holds the ramp.

## Three decisions to review

1. Does the smoother-ride goal feel more useful and understandable than a fastest-car question?
2. Should round three accept either round wheel set, or should the first version use only two choices for easier visual scanning?
3. Is the circle-versus-eight-sided stretch worth keeping as an optional fifth round, or should that round instead invite a free wheel experiment?

## Sources checked

- [NASA JPL Education — Make a Cardboard Rover](https://www.jpl.nasa.gov/edu/resources/lesson-plan/make-a-cardboard-rover/): wheel-shape testing, consistent trial conditions, wheel size and friction effects. The original resource targets grades 6–12; it supports mechanics and test design, not preschool suitability.
- [Exploratorium — Square Wheel](https://annex.exploratorium.edu/texnet/exhibits/motion/square_wheels/media/square_gb.pdf): center-height explanation and special-track exception.

This is an adult review pack. No child testing, game integration, paid voice generation, or runtime changes have occurred.
