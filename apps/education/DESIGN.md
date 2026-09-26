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
  choice-blue: "#f0f6fb"
  choice-blue-hover: "#e2eef7"
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
  body:
    fontFamily: '"Figtree Variable", sans-serif'
    fontSize: "18px"
    lineHeight: 1.55
  lead:
    fontFamily: '"Figtree Variable", sans-serif'
    fontSize: "21px"
    lineHeight: 1.55
  choice-label:
    fontFamily: '"Figtree Variable", sans-serif'
    fontSize: "17px"
    fontWeight: 650
  small:
    fontFamily: '"Figtree Variable", sans-serif'
    fontSize: "14px"
    lineHeight: 1.55
rounded:
  control: "8px"
  choice: "14px"
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
  choice:
    backgroundColor: "{colors.choice-blue}"
    textColor: "{colors.ink}"
    rounded: "{rounded.choice}"
    padding: "28px 18px 18px"
    width: "250px"
  choice-correct:
    backgroundColor: "{colors.soft-green}"
  choice-retry:
    backgroundColor: "{colors.retry-yellow}"
  status:
    backgroundColor: "{colors.soft-green}"
    padding: "14px 18px"
---

# Design System: WWM Learning

## Overview

**Creative North Star: "Shared geometric discoveries"**

This phrase describes the implemented direction, rather than a new brand identity. WWM Learning extends the existing game's fog-white setting, Figtree/Unbounded pairing, and recognizable blue, green, yellow, and red geometry into a daylight reading and activity surface. Source authority is `src/style.css` and `src/render.ts`; shared lineage is `../web/src/ui/game.css`.

The interface alternates between readable adult guidance and generous child-facing choices. Shapes are literal mathematical stimuli, built with CSS; imagery is not required to communicate them. Visible objectives and grown-up explanations accompany the same learning intent embedded as JSON. The working product name remains provisional.

**Key Characteristics:**
- Fog-white pages with flat, softly tinted sections.
- Geometric display type paired with clear, roomy body text.
- Large shape choices with persistent verbal feedback.
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
- **Soft Green:** introduction panel, saved-state strip, and correct choices.
- **Transparency Blue:** the explanation section; **Choice Blue** and its hover shade distinguish selectable activity groups.
- **Retry Yellow and Retry Border:** another-attempt feedback on a choice. The visible feedback sentence carries meaning alongside color.
- **Secondary:** quiet actions, with a darker hover surface. Fields and stop markers use the dedicated frontmatter border, placeholder, background, and ink tokens.

## Typography

**Display Font:** Unbounded Variable, with sans-serif fallback.
**Body Font:** Figtree Variable, with sans-serif fallback.

Unbounded gives headings and the wordmark their geometric silhouette; Figtree carries instructions, controls, explanations, and learner feedback. No separate mono font is established, including for JSON input.

### Hierarchy
- **Display:** the path title; balanced wrapping with a narrow measure. Custom titles and their lead text use `overflow-wrap: anywhere`.
- **Headline:** section headings. Grown-up notes locally switch their heading to Figtree at 24px.
- **Activity title:** centered questions with a maximum measure of 22ch.
- **Body:** prose has a maximum measure of 68ch. Mobile body text becomes 17px.
- **Lead:** introductory adult text; mobile size becomes 19px.
- **Choice label:** semibold captions beneath stimuli; mobile size becomes 15px.
- **Small:** supporting context and source/status caveats.

## Layout

The header is capped at 1320px with 28px by 40px padding. Main content and footer are capped at 1240px. At widths up to 1320px, their side margins are 40px. The learning path uses a 0.95fr/1.05fr grid, initially with a 64px gap, reduced to 40px at that breakpoint. Its introduction is sticky 24px from the top. The parent workspace uses 0.8fr/1.2fr columns with an 80px gap.

At 760px and below, parent and path layouts become single columns with 32px gaps, the introduction becomes static, and page gutters become 20px. The header wraps. The path title becomes 40px with a 12ch measure; activity titles become 29px. Custom text wraps rather than forcing the introduction beyond its column.

Lessons use a 1000px maximum-width canvas. Choices are centered and 250px wide with a 206px minimum height; mobile choices wrap at half the row width minus 6px, with a 174px minimum height. Lesson navigation becomes a reversed column on mobile, placing the onward action above the return action. Feedback reserves a 60px minimum height.

## Elevation & Depth

There are no shadows in the education stylesheet. Depth comes from white activity canvases, tinted section backgrounds, and thin dividers. This surface does not inherit the game shell's drop shadows or cut-corner plates. Button background transitions last 150ms with standard ease; reduced-motion preference removes transitions.

## Shapes

Large section surfaces remain rectangular. Controls use the control radius; answer choices use the larger choice radius. Circular stop numbers echo circular stimuli. Triangles are CSS polygons (`50% 0, 100% 100%, 0 100%`); squares retain straight edges.

Activity shapes are 42px squares before circle rounding or triangle clipping. Mobile choice and stimulus shapes are 30px. The introduction's display shapes scale from 48px to 88px and become 64px on mobile. Brand shapes are 12px. Preserve these distinct contexts rather than applying one shape size everywhere.

## Components

### Buttons

Confident, readable actions with a minimum height of 48px, semibold weight, and 18px internal content gap. Primary actions use Action Green and Paper; secondary actions use Secondary and Ink. Hover changes the background. Disabled buttons have 0.55 opacity and a default cursor. Keyboard focus is a 3px Focus Blue outline offset by 5px; no custom active state is established.

### Inputs / Fields

Textareas use a white surface, a 1px Field Border stroke, the control radius, and vertical resizing. Labels sit above helpful text and the field. Textareas inherit body typography, including the AI prompt and JSON response fields. Keyboard focus uses the common outline.

### Navigation

The header uses text links beside the wordmark, with semibold 16px text (14px on mobile). The learning path is a divided list, with numbered circular markers, a title, readable objective, and a text arrow. Hover gives a stop a quiet blue-gray surface. Activity navigation uses the primary and secondary action treatments.

Arrows (`↗`, `←`, `→`) are text navigation notation in the current implementation, not a canonized icon system. The brand's geometry and activity stimuli likewise do not establish a general-purpose icon library.

### Answer Choices

Large rounded buttons group literal shapes above a short caption. Their 2px border changes with hover, correct, and retry states. Correct uses Soft Green with Action Green borders; retry uses Retry Yellow with Retry Border. Meaning also appears in the live feedback text. Counting and comparison display neutral group names; accessible labels describe each option.

### Containers and Disclosure

The introduction, transparency section, saved-state strip, and activity canvas are flat surfaces rather than elevated cards. Dividers organize ordered stops, draft changes, and parent disclosure sections. Native details/summary provides optional adult explanation and AI import content, with a minimum 44px summary height.

The portable HTML download intentionally uses its own compact system-font reading layout. It is not the source for the interactive site's visual system.

## Do's and Don'ts

### Do:
- **Do** retain the Figtree/Unbounded pairing and fog-white ground when extending this surface.
- **Do** make mathematical objects literal and keep visible explanations alongside their machine-readable intent.
- **Do** preserve keyboard outlines, textual answer feedback, reduced-motion behavior, and wrapping for custom titles and introductions.
- **Do** preserve the distinction between stimulus yellow and the brighter wordmark yellow.

### Don't:
- **Don't** infer mastery from a success color or turn freely selectable activities into locked progress states.
- **Don't** treat text arrows as an established icon family.
- **Don't** import the game shell's shadows and chamfered plates into this flat education surface as if they were already implemented.
- **Don't** replace readable objectives with visual-only or JSON-only explanations.
