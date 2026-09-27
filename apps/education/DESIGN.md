---
name: WWM Learning
description: A daylight extension of WWM for shared early-math exploration.
colors:
  ink: "#20262d"
  muted: "#4b555f"
  fog-white: "#f8f8f8"
  paper: "#ffffff"
  line: "#d6dce0"
  action-green: "#286c36"
  action-green-hover: "#1d5429"
  focus-blue: "#2d6fa3"
  secondary: "#e9edef"
  secondary-hover: "#dce3e7"
  soft-green: "#e2eddf"
  transparency-blue: "#e7eef5"
  choice-border: "#cbd8e2"
  retry-yellow: "#fff5d8"
  retry-border: "#856300"
  field-border: "#89959e"
  placeholder: "#5d6870"
  stop-background: "#e3ecf2"
  stop-ink: "#245779"
  stop-hover: "#edf2f5"
  shape-blue: "#317daf"
  shape-yellow: "#a47b00"
  shape-green: "#318545"
  shape-red: "#c74946"
  brand-blue: "#4f9fd6"
  brand-yellow: "#f2c230"
  brand-green: "#3f9a4c"
  pip-surface: "#e7eef5"
  pip-surface-hover: "#dce8f2"
  spoken-highlight: "#fbe39a"
  sky: "#f8f8f8"
  cloud: "#edf1f4"
  island-side: "#4f9fd6"
  island-edge: "#9fb3c2"
  gem: "#31a4ae"
  gem-edge: "#206a71"
  bridge: "#3f9a4c"
  glow: "#f2c230"
typography:
  display:
    fontFamily: '"Unbounded Variable", sans-serif'
    fontSize: "clamp(36px, 4.5vw, 64px)"
    fontWeight: 650
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  headline:
    fontFamily: '"Unbounded Variable", sans-serif'
    fontSize: "clamp(24px, 2.5vw, 34px)"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  activity-title:
    fontFamily: '"Unbounded Variable", sans-serif'
    fontSize: "clamp(28px, 3.7vw, 46px)"
    fontWeight: 650
    lineHeight: 1.24
    letterSpacing: "-0.025em"
  prompt:
    fontFamily: '"Unbounded Variable", sans-serif'
    fontSize: "clamp(26px, 2.8vw, 38px)"
    fontWeight: 650
    lineHeight: 1.22
  pip-start-label:
    fontFamily: '"Unbounded Variable", sans-serif'
    fontSize: "clamp(24px, 3vw, 34px)"
    fontWeight: 650
  body:
    fontFamily: '"Figtree Variable", sans-serif'
    fontSize: "18px"
    lineHeight: 1.55
  lead:
    fontFamily: '"Figtree Variable", sans-serif'
    fontSize: "21px"
    lineHeight: 1.55
  small:
    fontFamily: '"Figtree Variable", sans-serif'
    fontSize: "14px"
    lineHeight: 1.55
rounded:
  control: "8px"
  pip-card: "28px"
  circle: "50%"
spacing:
  tight: "8px"
  small: "12px"
  medium: "16px"
  control: "20px"
  section: "24px"
  mobile-grid: "32px"
  gutter: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action-green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.action-green-hover}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  textarea:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "14px"
    width: "100%"
  pip-start:
    backgroundColor: "{colors.pip-surface}"
    textColor: "{colors.ink}"
    rounded: "28px"
    padding: "28px 44px 26px"
  pip-replay:
    backgroundColor: "{colors.pip-surface}"
    rounded: "{rounded.circle}"
    size: "60px (52px mobile)"
  helper-button:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "60px (52px mobile)"
  next:
    backgroundColor: "{colors.action-green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "64px (56px mobile, full width)"
  scene-choice:
    backgroundColor: "transparent"
    rounded: "22px"
    minSize: "44px"
  status:
    backgroundColor: "{colors.soft-green}"
    padding: "14px 18px"
---

# Design System: WWM Learning

## Overview

**Creative North Star: "Shared geometric discoveries"**

This phrase describes the implemented direction, rather than a new brand identity. WWM Learning extends the existing game's fog-white setting, Figtree/Unbounded pairing, and recognizable blue, green, yellow, and red geometry into a daylight reading and activity surface. Source authority is `src/style.css` and `src/render.ts`; shared lineage is `../web/src/ui/game.css`.

The interface alternates between readable adult guidance and generous child-facing play. Lessons take place in the **Sky Islands**: Pip (the WWM ball with eyes) guides, gems sit on islands, and each solved round adds a plank to a bridge. All of these pictures come from the learning document's theme, drawn by the trusted renderer in `@wwm/learning` (`sceneSvg`, `spriteMarkup`); the app adds no image assets. Visible objectives and grown-up explanations accompany the same learning intent embedded as JSON. The working product name remains provisional.

**Key Characteristics:**
- Fog-white pages with flat, softly tinted sections.
- Geometric display type paired with clear, roomy body text.
- One voiced guide, Pip, and a scene where the counted gems are the highest-contrast things on screen.
- Persistent written feedback, with the spoken word highlighted.
- Readable learning intent beside optional parent controls.

## Colors

The palette combines WWM's geometric color roles with darker action and stimulus colors for this reading surface. Frontmatter holds the normative values; names below describe their application.

### Primary
- **Action Green:** primary links and buttons, successful-answer borders, and success feedback. Its deeper hover value marks interactive response.
- **Focus Blue:** keyboard outlines, directional notation, and hovered-choice borders.

### Secondary
- **Shape Blue, Yellow, Green, and Red:** literal activity objects. Shape Yellow is the darker stimulus yellow; Brand Yellow is reserved for the small wordmark triangle.
- **Brand Blue, Yellow, and Green:** the small circle, triangle, and square beside the WWM wordmark.

### Neutral
- **Fog White, Paper, and Ink:** page, activity/field surfaces, and primary text.
- **Muted and Line:** explanatory text and structural dividers.
- **Soft Green:** introduction panel, saved-state strip, and the end card’s offline-activity panel.
- **Transparency Blue:** the explanation section; the same value is Pip Surface behind Pip’s buttons. **Choice Border** outlines Pip’s buttons and the mute toggle.
- **Retry Yellow and Retry Border:** the muted state of the mute toggle. Another-attempt feedback in the scene uses a dashed Glow halo plus the feedback sentence.
- **Secondary:** quiet actions, with a darker hover surface. Fields and stop markers use the dedicated frontmatter border, placeholder, background, and ink tokens.

### Sky Islands (scene)
The scene colours are the theme palette in the learning document (`packages/learning/src/theme.ts`), sourced from the game: sky, cloud, island side and edge, gem and gem edge, bridge, glow. They are listed in the frontmatter for reference only; change them in the theme, never in CSS.
- **Clutter rule:** the counted gems, with their dark Gem Edge outline, are the highest-contrast objects. Sky, clouds, the goal island and the gate stay faint and never move while the child is deciding.
- **Glow** (the brand yellow) marks match lines, lit and leftover gems, and choice halos. A dashed halo means "try again"; a solid halo with a green check means solved.
- **Pip surface** is the soft blue behind Pip's buttons. **Spoken highlight** is the pale yellow behind the word Pip is saying.

## Typography

**Display Font:** Unbounded Variable, with sans-serif fallback.
**Body Font:** Figtree Variable, with sans-serif fallback.

Unbounded gives headings and the wordmark their geometric silhouette; Figtree carries instructions, controls, explanations, and learner feedback. No separate mono font is established, including for JSON input.

### Hierarchy
- **Display:** the path title; balanced wrapping with a narrow measure. Custom titles and their lead text use `overflow-wrap: anywhere`.
- **Headline:** section headings. Grown-up notes locally switch their heading to Figtree at 24px.
- **Prompt:** the round's question, next to Pip's replay button, in Unbounded. It is 19px on phones so the question, scene and Next fit one screen. Each word is its own span so the spoken word can be highlighted.
- **Lesson title:** the page's h1, set small (17px, 15px on phones) in the lesson bar. The question carries the visual weight.
- **Body:** prose has a maximum measure of 68ch. Mobile body text becomes 17px.
- **Lead:** introductory adult text; mobile size becomes 19px.

- **Small:** supporting context and source/status caveats.

## Layout

The header is capped at 1320px with 28px by 40px padding. Main content and footer are capped at 1240px. At widths up to 1320px, their side margins are 40px. The learning path uses a 0.95fr/1.05fr grid, initially with a 64px gap, reduced to 40px at that breakpoint. Its introduction is sticky 24px from the top. The parent workspace uses 0.8fr/1.2fr columns with an 80px gap.

At 760px and below, parent and path layouts become single columns with 32px gaps, the introduction becomes static, and page gutters become 20px. The header wraps. The path title becomes 40px with a 12ch measure; activity titles become 29px. Custom text wraps rather than forcing the introduction beyond its column.

Lessons use a 1040px maximum-width canvas, in this order: lesson bar (back link, title, mute), then the prompt row, the scene, the feedback, and the controls. Next sits directly under the feedback.
- **Scene sizing:** the scene keeps its viewBox aspect ratio. Its width is sized so the prompt, scene, feedback and Next fit the viewport; the script measures the space around the scene, because prompts wrap. There is a floor so gems never get too small: 600px for wide scenes, 280px for tall ones.
- **Orientation:** at 640px and below the scene switches to the tall orientation (islands stacked). The site navigation hides, the back link becomes an arrow, the helpers share one row, and Next spans the full width.
- **Checked:** at 390×844, Next after a correct answer is inside the first viewport without scrolling.
- **Feedback** reserves about two lines.
- **Grown-up material** sits below the activity canvas: the version note, the notes disclosure, and navigation. Navigation stacks on mobile.

## Elevation & Depth

There are no shadows in the education stylesheet. Depth comes from white activity canvases, tinted section backgrounds, and thin dividers. This surface does not inherit the game shell's drop shadows or cut-corner plates. Button background transitions last 150ms with standard ease; reduced-motion preference removes transitions.

## Shapes

Large section surfaces remain rectangular. Controls use the control radius; the scene draws its own rounded islands, cards and stones. Circular stop numbers echo Pip. Triangles are CSS polygons (`50% 0, 100% 100%, 0 100%`); squares retain straight edges.

Activity shapes and gems are drawn inside the scene SVG and scale with it. Brand shapes are 12px. Pip's buttons are round (replay) or 28px-radius cards (start). Scene choices follow the drawn island, card, or stone.

## Components

### Buttons

Confident, readable actions with a minimum height of 48px, semibold weight, and 18px internal content gap. Primary actions use Action Green and Paper; secondary actions use Secondary and Ink. Hover changes the background. Disabled buttons have 0.55 opacity and a default cursor. Keyboard focus is a 3px Focus Blue outline offset by 5px; no custom active state is established.

### Inputs / Fields

Textareas use a white surface, a 1px Field Border stroke, the control radius, and vertical resizing. Labels sit above helpful text and the field. Textareas inherit body typography, including the AI prompt and JSON response fields. Keyboard focus uses the common outline.

### Navigation

The header uses text links beside the wordmark, with semibold 16px text (14px on mobile). The learning path is a divided list, with numbered circular markers, a title, readable objective, and a text arrow. Hover gives a stop a quiet blue-gray surface. Activity navigation uses the primary and secondary action treatments.

Arrows (`↗`, `←`, `→`) are text navigation notation in the current implementation, not a canonized icon system. The brand's geometry and activity stimuli likewise do not establish a general-purpose icon library.

### Pip buttons

- **Start:** a large Pip Surface card with Pip (132px) and "Tap Pip to start" in Unbounded. Pip bobs gently until tapped; this stops with reduced motion. The tap unlocks audio and starts the lesson.
- **Replay:** a 60px round Pip button (52px on mobile) beside the prompt, labelled "Hear it again". It re-says the current prompt (or the bonus/finale line). It matches the height of the Help me and Match them up buttons.
- **Mute:** a 48px round icon toggle in the lesson bar (`aria-pressed`). Muted uses Retry Yellow. It is remembered in `localStorage` (`wwm-learning.muted`). When muted, the cues and highlights still run.

### Scene and answer controls

The scene is one decorative SVG from `sceneSvg`, in two islands (compare/difference) or choice cards (choose). The real answer controls are transparent `<button>`s over each choice box:
- They are positioned in percent of the viewBox, so they track the drawing at any size.
- They are at least 44px, with a 4px Focus Blue outline offset 6px.
- On hover-capable devices they show a faint blue tint.
- Accessible names start with the visible label ("Island A: 3 gems, spread out").
- They are disabled until JavaScript runs.
- After success they stay focusable but `aria-disabled`, and taps are ignored: success is locked.

State is shown on the drawing, never by colour alone. The feedback sentence carries the meaning:
- A dashed Glow halo marks another try.
- A solid halo plus a green check marks the solved choice.
- Both islands pulse once for a nudge.
- A glowing halo marks the worked example.
- Lit gems count along with the voice; match lines draw one per spoken "match"; leftover gems ring and bob.
With reduced motion, all of this still appears without animation.

### Stones

"Same" and "how many more" numbers are white stones with an Island Side border, drawn between the islands. They are answer choices like the islands.

### The bridge

It runs along the bottom of every scene: the home island, one dashed plank slot per required round, and the goal island with its gate.
- A correct answer drops in a green plank. Pip rolls onto it, then hops.
- Conditional follow-ups and bonus rounds add no plank.
- The end card shows the finished bridge (the bottom strip of a wide scene) with Pip at the gate.

### Lesson controls

- Help me and Match them up are secondary buttons. Match them up appears only on island rounds.
- After success they give way to a prominent green Next (64px; full width on phones).
- The bonus offer shows "Bonus round!", a dimmed preview of the bonus islands, and Play the bonus round / Skip.
- The end card shows "You built the whole bridge!", Pip's finale line, Next activity, Play again, and the offline activity on a Soft Green panel for grown-ups.

### Answering: callouts, key badges and nudges (Phase 22)

- **Callout:** as Pip names each choice ("Island A… or island B?"), that choice gets a solid Focus halo and a small pulse, and its key badge grows, for about 600 ms.
- **Key badges:** these are small Ink squares with a Paper letter at each choice's top-left corner. The scene draws them, and they show only in rounds that invite letter or number keys.
  - A hint line under the question repeats them as `<kbd>` chips in the same Ink style ("Press A or B", "Type the number: 2, 3 or 4"). It is 17px, or 15px on phones.
  - Arrows-only rounds show "Use ← →, then Enter". The arrow cursor is the scene's dotted Focus halo.
  - Badges and the hint disappear once the round is solved.
- **Nudge:** a tap in a key round doesn't answer; it gets a nudge instead. The hint line takes the Spoken highlight background, the badges grow with a Glow ring, and the feedback says "Try pressing the letter!" before the callout. The third tap is accepted. With reduced motion, the highlight and the ring still show, without movement.

### Game settings (parent area)

A second parent-workspace section under the personalization controls. It has the same 0.8fr/1.2fr grid, and its introduction is sticky on desktop.
- **Status strip:** a Soft Green saved-state strip.
- **Tap only:** a Transparency Blue panel with the "Answer by tapping only" switch. The switch is a 52×30 track, Action Green when on, with the real checkbox covering it. A one-sentence explanation follows.
- **Levels:** one disclosure per lesson, with a stop-number circle, the title, and the current level in Stop Ink ("Gated (recommended by the lesson)"). Opening it shows radio cards: the level label, the recommended mark, and the generated description in Muted 15px. The checked card is Soft Green.
- **Actions:** "Use the lesson’s recommendation for every lesson", and "Reset game settings" (shown only when something is saved).

### Containers and Disclosure

The introduction, transparency section, saved-state strip, and activity canvas are flat surfaces rather than elevated cards. Dividers organize ordered stops, draft changes, and parent disclosure sections. Native details/summary provides optional adult explanation and AI import content, with a minimum 44px summary height.

The home path introduction shows a small Sky Islands picture composed from theme sprites, and a "Meet Pip" line. Each stop in the path shows its length ("5-round challenge with the match tool") in Stop Ink.

The portable HTML download intentionally uses its own compact system-font reading layout, with the theme's palette and each round's scene inline. It is not the source for the interactive site's visual system.

## Do's and Don'ts

### Do:
- **Do** retain the Figtree/Unbounded pairing and fog-white ground when extending this surface.
- **Do** make mathematical objects literal and keep visible explanations alongside their machine-readable intent.
- **Do** draw lesson pictures only from the document theme through the shared renderer, so the page and the game show the same thing.
- **Do** keep counted gems the highest-contrast element; keep scenery faint and still.
- **Do** preserve keyboard outlines, textual answer feedback, reduced-motion behavior, and wrapping for custom titles and introductions.
- **Do** preserve the distinction between stimulus yellow and the brighter wordmark yellow.

### Don't:
- **Don't** infer mastery from a success color or turn freely selectable activities into locked progress states.
- **Don't** treat text arrows as an established icon family.
- **Don't** import the game shell's shadows and chamfered plates into this flat education surface as if they were already implemented.
- **Don't** replace readable objectives with visual-only or JSON-only explanations.
