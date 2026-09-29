---
name: World Wide Maze Administration
description: A paper, ink and teal workspace for capture review and service controls.
colors:
  teal: "#0b6f79"
  teal-soft: "#dcefef"
  paper: "#f7f6f2"
  paper-2: "#efece4"
  panel: "#fffefb"
  ink: "#16181d"
  ink-2: "#353a44"
  muted: "#5d6370"
  rule: "#d8d4c9"
  pending-ink: "#765011"
  pending-paper: "#fff0d0"
  danger-ink: "#8d2e20"
  danger-paper: "#f5e2de"
typography:
  headline:
    fontFamily: '"Instrument Sans Variable", "Instrument Sans", "Instrument Sans Fallback", system-ui, sans-serif'
    fontSize: "1.85rem"
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: '"Instrument Sans Variable", "Instrument Sans", "Instrument Sans Fallback", system-ui, sans-serif'
    fontSize: "1.25rem"
    lineHeight: 1.35
  body:
    fontFamily: '"Instrument Sans Variable", "Instrument Sans", "Instrument Sans Fallback", system-ui, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Instrument Sans Variable", "Instrument Sans", "Instrument Sans Fallback", system-ui, sans-serif'
    fontSize: "0.9rem"
    fontWeight: 600
  status:
    fontFamily: '"Instrument Sans Variable", "Instrument Sans", "Instrument Sans Fallback", system-ui, sans-serif'
    fontSize: "0.8rem"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  control: "4px"
  status: "3px"
spacing:
  compact: "0.5rem"
  small: "0.75rem"
  regular: "1rem"
  panel: "1.25rem"
  section: "1.5rem"
  wide: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    padding: "0.55rem 0.8rem"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.55rem 0.8rem"
  button-danger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.danger-ink}"
    rounded: "{rounded.control}"
    padding: "0.55rem 0.8rem"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.55rem 0.7rem"
  status-neutral:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink-2}"
    typography: "{typography.status}"
    rounded: "{rounded.status}"
    padding: "0.15rem 0.45rem"
  status-enabled:
    backgroundColor: "{colors.teal-soft}"
    textColor: "{colors.teal}"
    typography: "{typography.status}"
    rounded: "{rounded.status}"
    padding: "0.15rem 0.45rem"
---

# Design System: World Wide Maze Administration

## Overview

**Creative North Star: "Capture workbench"**

This system applies to the administration workspace. Paper surfaces, ink text and a restrained teal accent make capture evidence, decisions and service controls easy to distinguish. It inherits the showcase palette while using Instrument Sans throughout the operator interface.

The workspace is compact and direct: task navigation establishes context, fine rules divide related information, and native controls retain familiar behavior. The approved option A supplies this scoped visual direction; it does not replace the game's or spectator's identity.

**Key Characteristics:**

- Paper surfaces with fine separators and little visual depth.
- One sans-serif family across headings, forms and metadata.
- Teal for selection and primary actions; explicit text for status.
- Native controls and disclosures with visible keyboard focus.

## Colors

Warm neutral surfaces support dark ink text; teal marks selection and constructive action.

### Primary

- **Teal:** primary buttons, active navigation, evidence links and positive status text.
- **Soft teal:** selected queue rows, notices and positive status backgrounds.

### Neutral

- **Panel:** the main canvas, fields and ordinary buttons.
- **Paper:** grouped configuration surfaces and the evidence canvas.
- **Deeper paper:** neutral status and disabled-control backgrounds.
- **Ink / secondary ink:** primary content and supporting record information.
- **Muted ink:** descriptive copy, timestamps and inactive navigation.
- **Rule:** thin boundaries between tasks, records and sections.

Pending status uses warm amber text and a pale amber ground. Blocked status and destructive actions use dark red; blocked chips receive a pale red ground. These colors accompany labels rather than replacing them.

**The Named State Rule.** Every status treatment carries readable text describing the known state. A budget-enabled label describes the budget gate, not provider readiness or remaining quotas.

## Typography

**Display and Body Font:** Instrument Sans, using the bundled variable family and metric-adjusted fallback stack in the frontmatter.

The hierarchy uses fixed sizes and moderate weight changes. Section headlines are the largest operator text; record titles, form labels and compact metadata remain distinct without a second display face. Narrow screens reduce section headlines to (1.5rem). Supporting copy is commonly (0.9rem), metadata (0.8–0.85rem), and explanatory paragraphs cap their measure at (65ch).

**The Operator Voice Rule.** Keep headings, body copy and controls in the same sans-serif family; preserve the explicit admin font override when sharing showcase styles.

## Layout

The shell uses a wrapping masthead followed by task links and a centered main region capped at (100rem). Desktop content uses (2rem) horizontal padding. The review workspace has a fine outer border and adjoining queue and inspector columns, approximately one-third and two-thirds, with no inter-column gutter. Its queue has a (16rem) minimum width. At (70rem) and above, the queue can remain sticky while the inspector scrolls.

At (52rem) and below, the selected inspector replaces the queue and offers a return button that restores focus to the selected record. Task links wrap. Main padding narrows to (1rem); search spans a full row above its status and submit controls. Configuration grids stack into one column, while service rows place their state and action below their description. Jev's form stacks further at (640px).

Use the spacing steps in the frontmatter for recurring gaps and panel insets. Keep URLs and other long record values wrappable.

## Elevation & Depth

Administration is flat at rest. Paper tones, one-pixel borders and inset spacing distinguish regions. Selected queue rows use a soft teal fill without a shadow. Keyboard focus is inherited from the showcase shell: a yellow outline (3px) with an offset (2px). Focus is an interaction signal, not panel elevation.

## Shapes

Controls and grouped panels use gently rounded corners. Status labels use a slightly smaller radius, while adjoining queue rows have square edges and fine horizontal dividers. Native checkboxes retain a compact square shape (1.15rem) with teal accent color; their label remains the larger interaction surface.

## Components

### Buttons

Primary actions use teal and panel-colored text. Secondary actions use panel fill and a fine rule border. Destructive actions use red text and a muted red border. Buttons have a minimum height of (44px); hover changes the fill and border, while disabled buttons use muted text, deeper paper and an unavailable cursor. Retain the shared visible focus outline.

### Inputs / Fields

Fields use explicit labels, panel fill, muted borders and the control radius. Search, select and ordinary inputs have a (44px) minimum height. Textareas resize vertically. Checkbox dimensions are explicit so they do not inherit full-width field styling. Place explanatory copy near the field it qualifies.

### Navigation

Task links have a transparent lower border at rest. The active destination combines teal text, stronger weight and a teal underline (3px), with `aria-current="page"`. Desktop targets are at least (52px) tall, reducing to (44px) on narrow screens. Hover adds a paper fill and darker text.

### Status Labels

Status labels are compact text chips. Neutral, enabled, pending and blocked treatments reuse the palette above. Service labels wrap when necessary. The masthead reports capture budget eligibility and reserved spend. Jev gives shared budget pauses precedence over its local provider setting; the interface explains why a local enabled setting may still be paused.

### Containers and Disclosures

Budget summaries and rule forms use paper fill, fine borders and panel padding. Evidence, advanced operations, reconciliation and usage counters use native disclosures with a minimum summary height of (44px). This keeps secondary detail accessible without giving it equal prominence to the current task.

### Capture Evidence and Decisions

Evidence loads only after the operator opens its disclosure. A labeled selector exposes one authorized screenshot or slice at a time; a full-size link opens the selected artifact. The contained image has a height of (12rem), capped at (30vh), preserving the source aspect ratio. Capture decisions sit immediately below evidence; confirmation forms retain their reason and explicit acknowledgement. Secondary capture metadata, operations and history follow in a disclosure.

## Do's and Don'ts

### Do:

- **Do** use readable state labels alongside color.
- **Do** keep native control behavior, explicit labels and visible keyboard focus.
- **Do** use thin borders and paper tones to group related information.
- **Do** preserve mobile return-to-queue behavior and wrapping record values.

### Don't:

- **Don't** present reserved spend as the provider bill or a budget-enabled state as overall availability.
- **Don't** let showcase serif inheritance override administration typography.
- **Don't** substitute illustrative imagery for private capture evidence.
