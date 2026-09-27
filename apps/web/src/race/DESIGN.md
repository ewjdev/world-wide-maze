# Race surface

Mode: Experience during play; Operate for course selection and results.

This surface extends WWM's existing light fog world, green connectors, blue islands, Figtree UI and Unbounded headings. Original and Education keep their existing shell and rules. It adds no separate brand system.

The entry pairs a named course list with a map generated from the actual stage geometry. Gameplay lets the course occupy the viewport: time and completed gates sit at the top, controls at the bottom, and translucent personal shadows stay non-colliding. A checkered arch and floor stripe identify the exact Race finish plane. The legacy goal decoration is hidden only within a Race scene.

Selection, ready, countdown, racing, paused/practice, results, history, disabled-mode and loading/error states are implemented. Keyboard focus is visible; controls retain text names; the secondary ghost is wireframe as well as a different color. Reduced motion uses the existing engine preference. Small viewports stack the catalog and constrain the ready/results sheet with internal scrolling.

Desktop and 390 × 844 browser screenshots were reviewed, then one corrective pass fixed finish clarity and personal-best comparison. A mechanical detector found no reported anti-patterns in the new page, navigation or CSS. Course construction/physics assertions are separate from human judgments of flow. Physical phone play and a repeated-attempt human flow session remain acceptance tasks.

## Island Leap experiment

The fourth course adds an amber launch-lip stripe, landing rings and dashed airborne routes in the actual-geometry preview. Its gameplay HUD adds one compact Turbo control with a charge meter, keyboard T label and brief launch/landing feedback. Ready instructions explain earning charge and automatic ramps; results count launches and clean landings. Baseline courses retain their previous screens.

The phone keeps POWER and JUMP, with a separate full-width Turbo control above them. A compact tilt indicator and spacing preserve touch access on shorter screens. Desktop airborne, finish, mobile ready and phone captures were inspected, including confirmation that a held POWER control still transmits its binary input while the stunt HUD is present. Independent review found no material visual defects; physical-phone feel remains a hands-on gate.
